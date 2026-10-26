## Example C5: An LLM Gateway with Model Tiering, Fallback, Budgets, and Cost Attribution

### What this demonstrates

Once three or four teams call language models, each one tends to write its own client code, pick its own model, and send costs to one shared invoice that nobody can break down. An **LLM gateway** fixes this by putting one HTTP service between every app and every model provider. Apps send a request and say who they are. The gateway decides which model answers, what happens when that model fails, whether the team can afford it, and records what it cost.

This example builds a small gateway that shows six of the patterns from the book:

- **Model tiering and routing**: small model first, escalate only when a rule says so (see Chapter 8 (Model Serving and Inference Infrastructure) and Chapter 13 (Cost and Capacity Planning for AI Systems)).
- **Fallback and timeouts**: an ordered chain of models, a timeout the gateway owns, and the rule that only retryable errors fall back (see Chapter 5 (Reliability, Scalability, and Observability)).
- **Per-team budgets**: check the worst case before calling, charge actual usage after (see Chapter 13).
- **Cost attribution**: one JSON line per request, by team, user, and model, ready to load into Snowflake for chargeback (see Chapter 13 and Chapter 19 (Operating AI Platforms)).
- **Exact-match caching**, and why semantic caching needs more care in pharma (see Chapter 8).
- **Streaming passthrough** with Server-Sent Events (see Chapter 8).

The gateway is also the natural place for the controls in Chapter 18 (Enterprise Agent Infrastructure): the MCP gateway in Example C2 applies the same idea to tool calls.

All prices in the config are **placeholders**. They are there to show the arithmetic, not to support a business case.

### How to run

You need Node.js 20 or later. The default mode uses a mock provider and needs no API key.

```bash
cd book1-ai-system-design/code/c5-llm-gateway
npm install
npm test        # 14 tests
npm run demo    # nine requests, then the cost log and a cost summary by team
```

`npm run demo:real` runs the same tour against real Claude models through the Anthropic SDK. It needs `ANTHROPIC_API_KEY` and costs a few cents. `npm start` runs the gateway as a local server on port 8787 for your own curl requests.

### Walkthrough

**1. The policy lives in config.** Routing rules, fallback chains, the timeout, team budgets, and prices are policy decisions, so they sit in one JSON file that a reviewer can read without reading code. Note the `_warning` on the price table and the deliberately tiny `medical-info` budget, which the demo uses to trigger a refusal.

From `config/gateway.config.json` (the whole file):

```json
{
  "_about": "Gateway policy for Book 1 Example C5. Everything here is a policy decision a platform team owns: which model tier is the default, when to escalate, what to fall back to, and how many tokens each team may spend per day. INVENTED values.",

  "tiers": {
    "small": "claude-haiku-5-5",
    "mid": "claude-sonnet-5-5",
    "large": "claude-opus-5-5"
  },

  "routing": {
    "default_tier": "small",
    "escalate_to_mid_when": {
      "task_in": ["analysis", "multi_step"],
      "estimated_input_tokens_over": 2000
    },
    "large_when": {
      "task_in": ["high_stakes"]
    }
  },

  "fallback_chains": {
    "_comment": "Tried in order. If an entry fails with a retryable error or times out, the gateway moves to the next one.",
    "small": [
      { "provider": "anthropic", "model": "claude-haiku-5-5" },
      { "provider": "anthropic", "model": "claude-sonnet-5-5" }
    ],
    "mid": [
      { "provider": "anthropic", "model": "claude-sonnet-5-5" },
      { "provider": "anthropic", "model": "claude-opus-5-5" }
    ],
    "large": [
      { "provider": "anthropic", "model": "claude-opus-5-5" },
      { "provider": "anthropic", "model": "claude-sonnet-5-5" }
    ]
  },

  "timeout_ms": 8000,
  "default_max_tokens": 512,
  "cache_ttl_seconds": 600,

  "teams": {
    "field-force-ai": { "daily_token_budget": 20000, "max_tier": "mid" },
    "brand-analytics": { "daily_token_budget": 50000, "max_tier": "large" },
    "medical-info": { "daily_token_budget": 600, "max_tier": "mid" }
  },

  "prices": {
    "_warning": "PLACEHOLDER prices for teaching. Not real list prices. Check the provider's current pricing page before using numbers like these in a business case.",
    "unit": "USD per 1,000,000 tokens",
    "claude-haiku-5-5": { "input": 1.0, "output": 5.0 },
    "claude-sonnet-5-5": { "input": 5.0, "output": 25.0 },
    "claude-opus-5-5": { "input": 25.0, "output": 125.0 }
  }
}
```

**2. Routing: small model first.** The router starts at the default tier and lets rules raise it. Then the team's ceiling lowers it again if needed. The reason string travels with the request into the response and the cost log, so "why did this cost 5 times more?" has an answer.

From `src/router.js` (lines 23 to 52):

```js
export function chooseRoute(config, request, team) {
  const rules = config.routing;
  const task = request.task ?? "general";
  const inputTokens = estimateRequestTokens(request);

  // Step 1: start with the default tier, then let rules raise it.
  let tier = rules.default_tier;
  let reason = "default: small model first";

  if (rules.large_when.task_in.includes(task)) {
    tier = "large";
    reason = `escalated: task=${task}`;
  } else if (rules.escalate_to_mid_when.task_in.includes(task)) {
    tier = "mid";
    reason = `escalated: task=${task}`;
  } else if (inputTokens > rules.escalate_to_mid_when.estimated_input_tokens_over) {
    tier = "mid";
    reason = `escalated: about ${inputTokens} input tokens is over ${rules.escalate_to_mid_when.estimated_input_tokens_over}`;
  }

  // Step 2: apply the team's ceiling. A team capped at "mid" never reaches "large".
  const maxTier = config.teams[team]?.max_tier ?? "small";
  if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(maxTier)) {
    reason = `${reason}, capped at ${maxTier} for team ${team}`;
    tier = maxTier;
  }

  // Step 3: the fallback chain for that tier (tried in order by fallback.js).
  return { tier, reason, chain: config.fallback_chains[tier], inputTokens };
}
```

**3. Fallback with a timeout per attempt.** Each attempt gets its own timer. When the timer fires, the call is aborted and treated as a retryable failure. A non-retryable error stops the chain immediately, because sending a broken request to a more expensive model only fails again at a higher price.

From `src/fallback.js` (lines 18 to 40):

```js
export async function callWithFallback({ chain, providers, timeoutMs, run }) {
  const attempts = []; // what went wrong at each step, for the cost log
  for (const entry of chain) {
    const provider = providers[entry.provider];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await run(provider, entry.model, controller.signal);
      return { result, entry, attempts };
    } catch (err) {
      const error = controller.signal.aborted
        ? new ProviderError("timeout", `${entry.model} did not answer within ${timeoutMs} ms`, { retryable: true, status: 504 })
        : err;
      attempts.push({ model: entry.model, kind: error.kind ?? "unknown", message: error.message });
      if (!error.retryable) throw Object.assign(error, { attempts });
    } finally {
      clearTimeout(timer);
    }
  }
  // Every entry failed with a retryable error.
  const last = attempts[attempts.length - 1];
  throw Object.assign(new ProviderError("all_failed", `all ${chain.length} models in the chain failed (last: ${last.message})`, { retryable: true, status: 503 }), { attempts });
}
```

**4. The request pipeline, part one: identify, route, check the budget.** Unknown callers are refused. The budget check uses the worst case, the estimated input tokens plus the `max_tokens` the caller asked for, so a team cannot overrun its budget on its last request of the day. Refusals are written to the cost log too, so FinOps can see demand that the budget turned away.

From `src/gateway.js` (lines 31 to 49):

```js

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
```

**5. The request pipeline, part two: cache, call, charge, log.** A cache hit returns immediately at zero cost. Otherwise the gateway calls the chain, charges the team the actual tokens the provider reported, writes the cost line, and stores the answer for next time.

From `src/gateway.js` (lines 51 to 79):

```js

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
```

**6. The cache key.** The key is a SHA-256 fingerprint of the team, tier, system prompt, messages, and `max_tokens`. Including the team keeps one team's answers away from another team that may have different data entitlements.

From `src/cache.js` (lines 23 to 26):

```js
export function cacheKey({ team, tier, system, messages, max_tokens }) {
  const canonical = JSON.stringify([team, tier, system ?? "", messages.map((m) => [m.role, m.content]), max_tokens]);
  return createHash("sha256").update(canonical).digest("hex");
}
```

**7. Streaming passthrough.** For `"stream": true` the gateway sends each piece of text to the caller the moment the model produces it, as an SSE `text` event, and finishes with a `done` event that carries usage and cost. Nothing is written to the client until the first piece arrives, so a request that fails before any text still gets an ordinary JSON error.

From `src/gateway.js` (lines 106 to 117):

```js
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
```

**8. The real provider.** Only `npm run demo:real` uses this. For Sonnet and Opus it opts into Anthropic's server-side refusal fallback, a second safety net that runs inside the provider. Haiku has no server-side fallback, so the parameter is left out for Haiku.

From `src/providers/anthropic.js` (lines 29 to 38):

```js
export function createAnthropicProvider({ client = new Anthropic() } = {}) {
  // Build the SDK call. Returns the API namespace to use plus the parameters.
  function prepare({ model, system, messages, max_tokens }) {
    const params = { model, max_tokens, messages };
    if (system) params.system = system;
    if (SERVER_FALLBACK_MODELS.has(model)) {
      return { api: client.beta.messages, params: { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } };
    }
    return { api: client.messages, params };
  }
```

The SDK's typed errors are mapped to the gateway's single `retryable` flag. Order matters: a timeout error is a special kind of connection error, so it is checked first.

From `src/providers/anthropic.js` (lines 72 to 86):

```js

// Most specific SDK error classes first. APIConnectionTimeoutError is a kind
// of APIConnectionError, so it must be checked before it.
function toProviderError(err) {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", "call aborted by the gateway", { retryable: true });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", err.message, { retryable: true, status: 504 });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("connection", err.message, { retryable: true, status: 502 });
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("rate_limit", err.message, { retryable: true, status: 429 });
  if (err instanceof Anthropic.InternalServerError) return new ProviderError("server_error", err.message, { retryable: true, status: 503 });
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("auth", err.message, { retryable: false, status: 502 });
  if (err instanceof Anthropic.BadRequestError) return new ProviderError("bad_request", err.message, { retryable: false, status: 400 });
  if (err instanceof Anthropic.APIError) return new ProviderError("api_error", err.message, { retryable: (err.status ?? 0) >= 500, status: 502 });
  return new ProviderError("unknown", String(err?.message ?? err), { retryable: false });
}
```

### What to notice

- **The route reason is a first-class field.** Every response and every cost line says why that model was chosen. When the bill for `field-force-ai` jumps, you can group the cost log by `route_reason` and see whether escalations or fallbacks caused it.
- **Fallback changes cost.** In scenes 4 and 5 the small model failed and the mid model answered, at 5 times the price per token with these placeholder prices. A fallback chain that climbs tiers is a reliability choice with a price tag. The `fallback_from` column makes that visible.
- **The team ceiling beats the task label.** Scene 3 asked for `high_stakes`, but `field-force-ai` is capped at the mid tier. Labels come from callers. Ceilings come from policy.
- **Budgets refuse before spending.** Scene 8 was refused while 553 tokens were left, because the request could have used 610. That is the worst-case rule at work. Your spec should say whether the gateway reserves the worst case (as here) or allows a small overspend.
- **The cache hit cost nothing and still left a log line.** Scene 6 shows `cache_hit true` and cost 0. Cache hit rate by team is one of the first numbers a FinOps review asks for.
- **The cost log has no prompt text.** It records who, what, how much, and why, but not what was asked. Prompts can contain HCP names or patient details, and a cost log is read by many more people than a prompt store.

### What production would add

- **Verified identity.** Team and user would come from a signed token issued for the calling app or agent (Examples C2 and C3), not from headers.
- **Shared state.** Budgets, rate limits, and the cache would live in a shared store such as Redis, so every gateway instance sees the same numbers.
- **Budgets in dollars and alerts.** Token budgets per model tier, dollar budgets per team per month, and alerts at 50, 80, and 100 percent instead of a hard stop only.
- **Real token counting** before the call (the provider's token counting endpoint) and real, current prices maintained by FinOps.
- **Provider prompt caching.** Providers can cache a long, unchanging system prompt on their side at a discount. That is separate from this response cache and often saves more.
- **Rate limiting and circuit breakers.** Requests per minute per team, and a circuit breaker that stops sending traffic to a model that keeps failing, instead of paying a timeout on every request.
- **Observability.** Traces and metrics for latency, error rate, fallback rate, and cache hit rate (Example C6 shows tracing).
- **Data controls.** PII redaction or blocking before prompts leave the company, region pinning, and contract terms on provider data retention (see Chapter 6 (Security, Privacy, and Compliance by Design)).
