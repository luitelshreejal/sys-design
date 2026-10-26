#!/usr/bin/env node
// http.js
//
// The gateway's front door. To agents, the gateway looks like one ordinary
// MCP server at http://127.0.0.1:3100/mcp (Streamable HTTP). Behind it sit
// the approved upstream servers.
//
// Every request: (1) authenticate the bearer token, (2) build a small MCP
// server for that identity whose tools/list and tools/call handlers hand off
// to the Gateway pipeline in gateway.js.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { authenticate } from './auth.js';
import { Gateway } from './gateway.js';

// We use the SDK's low-level Server class (not McpServer) because a gateway
// does not define tools itself. It passes through whatever the approved
// upstreams offer, schemas included.
function buildProxyServer(gateway, identity) {
  const server = new Server({ name: 'pharma-mcp-gateway', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await gateway.listTools(identity) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    gateway.callTool(identity, request.params.name, request.params.arguments ?? {}));
  return server;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

async function handle(gateway, req, res) {
  if (req.url !== '/mcp') return sendJson(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  let identity;
  try {
    identity = await authenticate(req.headers.authorization);
  } catch (err) {
    gateway.audit.write({ event: 'auth_failed', reason: err.code || err.message });
    return sendJson(res, 401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
  }

  const server = buildProxyServer(gateway, identity);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function startGateway({ port = 3100, host = '127.0.0.1', gateway = new Gateway() } = {}) {
  const httpServer = http.createServer((req, res) => {
    handle(gateway, req, res).catch((err) => {
      console.error('[gateway] request failed:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    });
  });
  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      resolve({ httpServer, gateway, url: `http://${host}:${httpServer.address().port}/mcp` });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startGateway({ port: Number(process.env.PORT || 3100) });
  console.error(`[gateway] listening on ${url}`);
}
