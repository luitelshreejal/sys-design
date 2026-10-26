// idp.js
//
// A MOCK identity provider (IdP). It plays the part of Okta, Entra ID, or
// Ping in two moments:
//
//   1. Sign-in. A user signs in to an agent app and gets a USER token whose
//      audience is that app. (There is no password here; it is a mock.)
//   2. Token exchange (RFC 8693). The agent app hands the user token back to
//      the IdP and asks for a new token to call the MCP gateway. The IdP
//      returns an AGENT token that is:
//        - short-lived     (5 minutes, and never longer than the user token)
//        - audience-bound  (only valid at the gateway it was issued for)
//        - downscoped      (only the scopes asked for, never more than the
//                           user has, never more than the agent is allowed)
//        - "on behalf of"  (sub = the user, act.sub = the agent)
//
// Tokens are signed with an ES256 private key. Anyone can verify them with
// the public key, which the IdP publishes as a JWKS (JSON Web Key Set).

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';

export const ISSUER = 'https://idp.pharma.example';
export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const AGENT_TOKEN_TTL_SECONDS = 300;

const loadDirectory = () =>
  JSON.parse(readFileSync(new URL('../config/directory.json', import.meta.url), 'utf8'));

// An OAuth error response (RFC 6749 section 5.2): an HTTP status plus a
// standard error code and a human-readable description.
const oauthError = (status, error, description) => ({ status, body: { error, error_description: description } });

export async function createIdp({ directory = loadDirectory(), now = () => Date.now() } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const kid = 'demo-key-1';
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const jwks = { keys: [publicJwk] };
  const nowSeconds = () => Math.floor(now() / 1000);

  // Sign any set of claims as this IdP.
  const sign = (claims, { subject, audience, expiresAt }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(ISSUER)
      .setSubject(subject)
      .setAudience(audience)
      .setIssuedAt(nowSeconds())
      .setExpirationTime(expiresAt)
      .setJti(randomUUID())
      .sign(privateKey);

  // Moment 1: the user signs in to an agent app (clientId). Their token
  // carries their role, territories, and scopes from the directory.
  async function issueUserToken(userId, clientId, { ttlSeconds = 3600 } = {}) {
    const user = directory.users[userId];
    if (!user) throw new Error(`unknown user ${userId}`);
    return sign(
      { role: user.role, territories: user.territories, scope: user.scopes.join(' '), client_id: clientId },
      { subject: userId, audience: clientId, expiresAt: nowSeconds() + ttlSeconds },
    );
  }

  const context = { sign, jwks, directory, nowSeconds };
  return { jwks, directory, issueUserToken, sign, exchange: (req) => exchange(req, context) };
}

// Moment 2: RFC 8693 token exchange. "req" holds the form fields of the POST
// to /token plus the agent's client credentials. Returns { status, body }.
async function exchange(req, { sign, jwks, directory, nowSeconds }) {
  // (a) Who is asking? The agent app must authenticate as itself.
  const agent = directory.agents[req.clientId];
  if (!agent || agent.clientSecret !== req.clientSecret) {
    return oauthError(401, 'invalid_client', 'Unknown agent or wrong client secret.');
  }
  if (req.grant_type !== TOKEN_EXCHANGE || req.subject_token_type !== ACCESS_TOKEN_TYPE || !req.subject_token) {
    return oauthError(400, 'invalid_request', 'Expected an RFC 8693 token exchange with an access token.');
  }

  // (b) Is the user token genuine, unexpired, and issued to THIS agent app?
  let subject;
  try {
    ({ payload: subject } = await jwtVerify(req.subject_token, createLocalJWKSet(jwks), {
      issuer: ISSUER,
      audience: req.clientId, // a token issued to another app cannot be swapped here
      algorithms: ['ES256'],
      currentDate: new Date(nowSeconds() * 1000),
    }));
  } catch (err) {
    return oauthError(400, 'invalid_grant', `Subject token rejected: ${err.message}`);
  }

  // (c) Is the agent allowed to call the requested audience at all?
  if (!agent.allowedAudiences.includes(req.audience)) {
    return oauthError(400, 'invalid_target', `Agent ${req.clientId} may not get tokens for ${req.audience}.`);
  }

  // (d) Downscope. The ceiling is what BOTH the user (as of now, from the
  // directory) and the agent are allowed. Asking for more is refused outright.
  const user = directory.users[subject.sub];
  if (!user) return oauthError(400, 'invalid_grant', 'User is no longer active.');
  const ceiling = user.scopes.filter((s) => agent.maxScopes.includes(s));
  const requested = req.scope ? req.scope.split(' ').filter(Boolean) : ceiling;
  const excess = requested.filter((s) => !ceiling.includes(s));
  if (excess.length > 0) {
    return oauthError(400, 'invalid_scope', `Requested scope exceeds what user and agent share: ${excess.join(' ')}`);
  }

  // (e) Mint the agent token. It never outlives the user token.
  const expiresAt = Math.min(nowSeconds() + AGENT_TOKEN_TTL_SECONDS, subject.exp);
  const act = subject.act ? { sub: req.clientId, act: subject.act } : { sub: req.clientId };
  const token = await sign(
    { scope: requested.join(' '), role: user.role, territories: user.territories, client_id: req.clientId, act },
    { subject: subject.sub, audience: req.audience, expiresAt },
  );
  return {
    status: 200,
    body: {
      access_token: token,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: 'Bearer',
      expires_in: expiresAt - nowSeconds(),
      scope: requested.join(' '),
    },
  };
}
