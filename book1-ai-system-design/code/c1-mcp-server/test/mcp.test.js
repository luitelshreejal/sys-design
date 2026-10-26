// End-to-end tests through a real MCP client, over three transports:
// in-memory (fast), stdio (child process), and Streamable HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.js';
import { startHttpServer } from '../src/http.js';

const rep = { userId: 'rep.jlee', role: 'field_rep', territories: ['T-NE-101'] };

async function connectInMemory(caller) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(caller).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

const parse = (result) => JSON.parse(result.content[0].text);

test('lists three read-only tools with descriptions and input schemas', async () => {
  const client = await connectInMemory(rep);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(),
    ['get_brand_metrics', 'get_hcp_profile', 'search_approved_content']);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} is read-only`);
    assert.equal(t.annotations.destructiveHint, false);
    assert.ok(t.description.length > 50, `${t.name} has a real description`);
    assert.equal(t.inputSchema.type, 'object');
  }
  const hcpTool = tools.find((t) => t.name === 'get_hcp_profile');
  assert.deepEqual(hcpTool.inputSchema.required, ['npi']);
  await client.close();
});

test('exposes the data dictionary resource', async () => {
  const client = await connectInMemory(rep);
  const { resources } = await client.listResources();
  assert.equal(resources[0].uri, 'hcp360://data-dictionary');
  const read = await client.readResource({ uri: 'hcp360://data-dictionary' });
  assert.match(JSON.parse(read.contents[0].text).fields.patient_level, /NEVER EXPOSED/);
  await client.close();
});

test('tool calls apply entitlement filtering', async () => {
  const client = await connectInMemory(rep);
  const mine = await client.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000011' } });
  assert.equal(mine.isError, undefined);
  assert.equal(parse(mine).hco_name, 'North Shore Heart Associates');
  assert.ok(!('patient_level' in parse(mine)));

  const notMine = await client.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000052' } });
  assert.equal(notMine.isError, true);

  const metrics = await client.callTool({ name: 'get_brand_metrics', arguments: { brand: 'Zentivra' } });
  assert.ok(parse(metrics).rows.every((r) => r.territory_id === 'T-NE-101'));
  await client.close();
});

test('input that breaks the schema is rejected before the tool runs', async () => {
  const client = await connectInMemory(rep);
  const bad = await client.callTool({ name: 'get_hcp_profile', arguments: { npi: '12345' } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /validation/i);
  await client.close();
});

test('stdio transport: identity comes from environment variables', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../src/stdio.js', import.meta.url).pathname],
    env: { HCP360_USER: 'dm.kpatel', HCP360_TERRITORIES: 'T-NE-101,T-NE-102' },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  const r = await client.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000037' } });
  assert.equal(parse(r).territory_id, 'T-NE-102');
  await client.close();
});

test('Streamable HTTP transport: identity comes from gateway-set headers; no headers means 401', async () => {
  const { httpServer, url } = await startHttpServer({ port: 0 });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-caller-user': 'rep.jlee', 'x-caller-territories': 'T-NE-101' } },
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    const r = await client.callTool({ name: 'get_hcp_profile', arguments: { npi: '9000000052' } });
    assert.equal(r.isError, true, 'Atlanta HCP is hidden from a Boston rep over HTTP too');
    await client.close();

    const anonymous = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(anonymous.status, 401);
  } finally {
    httpServer.close();
  }
});
