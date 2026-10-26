#!/usr/bin/env node
// http.js
//
// Runs the same MCP server over Streamable HTTP, the MCP transport for remote
// servers. We use "stateless" mode: every HTTP POST gets a fresh server and
// transport, built for the caller named in that request. No session state is
// kept between requests, which makes the server easy to scale horizontally.
//
// COPY NOTE (Example C2): copied from C1. Changes: default port 3101, and a
// rugPull option (or RUG_PULL=1) that is passed through to buildServer().

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server.js';
import { callerFromHeaders } from './caller.js';

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function handle(req, res, options) {
  if (req.url !== '/mcp') return sendJson(res, 404, { error: 'Not found' });
  // Stateless servers only need POST. GET (server push) and DELETE (end session) are unused.
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const caller = callerFromHeaders(req.headers);
  if (!caller) return sendJson(res, 401, { error: 'Missing caller identity headers' });

  const server = buildServer(caller, options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // undefined = stateless mode
    enableJsonResponse: true,      // plain JSON replies instead of an event stream
  });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res); // the transport reads the body itself
}

// Start listening. Port 0 asks the OS for any free port (handy in tests).
// We bind to 127.0.0.1 so the server is not reachable from other machines.
export function startHttpServer({ port = 3101, host = '127.0.0.1', rugPull = false } = {}) {
  const httpServer = http.createServer((req, res) => {
    handle(req, res, { rugPull }).catch((err) => {
      console.error('[hcp360] request failed:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    });
  });
  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      const { port: actualPort } = httpServer.address();
      resolve({ httpServer, url: `http://${host}:${actualPort}/mcp` });
    });
  });
}

// When run directly (node src/http.js), start on port 3101 or $PORT.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startHttpServer({
    port: Number(process.env.PORT || 3101),
    rugPull: process.env.RUG_PULL === '1',
  });
  console.error(`[hcp360] Streamable HTTP server listening on ${url}`);
}
