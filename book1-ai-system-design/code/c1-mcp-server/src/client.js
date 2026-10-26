#!/usr/bin/env node
// client.js
//
// A small MCP client that plays the part of an agent application. It connects
// to the HCP 360 server as field rep "rep.jlee" (territory T-NE-101 only),
// lists what the server offers, and calls each tool, including two calls that
// the entitlement rules must refuse.
//
//   node src/client.js          connect over stdio (spawns src/stdio.js)
//   node src/client.js --http   connect over Streamable HTTP (starts src/http.js in-process)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from './http.js';

const REP = { user: 'rep.jlee', role: 'field_rep', territories: 'T-NE-101' };
const useHttp = process.argv.includes('--http');

let transport;
let httpServer;
if (useHttp) {
  // Over HTTP, identity travels in headers. In real life the gateway sets these.
  const started = await startHttpServer({ port: 0 });
  httpServer = started.httpServer;
  transport = new StreamableHTTPClientTransport(new URL(started.url), {
    requestInit: {
      headers: { 'x-caller-user': REP.user, 'x-caller-role': REP.role, 'x-caller-territories': REP.territories },
    },
  });
} else {
  // Over stdio, the client launches the server and passes identity as env vars.
  transport = new StdioClientTransport({
    command: process.execPath, // the same node binary running this script
    args: [new URL('./stdio.js', import.meta.url).pathname],
    env: { HCP360_USER: REP.user, HCP360_ROLE: REP.role, HCP360_TERRITORIES: REP.territories },
    stderr: 'ignore', // hide the server's startup log line to keep the demo output clean
  });
}

const client = new Client({ name: 'precall-planner-demo', version: '0.1.0' });
await client.connect(transport);
console.log(`Connected over ${useHttp ? 'Streamable HTTP' : 'stdio'} to`, client.getServerVersion());

// 1. Discover tools. A real agent passes these names, descriptions, and
//    schemas to the model so the model can decide what to call.
const { tools } = await client.listTools();
console.log('\nTools:');
for (const t of tools) console.log(`  ${t.name}  readOnly=${t.annotations?.readOnlyHint}`);

// 2. Read the resource.
const dict = await client.readResource({ uri: 'hcp360://data-dictionary' });
console.log('\nResource hcp360://data-dictionary, patient_level =',
  JSON.parse(dict.contents[0].text).fields.patient_level);

// 3. Call the tools. show() prints whether the call succeeded and a short preview.
async function show(label, name, args) {
  const result = await client.callTool({ name, arguments: args });
  let text = result.content[0].text;
  if (!result.isError) text = JSON.stringify(JSON.parse(text)); // squash JSON onto one line
  if (text.length > 150) text = text.slice(0, 150) + ' ...';
  console.log(`\n${label}\n  ${result.isError ? 'REFUSED' : 'OK'}: ${text}`);
  return result;
}

const profile = await show('get_hcp_profile 9000000011 (in my territory)', 'get_hcp_profile', { npi: '9000000011' });
console.log('  patient_level present?', 'patient_level' in JSON.parse(profile.content[0].text));
await show('get_hcp_profile 9000000052 (Atlanta, not my territory)', 'get_hcp_profile', { npi: '9000000052' });
await show('get_brand_metrics Zentivra (my territories)', 'get_brand_metrics', { brand: 'Zentivra' });
await show('get_brand_metrics Zentivra in T-SE-201 (not mine)', 'get_brand_metrics', { brand: 'Zentivra', territory_id: 'T-SE-201' });
await show('search_approved_content "hospitalization"', 'search_approved_content', { query: 'hospitalization' });
await show('search_approved_content "savings" (only an EXPIRED piece matches)', 'search_approved_content', { query: 'savings' });

await client.close();
if (httpServer) httpServer.close();
