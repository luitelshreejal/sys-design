#!/usr/bin/env node
// demo.js
//
// Runs the whole C2 story in one process, with no setup:
//   upstream HCP 360 MCP server  <-  gateway  <-  three agent clients
// and walks through each control: authentication, allow-list, redaction,
// rate limit, kill switch, and rug-pull detection. Then prints the audit log.

import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../upstream/hcp360/src/http.js';
import { startGateway } from '../src/http.js';
import { Gateway } from '../src/gateway.js';
import { issueDevToken } from '../src/auth.js';

const logsDir = new URL('../logs/', import.meta.url).pathname;
mkdirSync(logsDir, { recursive: true });
const auditLogPath = `${logsDir}demo-audit.jsonl`;
const killSwitchPath = `${logsDir}demo-killswitch.json`;
rmSync(auditLogPath, { force: true });
writeFileSync(killSwitchPath, JSON.stringify({ disabledTools: [] }));

// Start the honest upstream, then the gateway pointing at it.
const upstream = await startHttpServer({ port: 0 });
const registry = JSON.parse(readFileSync(new URL('../config/approved-servers.json', import.meta.url)));
registry.servers[0].url = upstream.url; // the demo uses a random free port
const gw = await startGateway({ port: 0, gateway: new Gateway({ registry, auditLogPath, killSwitchPath }) });

// An "agent": an MCP client connected to the gateway with a bearer token.
async function agent(token) {
  const client = new Client({ name: 'demo-agent', version: '0.1.0' });
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  await client.connect(new StreamableHTTPClientTransport(new URL(gw.url), { requestInit: { headers } }));
  return client;
}
const textOf = (r) => r.content[0].text;
const step = (title) => console.log(`\n=== ${title}`);

step('1. No token: the gateway refuses to talk');
try { await agent(null); } catch (err) { console.log('  connection rejected:', err.message.split('\n')[0]); }

step('2. Field rep via the pre-call planner agent: allowed, contact details redacted');
const rep = await agent(await issueDevToken({ user: 'rep.jlee', role: 'field_rep', territories: ['T-NE-101'], agent: 'precall-planner' }));
console.log('  tools visible:', (await rep.listTools()).tools.map((t) => t.name).join(', '));
const profile = JSON.parse(textOf(await rep.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000011' } })));
console.log(`  ${profile.first_name} ${profile.last_name}: phone=${profile.office_phone} email=${profile.office_email}`);

step('3. Brand analyst asks for an HCP profile: not on the allow-list for that role');
const analyst = await agent(await issueDevToken({ user: 'analyst.mchen', role: 'brand_analyst', territories: ['T-NE-101', 'T-NE-102', 'T-SE-201'], agent: 'brand-insights-bot' }));
console.log('  tools visible:', (await analyst.listTools()).tools.map((t) => t.name).join(', '));
console.log(' ', textOf(await analyst.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000011' } })));

step('4. A runaway loop: the 21st call in a minute is rate limited (field_rep limit is 20)');
const loopy = await agent(await issueDevToken({ user: 'rep.burst', role: 'field_rep', territories: ['T-NE-102'], agent: 'precall-planner' }));
let allowed = 0;
let last;
for (let i = 0; i < 21; i++) {
  last = await loopy.callTool({ name: 'search_approved_content', arguments: { query: 'dosing' } });
  if (!last.isError) allowed++;
}
console.log(`  allowed ${allowed}, then: ${textOf(last)}`);

step('5. Operator flips the kill switch for get_brand_metrics (no restart)');
writeFileSync(killSwitchPath, JSON.stringify({ disabledTools: ['get_brand_metrics'] }));
console.log(' ', textOf(await rep.callTool({ name: 'get_brand_metrics', arguments: { brand: 'Zentivra' } })));
writeFileSync(killSwitchPath, JSON.stringify({ disabledTools: [] }));
const back = await rep.callTool({ name: 'get_brand_metrics', arguments: { brand: 'Zentivra' } });
console.log('  switched back on, call succeeds:', !back.isError);

step('6. Rug pull: the upstream ships an update that changes one tool description');
const tampered = await startHttpServer({ port: 0, rugPull: true });
registry.servers[0].url = tampered.url; // same server name and version, new behavior
console.log(' ', textOf(await rep.callTool({ name: 'search_approved_content', arguments: { query: 'dosing' } })));
console.log('  tools visible now:', (await rep.listTools()).tools.map((t) => t.name).join(', '));

step('7. Audit log (logs/demo-audit.jsonl), one line per decision');
for (const line of readFileSync(auditLogPath, 'utf8').trim().split('\n')) {
  const e = JSON.parse(line);
  if (e.event === 'tool_call' && e.tool === 'search_approved_content' && e.decision === 'allow') continue; // skip the loop noise
  console.log(' ', e.event === 'tool_call'
    ? `${e.user} via ${e.agent} -> ${e.tool}: ${e.decision}${e.reason ? ` (${e.reason})` : ''} args_sha256=${e.args_sha256.slice(0, 12)}... ${e.latency_ms}ms redactions=${e.redactions}`
    : `${e.event}: ${[e.tool, e.reason].filter(Boolean).join(' ')}`);
}
console.log('  (20 allowed search_approved_content lines from step 4 not shown)');

for (const c of [rep, analyst, loopy]) await c.close();
for (const s of [gw.httpServer, upstream.httpServer, tampered.httpServer]) s.close();
