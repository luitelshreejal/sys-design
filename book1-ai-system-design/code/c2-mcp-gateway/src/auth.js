// auth.js
//
// Authentication: proving WHO is calling. Every request to the gateway must
// carry "Authorization: Bearer <JWT>". A JWT (JSON Web Token) is a signed JSON
// document; if the signature checks out, we can trust the claims inside it.
//
// DEMO SHORTCUT: tokens are signed with a shared secret (HS256) so the example
// runs with no identity provider. In production the gateway would verify
// tokens from your real IdP (Okta, Entra ID, Ping) using the IdP's public keys
// (JWKS). Example C3 shows that version.

import { SignJWT, jwtVerify } from 'jose';

export const ISSUER = 'https://idp.pharma.example';   // who issued the token
export const AUDIENCE = 'mcp-gateway';                // who the token is FOR
const DEV_SECRET = new TextEncoder().encode(
  process.env.GATEWAY_DEV_SECRET || 'dev-only-secret-change-me-0123456789abcdef',
);

// Check the token and turn its claims into the identity the gateway uses.
// jwtVerify rejects a bad signature, an expired token (exp), the wrong
// issuer, or the wrong audience. Any failure throws.
export async function authenticate(authorizationHeader) {
  const match = /^Bearer (.+)$/.exec(authorizationHeader || '');
  if (!match) throw new Error('missing_bearer_token');

  const { payload } = await jwtVerify(match[1], DEV_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'], // never let the token choose its own algorithm
  });

  return {
    user: payload.sub,
    role: payload.role,
    territories: payload.territories || [],
    // Which agent is acting? A delegated token (Example C3) names it in the
    // "act" claim. Otherwise we fall back to the OAuth client_id.
    agent: payload.act?.sub || payload.client_id || 'unknown-agent',
  };
}

// Issue a demo token. Only the demo script and tests use this; in production
// the gateway never issues tokens, it only checks them.
export async function issueDevToken({ user, role, territories, agent, expiresIn = '15m' }) {
  return new SignJWT({ role, territories, client_id: agent })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(user)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(DEV_SECRET);
}
