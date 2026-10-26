// Gateway tests. Mock provider only: no network, no API key.
// Each test builds a fresh gateway with its own temporary cost log.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, costUsd } from "../src/config.js";
import { chooseRoute } from "../src/router.js";
import { createGateway } from "../src/gateway.js";
import { createMockProvider } from "../src/providers/mock.js";
import { withFaults } from "../src/providers/faults.js";

function setup(overrides = {}) {
  const config = { ...loadConfig(), timeout_ms: 100, ...overrides };
  const provider = withFaults(createMockProvider({ latencyMs: 5 }));
  const costLogPath = join(mkdtempSync(join(tmpdir(), "c5-")), "cost.jsonl");
  const gateway = createGateway({ config, providers: { anthropic: provider }, costLogPath });
  return { config, provider, gateway, costLogPath };
}
const rep = (content, extra = {}) => ({ team: "field-force-ai", user: "rep-jlee", body: { messages: [{ role: "user", content }], max_tokens: 100, ...extra } });

test("routing: small model by default, mid for analysis or long input, large for high_stakes, capped by team", () => {
  const config = loadConfig();
  const route = (body, team = "brand-analytics") => chooseRoute(config, { messages: [{ role: "user", content: "hi" }], ...body }, team);
  assert.equal(route({}).tier, "small");
  assert.equal(route({ task: "analysis" }).tier, "mid");
  assert.equal(route({ messages: [{ role: "user", content: "x".repeat(9000) }] }).tier, "mid"); // about 2250 tokens
  assert.equal(route({ task: "high_stakes" }).tier, "large");
  const capped = route({ task: "high_stakes" }, "field-force-ai");
  assert.equal(capped.tier, "mid");
  assert.match(capped.reason, /capped at mid/);
});

test("routing end to end: the response says which model answered and why", async () => {
  const { gateway } = setup();
  const out = await gateway.processRequest(rep("Summarize my last call with Dr. Patel."));
  assert.equal(out.status, 200);
  assert.equal(out.body.model, "claude-haiku-5-5");
  assert.equal(out.body.route_reason, "default: small model first");
});

test("fallback on provider error: next model in the chain answers", async () => {
  const { gateway, provider } = setup();
  provider.setFault("claude-haiku-5-5", "error");
  const out = await gateway.processRequest(rep("What did Dr. Okafor ask?"));
  assert.equal(out.status, 200);
  assert.equal(out.body.model, "claude-sonnet-5-5");
  assert.equal(out.body.fallback_from, "claude-haiku-5-5 (server_error)");
});

test("fallback on timeout: the gateway aborts the slow call and moves on", async () => {
  const { gateway, provider } = setup({ timeout_ms: 50 });
  provider.setFault("claude-haiku-5-5", "timeout");
  const started = Date.now();
  const out = await gateway.processRequest(rep("List my Thursday calls."));
  assert.equal(out.body.model, "claude-sonnet-5-5");
  assert.equal(out.body.fallback_from, "claude-haiku-5-5 (timeout)");
  assert.ok(Date.now() - started < 1000, "did not wait for the hung provider");
});

test("no fallback on a bad request, and a clear error when every model fails", async () => {
  const { gateway, provider } = setup();
  provider.setFault("claude-haiku-5-5", "bad_request");
  const bad = await gateway.processRequest(rep("x"));
  assert.equal(bad.status, 400);
  assert.equal(provider.calls.length, 0, "sonnet was never tried");

  provider.setFault("claude-haiku-5-5", "error");
  provider.setFault("claude-sonnet-5-5", "error");
  const down = await gateway.processRequest(rep("y"));
  assert.equal(down.status, 503);
  assert.equal(down.body.error.type, "all_failed");
});

test("budget exceeded: 429 before any model call, and the refusal is logged", async () => {
  const { gateway, provider } = setup();
  const med = (max_tokens) => ({ team: "medical-info", user: "msl-rgarcia", body: { messages: [{ role: "user", content: "Themes?" }], max_tokens } });
  assert.equal((await gateway.processRequest(med(300))).status, 200);
  const callsBefore = provider.calls.length;
  const refused = await gateway.processRequest(med(600)); // 600 budget minus what was used cannot fit 600 more
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.type, "budget_exceeded");
  assert.equal(provider.calls.length, callsBefore, "the model was not called");
  assert.equal(gateway.costLog.readAll().at(-1).status, "budget_exceeded");
});

test("budgets are charged with actual usage, per team", async () => {
  const { gateway } = setup();
  const out = await gateway.processRequest(rep("Hello"));
  const usage = out.body.usage.input_tokens + out.body.usage.output_tokens;
  assert.equal(gateway.budgets.used("field-force-ai"), usage);
  assert.equal(gateway.budgets.used("brand-analytics"), 0);
});

test("cache hit: identical request is served without a model call and costs nothing", async () => {
  const { gateway, provider } = setup();
  const first = await gateway.processRequest(rep("Summarize Dr. Patel."));
  const second = await gateway.processRequest(rep("Summarize Dr. Patel."));
  assert.equal(provider.calls.length, 1);
  assert.equal(second.body.cache_hit, true);
  assert.equal(second.body.cost_usd, 0);
  assert.equal(second.body.text, first.body.text);
  // One character different, or a different team: no hit.
  await gateway.processRequest(rep("Summarize Dr. Patil."));
  await gateway.processRequest({ ...rep("Summarize Dr. Patel."), team: "brand-analytics", user: "analyst-mchen" });
  assert.equal(provider.calls.length, 3);
});

test("cost log: one JSONL line per request with team, user, model, tokens, and correct cost", async () => {
  const { gateway, config, costLogPath } = setup();
  const out = await gateway.processRequest(rep("Summarize Dr. Patel."));
  const lines = readFileSync(costLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  const line = lines[0];
  for (const field of ["ts", "request_id", "team", "user", "model", "tier", "route_reason", "input_tokens", "output_tokens", "cost_usd", "cache_hit", "fallback_from", "latency_ms", "status"]) {
    assert.ok(field in line, `missing ${field}`);
  }
  assert.equal(line.team, "field-force-ai");
  assert.equal(line.user, "rep-jlee");
  assert.equal(line.model, "claude-haiku-5-5");
  const price = config.prices["claude-haiku-5-5"];
  const expected = (out.body.usage.input_tokens * price.input + out.body.usage.output_tokens * price.output) / 1_000_000;
  assert.ok(Math.abs(line.cost_usd - expected) < 1e-6);
  assert.equal(costUsd(config, "claude-opus-5-5", 1_000_000, 0), config.prices["claude-opus-5-5"].input);
  assert.match(config.prices._warning, /PLACEHOLDER/);
});

test("HTTP: unknown team is 403, headers report the routing decision, streaming sends SSE events", async () => {
  const { gateway } = setup();
  const url = await gateway.start();
  const post = (headers, body) => fetch(`${url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const who = { "x-team-id": "field-force-ai", "x-user-id": "rep-jlee" };
  try {
    assert.equal((await post({ "x-team-id": "nobody", "x-user-id": "x" }, { messages: [{ role: "user", content: "hi" }] })).status, 403);

    const plain = await post(who, { messages: [{ role: "user", content: "hi" }] });
    assert.equal(plain.headers.get("x-gateway-model"), "claude-haiku-5-5");
    assert.equal(plain.headers.get("x-gateway-route-reason"), "default: small model first");

    const streamed = await post(who, { stream: true, messages: [{ role: "user", content: "One opener for Dr. Reyes." }] });
    assert.equal(streamed.headers.get("content-type"), "text/event-stream");
    const text = await streamed.text();
    assert.ok((text.match(/^event: text$/gm) ?? []).length > 3, "several text events");
    assert.match(text, /event: done\ndata: .*"cost_usd"/);
    assert.equal(gateway.costLog.readAll().at(-1).cache_hit, false);
  } finally {
    await gateway.stop();
  }
});
