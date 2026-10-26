# C2: MCP gateway

Book 1, Appendix C, Example C2. Walkthrough: [WALKTHROUGH.md](WALKTHROUGH.md).

## What it shows

A gateway that sits between agents and upstream MCP servers. Agents connect to it as one MCP server (Streamable HTTP). For every call it applies, in order:

| Control | Where | Config |
|---|---|---|
| Bearer JWT authentication (`jose`) | `src/auth.js` | issuer `https://idp.pharma.example`, audience `mcp-gateway` |
| Kill switch, read on every call | `src/gateway.js` | `config/killswitch.json` |
| Role to tool allow-list | `src/gateway.js` | `config/policy.json` |
| Per-user rate limit (sliding 60 s window) | `src/rate-limiter.js` | `rateLimitPerMinute` in `config/policy.json` |
| Approved-server registry: pinned version and SHA-256 per tool definition, rug-pull detection | `src/registry.js` | `config/approved-servers.json` (written by `npm run pin`) |
| PII redaction of results (emails, phone numbers) | `src/redact.js` | patterns in the file |
| JSONL audit log (user, agent, tool, args hash, decision, latency) | `src/audit.js` | `logs/audit.jsonl` |

The upstream is a copy of Example C1's HCP 360 server in `upstream/hcp360/` (so this folder is self-contained), with one added switch, `rugPull`, that changes a tool description to simulate a compromised update. **All data is invented.**

## Requirements

Node.js 20 or later (tested on Node 26.12.1, npm 11). No credentials. No network access after `npm install`.

## How to run

```bash
cd book1-ai-system-design/code/c2-mcp-gateway
npm install
npm test        # 10 tests
npm run demo    # starts upstream + gateway in one process and walks through every control
```

Run the pieces separately (three terminals, all in this folder):

```bash
npm run upstream     # HCP 360 MCP server on http://127.0.0.1:3101/mcp
npm start            # gateway on http://127.0.0.1:3100/mcp
TOKEN=$(node scripts/token.js field_rep)    # or brand_analyst, mlr_reviewer
curl -s -X POST http://127.0.0.1:3100/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_hcp_profile","arguments":{"npi":"9000000011"}}}'
```

The reply contains Dr. Okafor's profile with `"office_phone": "[REDACTED_PHONE]"`, and a line is appended to `logs/audit.jsonl`. Without the `authorization` header the gateway answers HTTP 401. Edit `config/killswitch.json` while the gateway runs (for example `"disabledTools": ["get_hcp_profile"]`) and the next call is denied.

After reviewing a new upstream version, re-pin the registry with `npm run pin`.

## Expected output

`npm test`:

```text
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

`npm run demo` (latency numbers will differ):

```text
=== 1. No token: the gateway refuses to talk
  connection rejected: Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token"}

=== 2. Field rep via the pre-call planner agent: allowed, contact details redacted
  tools visible: get_hcp_profile, get_brand_metrics, search_approved_content
  Maya Okafor: phone=[REDACTED_PHONE] email=[REDACTED_EMAIL]

=== 3. Brand analyst asks for an HCP profile: not on the allow-list for that role
  tools visible: get_brand_metrics, search_approved_content
  Denied by gateway (tool_not_allowed_for_role): role brand_analyst may not use get_hcp_profile.

=== 4. A runaway loop: the 21st call in a minute is rate limited (field_rep limit is 20)
  allowed 20, then: Denied by gateway (rate_limited): more than 20 calls per minute.

=== 5. Operator flips the kill switch for get_brand_metrics (no restart)
  Denied by gateway (kill_switch): get_brand_metrics is disabled by an operator.
  switched back on, call succeeds: true

=== 6. Rug pull: the upstream ships an update that changes one tool description
  Denied by gateway (tool_description_changed): search_approved_content does not match what was approved.
  tools visible now: get_hcp_profile, get_brand_metrics

=== 7. Audit log (logs/demo-audit.jsonl), one line per decision
  auth_failed: missing_bearer_token
  rep.jlee via precall-planner -> get_hcp_profile: allow args_sha256=45582bb9833d... 4ms redactions=2
  analyst.mchen via brand-insights-bot -> get_hcp_profile: deny (tool_not_allowed_for_role) args_sha256=45582bb9833d... 0ms redactions=0
  rep.burst via precall-planner -> search_approved_content: deny (rate_limited) args_sha256=a4ac215cb677... 0ms redactions=0
  rep.jlee via precall-planner -> get_brand_metrics: deny (kill_switch) args_sha256=7735b59af936... 0ms redactions=0
  rep.jlee via precall-planner -> get_brand_metrics: allow args_sha256=7735b59af936... 2ms redactions=0
  rug_pull_detected: search_approved_content tool_description_changed
  rep.jlee via precall-planner -> search_approved_content: deny (tool_description_changed) args_sha256=a4ac215cb677... 3ms redactions=0
  (20 allowed search_approved_content lines from step 4 not shown)
```

## Tests

`test/gateway.test.js` covers: allowed call (with audit line contents), upstream entitlements still applying behind the gateway, denied tool (and hidden from `tools/list`), rate limit hit and window reset, redaction (emails, three phone formats, NPIs untouched), kill switch (on, off, broken file fails closed), rug-pull detection (blocked, logged once, other tools unaffected), server version pin, authentication (valid, expired, wrong audience, forged signature, missing), and an end-to-end MCP client over HTTP.

## Versions

`@modelcontextprotocol/sdk` 1.32.2, `jose` 6.2.13, `zod` 4.6.7.

## Demo shortcuts

Tokens are HS256 with a built-in development secret (override with `GATEWAY_DEV_SECRET`). The upstream trusts identity headers from the gateway. Rate-limit counts and the rug-pull alert memory live in process memory. See "What production would add" in the walkthrough.
