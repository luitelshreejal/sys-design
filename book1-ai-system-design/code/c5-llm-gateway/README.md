# C5: An LLM gateway with model tiering, fallback, budgets, cost attribution, and caching

Book 1, Appendix C, Example C5. All data is invented, and **every price in `config/gateway.config.json` is a placeholder**, not a real list price.

## What it shows

An LLM gateway is one HTTP front door that every internal app uses to reach language models. Apps send requests to the gateway instead of calling a model provider directly. That gives the platform team one place to apply policy:

- **Small-model-first routing with escalation.** Requests go to the small tier (`claude-haiku-5-5`) unless a rule says otherwise: tasks labelled `analysis` or `multi_step`, or long inputs, go to the mid tier (`claude-sonnet-5-5`); `high_stakes` tasks go to the large tier (`claude-opus-5-5`). Each team has a ceiling (`max_tier`).
- **Fallback on provider error or timeout.** Each tier has an ordered fallback chain. A retryable error (overloaded, rate limited, network) or a call that runs past the gateway's timeout moves to the next model. A bad request does not fall back.
- **Per-team token budgets.** Each team has a daily token budget. The gateway refuses with HTTP 429 when the worst case (estimated input plus `max_tokens`) does not fit, and charges actual usage after each call.
- **Cost attribution log.** One JSON line per request in `logs/cost.jsonl`, with team, user, model, tokens, cost, route reason, cache hit, and fallback.
- **Exact-match response cache.** An identical request from the same team is answered from memory at zero cost.
- **Streaming passthrough.** With `"stream": true` the gateway forwards text as Server-Sent Events (SSE) as it arrives, then sends a final event with usage and cost.

## How to run

Requires Node.js 20 or later (tested on Node 26). The default mode uses a mock provider and needs no API key or network beyond `npm install`.

```bash
cd book1-ai-system-design/code/c5-llm-gateway
npm install
npm test
npm run demo
```

To run the gateway as a server and call it yourself:

```bash
npm start      # listens on http://127.0.0.1:8787 with the mock provider
curl -s localhost:8787/v1/messages -H 'content-type: application/json' \
  -H 'x-team-id: field-force-ai' -H 'x-user-id: rep-jlee' \
  -d '{"messages":[{"role":"user","content":"Summarize my last call with Dr. Patel."}]}'
curl -s localhost:8787/v1/usage
```

### Optional: real Claude

```bash
export ANTHROPIC_API_KEY=...   # real mode only activates when this is set
npm run demo:real
```

Real mode uses the official Anthropic SDK (`@anthropic-ai/sdk` 1.3.0) and spends real money (a few cents at most for this demo). Outages are still simulated with fault injection, so the fallback scenes still happen. Two notes on the real provider (`src/providers/anthropic.js`):

- For `claude-sonnet-5-5` and `claude-opus-5-5` it opts into Anthropic's **server-side refusal fallback** (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta header). If a safety classifier declines a request, the API retries it on a recommended fallback model inside the same call. Haiku 5.5 has no server-side fallback, so that parameter is not sent for Haiku. Remove the option in `prepare()` if you do not want it.
- It sends no `temperature`, `top_p`, `top_k`, or thinking settings, because current models reject the sampling parameters and use adaptive thinking by default. A `refusal` stop reason is treated as a non-retryable error.

Token counts and costs in real mode come from the API's reported usage, priced with the placeholder table, so they are still not real dollars.

## Expected output

`npm test` runs 14 tests in two files, and all of them should pass:

```
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
```

`npm run demo` (mock mode) prints the following. Mock token counts use a rough 4-characters-per-token estimate, so they are small and identical on every run.

```
1. Simple rep question: small model first
  HTTP 200 model=claude-haiku-5-5 (default: small model first)
  cache_hit=false fallback_from=none tokens=16+33 cost=$0.000181
  text: [claude-haiku-5-5 mock] You asked: "Summarize my last three calls with Dr. Patel in two sentence..." A real mo...

2. Analysis task: escalated to the mid tier
  HTTP 200 model=claude-sonnet-5-5 (escalated: task=analysis)
  cache_hit=false fallback_from=none tokens=24+34 cost=$0.00097
  text: [claude-sonnet-5-5 mock] You asked: "Compare Zentivra NRx trends in Boston North and Boston South..." A real m...

3. High-stakes task from a team capped at the mid tier
  HTTP 200 model=claude-sonnet-5-5 (escalated: task=high_stakes, capped at mid for team field-force-ai)
  cache_hit=false fallback_from=none tokens=11+29 cost=$0.00078
  text: [claude-sonnet-5-5 mock] You asked: "Draft my quarterly business review summary." A real model would answer he...

4. Haiku is overloaded (simulated): fallback to the next model
  HTTP 200 model=claude-sonnet-5-5 (default: small model first)
  cache_hit=false fallback_from=claude-haiku-5-5 (server_error) tokens=11+28 cost=$0.000755
  text: [claude-sonnet-5-5 mock] You asked: "What did Dr. Okafor ask about last time?" A real model would answer here.

5. Haiku hangs (simulated): gateway gives up after 300 ms and falls back
  HTTP 200 model=claude-sonnet-5-5 (default: small model first)
  cache_hit=false fallback_from=claude-haiku-5-5 (timeout) tokens=9+27 cost=$0.00072
  text: [claude-sonnet-5-5 mock] You asked: "List my calls planned for Thursday." A real model would answer here.

6. Exact repeat of request 1: served from cache
  HTTP 200 model=claude-haiku-5-5 (default: small model first)
  cache_hit=true fallback_from=none tokens=16+33 cost=$0
  text: [claude-haiku-5-5 mock] You asked: "Summarize my last three calls with Dr. Patel in two sentence..." A real mo...

7. medical-info team (600 tokens a day), first request
  HTTP 200 model=claude-haiku-5-5 (default: small model first)
  cache_hit=false fallback_from=none tokens=15+32 cost=$0.000175
  text: [claude-haiku-5-5 mock] You asked: "Summarize the latest medical information request themes." A real model wou...

8. medical-info asks for a long answer (max_tokens 600): the worst case no longer fits
  HTTP 429 budget_exceeded: team medical-info has 553 tokens left today; this request could use up to 610

9. Streaming passthrough (Server-Sent Events)
  content-type=text/event-stream text events=17
  streamed text: [claude-haiku-5-5 mock] You asked: "Give me one opener for Dr. Reyes." A real model would answer here.
  final event: model=claude-haiku-5-5 cost=$0.000139

Cost log (logs/cost.jsonl), one line per request:
  team             user            model              in   out  cost_usd   cache  status           fallback_from
  field-force-ai   rep-jlee        claude-haiku-5-5     16   33  0.000181  false  ok
  brand-analytics  analyst-mchen   claude-sonnet-5-5    24   34  0.000970  false  ok
  field-force-ai   rep-jlee        claude-sonnet-5-5    11   29  0.000780  false  ok
  field-force-ai   rep-jlee        claude-sonnet-5-5    11   28  0.000755  false  ok               claude-haiku-5-5 (server_error)
  field-force-ai   rep-jlee        claude-sonnet-5-5     9   27  0.000720  false  ok               claude-haiku-5-5 (timeout)
  field-force-ai   rep-jlee        claude-haiku-5-5      0    0  0.000000  true   ok
  medical-info     msl-rgarcia     claude-haiku-5-5     15   32  0.000175  false  ok
  medical-info     msl-rgarcia     -                     0    0  0.000000  false  budget_exceeded
  field-force-ai   rep-jlee        claude-haiku-5-5      9   26  0.000139  false  ok

Cost by team (placeholder prices):
  field-force-ai   $0.002575
  brand-analytics  $0.000970
  medical-info     $0.000175

Budgets today (GET /v1/usage):
  field-force-ai   used   199 of 20000, 19801 left
  brand-analytics  used    58 of 50000, 49942 left
  medical-info     used    47 of   600, 553 left
```

## File map

| File | What it does |
|---|---|
| `config/gateway.config.json` | The policy: tiers, routing rules, fallback chains, timeout, team budgets and ceilings, placeholder prices |
| `src/config.js` | Loads the policy; token estimate; cost calculation |
| `src/router.js` | Picks the tier and records a plain-English reason |
| `src/fallback.js` | Tries the chain in order with a timeout per attempt |
| `src/budget.js` | Per-team daily token budgets (check worst case before, charge actual after) |
| `src/cache.js` | Exact-match cache keyed by a SHA-256 hash of team, tier, prompt, and max_tokens |
| `src/cost-log.js` | Appends one JSON line per request |
| `src/gateway.js` | The HTTP server and the request pipeline, including SSE streaming |
| `src/server.js` | `npm start`: run the gateway as a local server |
| `src/demo.js` | `npm run demo`: the scripted tour above |
| `src/providers/mock.js` | Deterministic fake provider (complete and stream) |
| `src/providers/faults.js` | Fault injection: make one model fail, hang, or reject on purpose |
| `src/providers/anthropic.js` | Real provider using the Anthropic SDK, with typed error mapping |
| `src/providers/errors.js` | One error type with a `retryable` flag |
| `test/gateway.test.js` | Routing, fallback (error, timeout, no fallback on bad request), budgets, cache, cost log, HTTP and SSE |
| `test/anthropic-provider.test.js` | The real provider's request shape and error mapping, with a fake client (offline) |

## Limitations

- **Placeholder prices.** The price table is invented. Use your provider's current pricing page for real numbers.
- **Rough token estimates.** Routing and the budget pre-check use about 4 characters per token. Budgets are charged with the provider's reported usage, which in mock mode is the same estimate.
- **Single process, in-memory state.** Budgets and the cache reset when the process stops, and two gateway instances would not share them. Production uses a shared store.
- **Identity from headers.** `x-team-id` and `x-user-id` are trusted as sent. Production takes them from a verified token (see Examples C2 and C3).
- **Streaming is simple.** Streams skip the cache. Fallback works only if a model fails before sending its first piece of text. A refusal in the middle of a stream ends with an `error` event after some text was already sent.
- **One provider.** The chains fall back between Anthropic models. The `provider` field in each chain entry lets you add a second provider without changing the fallback code.
