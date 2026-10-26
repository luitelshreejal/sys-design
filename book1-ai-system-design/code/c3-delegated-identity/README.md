# C3: Delegated identity with OAuth 2.0 Token Exchange (RFC 8693)

Book 1, Appendix C, Example C3. Walkthrough: [WALKTHROUGH.md](WALKTHROUGH.md).

## What it shows

- A **mock identity provider** (`src/idp.js`, `src/idp-server.js`) that signs ES256 tokens, publishes its public keys as a JWKS, and issues user tokens through a mock sign-in.
- An **RFC 8693 token exchange** endpoint (`POST /token`) that swaps a user token for an **agent token** that is short-lived (5 minutes, capped at the user token's expiry), audience-bound (`aud: mcp-gateway`), downscoped (only requested scopes that both the user and the agent are allowed), and carries an `act` claim naming the agent.
- A **gateway-side verifier** (`src/verifier.js`) that accepts only agent tokens for its audience and enforces that the agent never exceeds the user: effective scopes and territories are the token's, intersected with the user's and the agent's entitlements as they are now.

**All users, agents, and HCPs are invented.** `config/directory.json` stands in for the IdP's directory.

## Requirements

Node.js 20 or later (tested on Node 26.12.1, npm 11). No credentials. The demo and tests use only `127.0.0.1`.

## How to run

```bash
cd book1-ai-system-design/code/c3-delegated-identity
npm install
npm test        # 7 tests
npm run demo
```

To poke the IdP by hand:

```bash
npm run idp     # http://127.0.0.1:3200
# in another terminal:
curl -s http://127.0.0.1:3200/.well-known/jwks.json
USER_TOKEN=$(curl -s -X POST http://127.0.0.1:3200/demo/login -H 'content-type: application/json' \
  -d '{"user":"rep.jlee","client_id":"precall-planner"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
curl -s -X POST http://127.0.0.1:3200/token -u precall-planner:precall-planner-dev-secret \
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d subject_token=$USER_TOKEN -d audience=mcp-gateway --data-urlencode 'scope=hcp:read content:read'
```

The last command returns JSON with `access_token`, `issued_token_type`, `token_type: "Bearer"`, `expires_in: 300`, and `scope: "hcp:read content:read"`. Change the scope to `hcp:read metrics:read` to see `invalid_scope`.

## Expected output

`npm test`:

```text
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

`npm run demo`:

```text
=== 1. Jordan signs in to the pre-call planner (mock SSO). User token:
  {"sub":"rep.jlee","aud":"precall-planner","scope":"hcp:read metrics:read content:read","territories":["T-NE-101"]}

=== 2. The agent exchanges it (RFC 8693) for a gateway token, asking only for what it needs
  HTTP 200, expires_in=300s, scope="hcp:read content:read"
  {"sub":"rep.jlee","aud":"mcp-gateway","scope":"hcp:read content:read","territories":["T-NE-101"],"act":{"sub":"precall-planner"}} lifetime=300s

=== 3. The gateway verifies the token and checks each tool call
  get_hcp_profile {"npi":"9000000011"} -> ALLOW
  get_hcp_profile {"npi":"9000000052"} -> DENY (territory_not_entitled: T-SE-201)
  get_brand_metrics {"brand":"Zentivra"} -> DENY (insufficient_scope: get_brand_metrics needs metrics:read)

=== 4. Escalation: the agent asks for metrics:read, which this agent may never hold
  HTTP 400 invalid_scope: Requested scope exceeds what user and agent share: metrics:read

=== 5. Wrong audience: a token for a CRM write API, and the raw user token sent to the gateway
  exchange for crm-write-api: HTTP 400 invalid_target: Agent precall-planner may not get tokens for crm-write-api.
  user token at gateway: ERR_JWT_CLAIM_VALIDATION_FAILED unexpected "aud" claim value

=== 6. A different agent tries to swap a token that was issued to the pre-call planner
  HTTP 400 invalid_grant: Subject token rejected: unexpected "aud" claim value

=== 7. Six minutes later the agent token has expired
  gateway says: ERR_JWT_EXPIRED "exp" claim timestamp check failed

=== 8. Jordan is moved off T-NE-101 in the directory; the old token no longer reaches it
  get_hcp_profile 9000000011 -> DENY (territory_not_entitled: T-NE-101)
```

## Tests

`test/delegation.test.js` covers: a valid exchange (claims, lifetime, `act`, downscoping), lifetime capped at the user token, expired user token and expired agent token, wrong audience (exchange target, user token at the gateway, token for another API, token swapped by another agent, bad client secret), scope escalation (beyond the agent, beyond the user, using a downscoped token, reaching another territory), a token claiming more than the user has today, a forged signature, and a token with no `act` claim.

## Versions

`jose` 6.2.13. No other dependencies.

## Demo shortcuts

Mock sign-in with no password, client secrets in a JSON file, a signing key generated at every start, and the directory held in memory. See "What production would add" in the walkthrough.
