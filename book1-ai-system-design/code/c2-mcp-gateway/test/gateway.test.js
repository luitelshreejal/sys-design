// Tests for the gateway controls. Each test starts the bundled upstream
// server on a free port and builds a Gateway with its own temp audit log and
// kill switch file, so tests cannot interfere with each other.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SignJWT } from 'jose';
import { startHttpServer } from '../upstream/hcp360/src/http.js';
import { Gateway } from '../src/gateway.js';
import { startGateway } from '../src/http.js';
import { authenticate, issueDevToken } from '../src/auth.js';
import { redactText } from '../src/redact.js';

const REGISTRY = JSON.parse(readFileSync(new URL('../config/approved-servers.json', import.meta.url)));
const rep = { user: 'rep.jlee', role: 'field_rep', territories: ['T-NE-101'], agent: 'precall-planner' };
const analyst = { user: 'analyst.mchen', role: 'brand_analyst', territories: ['T-NE-101'], agent: 'brand-insights-bot' };

let honest, tampered;
before(async () => {
  honest = await startHttpServer({ port: 0 });
  tampered = await startHttpServer({ port: 0, rugPull: true });
});
after(() => { honest.httpServer.close(); tampered.httpServer.close(); });

// Build a gateway wired to a chosen upstream URL, with temp files.
function makeGateway({ upstreamUrl = honest.url, policy, registry, now } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'c2-'));
  const killSwitchPath = join(dir, 'killswitch.json');
  writeFileSync(killSwitchPath, JSON.stringify({ disabledTools: [] }));
  const reg = structuredClone(registry ?? REGISTRY);
  reg.servers[0].url = upstreamUrl;
  const gateway = new Gateway({ registry: reg, policy, killSwitchPath, auditLogPath: join(dir, 'audit.jsonl'), now });
  const auditLines = () => readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { gateway, killSwitchPath, auditLines };
}
const parse = (r) => JSON.parse(r.content[0].text);

test('allowed call: a field rep gets an HCP in their territory, and it is audited', async () => {
  const { gateway, auditLines } = makeGateway();
  const r = await gateway.callTool(rep, 'get_hcp_profile', { npi: '9000000011' });
  assert.equal(r.isError, undefined);
  assert.equal(parse(r).last_name, 'Okafor');
  const [line] = auditLines();
  assert.equal(line.decision, 'allow');
  assert.equal(line.user, 'rep.jlee');
  assert.equal(line.agent, 'precall-planner');
  assert.equal(line.tool, 'get_hcp_profile');
  assert.match(line.args_sha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(line).includes('9000000011'), 'raw arguments are not stored');
  assert.equal(typeof line.latency_ms, 'number');
});

test('upstream entitlements still apply behind the gateway (defense in depth)', async () => {
  const { gateway } = makeGateway();
  const r = await gateway.callTool(rep, 'get_hcp_profile', { npi: '9000000052' }); // Atlanta
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No HCP/);
});

test('denied tool: a role cannot call a tool missing from its allow-list, nor see it', async () => {
  const { gateway, auditLines } = makeGateway();
  const r = await gateway.callTool(analyst, 'get_hcp_profile', { npi: '9000000011' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /tool_not_allowed_for_role/);
  assert.equal(auditLines()[0].reason, 'tool_not_allowed_for_role');
  const names = (await gateway.listTools(analyst)).map((t) => t.name);
  assert.deepEqual(names.sort(), ['get_brand_metrics', 'search_approved_content']);
});

test('rate limit: the call over the per-user limit is refused, and the window resets', async () => {
  let clock = 1_000_000;
  const policy = { roles: { field_rep: { tools: ['search_approved_content'], rateLimitPerMinute: 3 } } };
  const { gateway, auditLines } = makeGateway({ policy, now: () => clock });
  for (let i = 0; i < 3; i++) {
    assert.equal((await gateway.callTool(rep, 'search_approved_content', { query: 'dosing' })).isError, undefined);
  }
  const fourth = await gateway.callTool(rep, 'search_approved_content', { query: 'dosing' });
  assert.match(fourth.content[0].text, /rate_limited/);
  assert.equal(auditLines().at(-1).reason, 'rate_limited');
  // A different user has their own allowance.
  const other = await gateway.callTool({ ...rep, user: 'rep.other' }, 'search_approved_content', { query: 'dosing' });
  assert.equal(other.isError, undefined);
  clock += 60_001; // one minute later
  assert.equal((await gateway.callTool(rep, 'search_approved_content', { query: 'dosing' })).isError, undefined);
});

test('redaction: emails and phone numbers are scrubbed, NPIs are left alone', async () => {
  const { gateway, auditLines } = makeGateway();
  const profile = parse(await gateway.callTool(rep, 'get_hcp_profile', { npi: '9000000029' }));
  assert.equal(profile.office_phone, '[REDACTED_PHONE]');  // "(781) 555-0199"
  assert.equal(profile.office_email, '[REDACTED_EMAIL]');
  assert.equal(profile.npi, '9000000029');
  assert.equal(auditLines()[0].redactions, 2);

  const sample = redactText('Call 617.555.0177 or 617-555-0142, email a.b@x.example, NPI 9000000011');
  assert.equal(sample.text, 'Call [REDACTED_PHONE] or [REDACTED_PHONE], email [REDACTED_EMAIL], NPI 9000000011');
  assert.equal(sample.count, 3);
});

test('kill switch: editing the file disables a tool immediately, and re-enabling restores it', async () => {
  const { gateway, killSwitchPath, auditLines } = makeGateway();
  writeFileSync(killSwitchPath, JSON.stringify({ disabledTools: ['get_brand_metrics'] }));
  const r = await gateway.callTool(rep, 'get_brand_metrics', { brand: 'Zentivra' });
  assert.match(r.content[0].text, /kill_switch/);
  assert.equal(auditLines()[0].reason, 'kill_switch');
  assert.ok(!(await gateway.listTools(rep)).some((t) => t.name === 'get_brand_metrics'));

  writeFileSync(killSwitchPath, JSON.stringify({ disabledTools: [] }));
  assert.equal((await gateway.callTool(rep, 'get_brand_metrics', { brand: 'Zentivra' })).isError, undefined);

  writeFileSync(killSwitchPath, 'not json'); // a broken file fails closed
  assert.match((await gateway.callTool(rep, 'get_brand_metrics', { brand: 'Zentivra' })).content[0].text, /kill_switch/);
});

test('rug pull: a changed tool description is blocked and logged; other tools keep working', async () => {
  const { gateway, auditLines } = makeGateway({ upstreamUrl: tampered.url });
  const r = await gateway.callTool(rep, 'search_approved_content', { query: 'dosing' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /tool_description_changed/);

  const alert = auditLines().find((l) => l.event === 'rug_pull_detected');
  assert.equal(alert.tool, 'search_approved_content');
  assert.equal(alert.expected, REGISTRY.servers[0].tools.search_approved_content.descriptionSha256);
  assert.notEqual(alert.actual, alert.expected);

  assert.ok(!(await gateway.listTools(rep)).some((t) => t.name === 'search_approved_content'));
  assert.equal((await gateway.callTool(rep, 'get_hcp_profile', { npi: '9000000011' })).isError, undefined);
  assert.equal(auditLines().filter((l) => l.event === 'rug_pull_detected').length, 1, 'alert logged once');
});

test('version pin: an upstream reporting an unreviewed version is blocked entirely', async () => {
  const registry = structuredClone(REGISTRY);
  registry.servers[0].version = '1.3.0'; // we only ever reviewed 1.3.0; upstream now says 1.4.0
  const { gateway } = makeGateway({ registry });
  const r = await gateway.callTool(rep, 'get_hcp_profile', { npi: '9000000011' });
  assert.match(r.content[0].text, /server_version_not_approved/);
});

test('authentication: valid token accepted; expired, wrong-audience, and forged tokens rejected', async () => {
  const id = await authenticate(`Bearer ${await issueDevToken({ ...rep })}`);
  assert.deepEqual(id, { user: 'rep.jlee', role: 'field_rep', territories: ['T-NE-101'], agent: 'precall-planner' });

  const expired = await issueDevToken({ ...rep, expiresIn: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(authenticate(`Bearer ${expired}`), { code: 'ERR_JWT_EXPIRED' });

  const secret = new TextEncoder().encode('dev-only-secret-change-me-0123456789abcdef');
  const wrongAud = await new SignJWT({ role: 'field_rep' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('https://idp.pharma.example').setAudience('some-other-api').setSubject('rep.jlee')
    .setExpirationTime('5m').sign(secret);
  await assert.rejects(authenticate(`Bearer ${wrongAud}`), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED' });

  const forged = await new SignJWT({ role: 'field_rep' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('https://idp.pharma.example').setAudience('mcp-gateway').setSubject('rep.jlee')
    .setExpirationTime('5m').sign(new TextEncoder().encode('attacker-guessed-secret-000000000000'));
  await assert.rejects(authenticate(`Bearer ${forged}`), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
  await assert.rejects(authenticate(undefined), /missing_bearer_token/);
});

test('end to end over HTTP: an MCP client with a bearer token, and one without', async () => {
  const { gateway } = makeGateway();
  const gw = await startGateway({ port: 0, gateway });
  try {
    const client = new Client({ name: 'test-agent', version: '0.0.0' });
    const token = await issueDevToken({ ...rep });
    await client.connect(new StreamableHTTPClientTransport(new URL(gw.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 3);
    const r = await client.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000011' } });
    assert.equal(parse(r).office_email, '[REDACTED_EMAIL]');
    await client.close();

    const noToken = await fetch(gw.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(noToken.status, 401);
    assert.match(noToken.headers.get('www-authenticate'), /invalid_token/);
  } finally {
    gw.httpServer.close();
  }
});
