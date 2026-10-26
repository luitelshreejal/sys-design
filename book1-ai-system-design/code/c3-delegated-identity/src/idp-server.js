#!/usr/bin/env node
// idp-server.js
//
// Puts the mock IdP on HTTP, with the same endpoints a real IdP offers:
//   GET  /.well-known/jwks.json  public keys, so anyone can verify our tokens
//   POST /token                  RFC 8693 token exchange (form-encoded body,
//                                agent authenticates with HTTP Basic auth)
//   POST /demo/login             MOCK sign-in: {"user","client_id"} -> user token.
//                                A real IdP runs a browser SSO flow here instead.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createIdp } from './idp.js';

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

// "Authorization: Basic base64(client_id:client_secret)" -> { clientId, clientSecret }
function basicAuth(header) {
  const match = /^Basic (.+)$/.exec(header || '');
  if (!match) return {};
  const [clientId, clientSecret] = Buffer.from(match[1], 'base64').toString().split(':');
  return { clientId, clientSecret };
}

function sendJson(res, status, body) {
  // Token responses must not be cached (RFC 6749 section 5.1).
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

export async function startIdpServer({ port = 3200, host = '127.0.0.1', idp } = {}) {
  idp ??= await createIdp();
  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/.well-known/jwks.json') return sendJson(res, 200, idp.jwks);
      if (req.method === 'POST' && req.url === '/token') {
        const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
        const { status, body } = await idp.exchange({ ...form, ...basicAuth(req.headers.authorization) });
        return sendJson(res, status, body);
      }
      if (req.method === 'POST' && req.url === '/demo/login') {
        const { user, client_id } = JSON.parse(await readBody(req));
        return sendJson(res, 200, { access_token: await idp.issueUserToken(user, client_id), token_type: 'Bearer' });
      }
      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      sendJson(res, 400, { error: 'invalid_request', error_description: err.message });
    }
  });
  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  return { httpServer, idp, baseUrl: `http://${host}:${httpServer.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { baseUrl } = await startIdpServer({ port: Number(process.env.PORT || 3200) });
  console.error(`[idp] mock identity provider on ${baseUrl}`);
}
