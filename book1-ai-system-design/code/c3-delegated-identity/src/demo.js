#!/usr/bin/env node
// demo.js
//
// The whole delegated-identity story in one process:
//   Jordan (field rep) signs in to the pre-call planner agent
//   -> the agent exchanges Jordan's token for a short-lived gateway token
//   -> the gateway verifies it and checks each tool call
// followed by the attacks the design must stop.

import { startIdpServer } from './idp-server.js';
import { requestAgentToken, demoLogin, peek } from './agent-client.js';
import { createVerifier } from './verifier.js';

const { httpServer, idp, baseUrl } = await startIdpServer({ port: 0 });
const gateway = createVerifier({ jwksUrl: `${baseUrl}/.well-known/jwks.json`, directory: idp.directory });
const PLANNER = { clientId: 'precall-planner', clientSecret: 'precall-planner-dev-secret' };
const step = (title) => console.log(`\n=== ${title}`);
const oauthErr = (r) => `HTTP ${r.status} ${r.body.error}: ${r.body.error_description}`;
const show = (claims, keys) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, claims[k]])));

step('1. Jordan signs in to the pre-call planner (mock SSO). User token:');
const userToken = await demoLogin(baseUrl, 'rep.jlee', 'precall-planner');
console.log(' ', show(peek(userToken), ['sub', 'aud', 'scope', 'territories']));

step('2. The agent exchanges it (RFC 8693) for a gateway token, asking only for what it needs');
const ok = await requestAgentToken(baseUrl, { ...PLANNER, subjectToken: userToken, audience: 'mcp-gateway', scope: 'hcp:read content:read' });
const agentToken = ok.body.access_token;
const claims = peek(agentToken);
console.log(`  HTTP ${ok.status}, expires_in=${ok.body.expires_in}s, scope="${ok.body.scope}"`);
console.log(' ', show(claims, ['sub', 'aud', 'scope', 'territories', 'act']), `lifetime=${claims.exp - claims.iat}s`);

step('3. The gateway verifies the token and checks each tool call');
const verified = await gateway.verifyAgentToken(agentToken);
for (const [tool, args] of [
  ['get_hcp_profile', { npi: '9000000011' }],               // Boston North, Jordan's territory
  ['get_hcp_profile', { npi: '9000000052' }],               // Atlanta, not Jordan's
  ['get_brand_metrics', { brand: 'Zentivra' }],             // Jordan has metrics:read, the token does not
]) {
  const d = gateway.authorizeToolCall(verified, tool, args);
  console.log(`  ${tool} ${JSON.stringify(args)} -> ${d.allow ? 'ALLOW' : `DENY (${d.reason})`}`);
}

step('4. Escalation: the agent asks for metrics:read, which this agent may never hold');
const esc = await requestAgentToken(baseUrl, { ...PLANNER, subjectToken: userToken, audience: 'mcp-gateway', scope: 'hcp:read metrics:read' });
console.log(' ', oauthErr(esc));

step('5. Wrong audience: a token for a CRM write API, and the raw user token sent to the gateway');
const crm = await requestAgentToken(baseUrl, { ...PLANNER, subjectToken: userToken, audience: 'crm-write-api' });
console.log('  exchange for crm-write-api:', oauthErr(crm));
await gateway.verifyAgentToken(userToken).catch((e) => console.log('  user token at gateway:', e.code, e.message));

step('6. A different agent tries to swap a token that was issued to the pre-call planner');
const stolen = await requestAgentToken(baseUrl, { clientId: 'brand-insights-bot', clientSecret: 'brand-insights-dev-secret', subjectToken: userToken, audience: 'mcp-gateway' });
console.log(' ', oauthErr(stolen));

step('7. Six minutes later the agent token has expired');
const later = createVerifier({ jwksUrl: `${baseUrl}/.well-known/jwks.json`, directory: idp.directory, now: () => Date.now() + 6 * 60_000 });
await later.verifyAgentToken(agentToken).catch((e) => console.log('  gateway says:', e.code, e.message));

step('8. Jordan is moved off T-NE-101 in the directory; the old token no longer reaches it');
idp.directory.users['rep.jlee'].territories = ['T-NE-102'];
const after = gateway.authorizeToolCall(verified, 'get_hcp_profile', { npi: '9000000011' });
console.log(`  get_hcp_profile 9000000011 -> ${after.allow ? 'ALLOW' : `DENY (${after.reason})`}`);

httpServer.close();
