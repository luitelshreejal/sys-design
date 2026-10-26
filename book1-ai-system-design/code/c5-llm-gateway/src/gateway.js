// gateway.js
//
// The LLM gateway: one HTTP front door that every internal app uses to reach
// language models. Apps never hold provider API keys or pick models
// themselves. The gateway applies the same policy to every request:
//
//   identify caller -> route (pick tier) -> check budget -> check cache
//     -> call model with fallback -> charge budget -> write cost log
//
// Endpoints:
//   POST /v1/messages  body { messages, system?, max_tokens?, task?, stream? }
//                      headers x-team-id and x-user-id say who is calling
//   GET  /v1/usage     tokens used and left per team today
//
// In production the team and user would come from a verified token (see
// Examples C2 and C3), not from headers the caller can type in.

import http from "node:http";
import { randomUUID } from "node:crypto";
import { chooseRoute } from "./router.js";
import { callWithFallback } from "./fallback.js";
import { createBudgets } from "./budget.js";
import { createCache, cacheKey } from "./cache.js";
import { createCostLog } from "./cost-log.js";
import { costUsd } from "./config.js";

export function createGateway({ config, providers, costLogPath }) {
  const budgets = createBudgets(config);
  const cache = createCache({ ttlSeconds: config.cache_ttl_seconds });
  const costLog = createCostLog(costLogPath);

  // The whole policy for one request. `onText` is set only for streaming.
  async function processRequest({ team, user, body }, onText) {
    const started = Date.now();
    const requestId = randomUUID();
    if (!config.teams[team] || !user) return { status: 403, body: { error: { type: "unknown_caller", message: "x-team-id must be a known team and x-user-id is required" } } };
    if (!Array.isArray(body.messages) || body.messages.length === 0) return { status: 400, body: { error: { type: "invalid_request", message: "messages must be a non-empty list" } } };

    const route = chooseRoute(config, body, team);
    const maxTokens = body.max_tokens ?? config.default_max_tokens;
    const log = (fields) => costLog.write({
      ts: new Date().toISOString(), request_id: requestId, team, user, tier: route.tier, route_reason: route.reason,
      input_tokens: 0, output_tokens: 0, cost_usd: 0, cache_hit: false, fallback_from: null, latency_ms: Date.now() - started, ...fields,
    });

    // Budget: refuse BEFORE spending if the worst case does not fit.
    if (!budgets.canAfford(team, route.inputTokens + maxTokens)) {
      log({ model: null, status: "budget_exceeded" });
      return { status: 429, body: { error: { type: "budget_exceeded", message: `team ${team} has ${budgets.remaining(team)} tokens left today; this request could use up to ${route.inputTokens + maxTokens}` } } };
    }

    // Cache: exact match only, and never for streams (kept simple here).
    const key = cacheKey({ team, tier: route.tier, system: body.system, messages: body.messages, max_tokens: maxTokens });
    const cached = onText ? undefined : cache.get(key);
    if (cached) {
      log({ model: cached.model, cache_hit: true, status: "ok" });
      return { status: 200, body: { ...cached, id: requestId, cache_hit: true, cost_usd: 0, fallback_from: null } };
    }

    try {
      const { result, attempts } = await callWithFallback({
        chain: route.chain, providers, timeoutMs: config.timeout_ms,
        run: (provider, model, signal) => {
          const request = { model, system: body.system, messages: body.messages, max_tokens: maxTokens };
          return onText ? provider.stream(request, { signal, onText }) : provider.complete(request, { signal });
        },
      });
      const { input_tokens, output_tokens } = result.usage;
      const cost = costUsd(config, result.model, input_tokens, output_tokens);
      const fallbackFrom = attempts.length ? attempts.map((a) => `${a.model} (${a.kind})`).join(", ") : null;
      budgets.charge(team, input_tokens + output_tokens);
      log({ model: result.model, input_tokens, output_tokens, cost_usd: cost, fallback_from: fallbackFrom, status: "ok" });
      const answer = { model: result.model, tier: route.tier, route_reason: route.reason, text: result.text, usage: result.usage };
      if (!onText) cache.set(key, answer);
      return { status: 200, body: { ...answer, id: requestId, cache_hit: false, cost_usd: cost, fallback_from: fallbackFrom } };
    } catch (err) {
      log({ model: null, status: `error:${err.kind ?? "unknown"}`, fallback_from: (err.attempts ?? []).map((a) => `${a.model} (${a.kind})`).join(", ") || null });
      return { status: err.status ?? 502, body: { error: { type: err.kind ?? "provider_error", message: err.message } } };
    }
  }

  const server = http.createServer(async (req, res) => {
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/v1/usage") return json(200, budgets.report());
    if (req.method !== "POST" || req.url !== "/v1/messages") return json(404, { error: { type: "not_found" } });

    let body;
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: { type: "invalid_json" } });
    }
    const caller = { team: req.headers["x-team-id"], user: req.headers["x-user-id"], body };

    if (!body.stream) {
      const out = await processRequest(caller);
      const headers = out.status === 200 ? { "x-gateway-model": out.body.model, "x-gateway-route-reason": out.body.route_reason, "x-gateway-cache": String(out.body.cache_hit) } : {};
      return json(out.status, out.body, headers);
    }

    // Streaming passthrough with Server-Sent Events (SSE): each text piece is
    // sent as soon as the model produces it, then one final "done" event with
    // usage and cost. Headers are sent on the first piece, so a request that
    // fails before any text still gets a normal JSON error.
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const out = await processRequest(caller, (text) => {
      if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      send("text", { text });
    });
    if (!res.headersSent) return json(out.status, out.body);
    send(out.status === 200 ? "done" : "error", out.body);
    res.end();
  });

  return {
    budgets, cache, costLog, processRequest,
    async start(port = 0) {
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
