// Tests for the token exchange and the gateway-side verifier. Each test gets
// a fresh IdP (new signing key, fresh copy of the directory) on a free port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair } from 'jose';
import { startIdpServer } from '../src/idp-server.js';
import { requestAgentToken, peek } from '../src/agent-client.js';
import { createVerifier } from '../src/verifier.js';
import { ISSUER } from '../src/idp.js';

const PLANNER = { clientId: 'precall-planner', clientSecret: 'precall-planner-dev-secret' };

async function setup() {
  const { httpServer, idp, baseUrl } = await startIdpServer({ port: 0 });
  const jwksUrl = `${baseUrl}/.well-known/jwks.json`;
  const gateway = createVerifier({ jwksUrl, directory: idp.directory });
  const userToken = await idp.issueUserToken('rep.jlee', 'precall-planner');
  const exchange = (overrides = {}) =>
    requestAgentToken(baseUrl, { ...PLANNER, subjectToken: userToken, audience: 'mcp-gateway', ...overrides });
  return { idp, baseUrl, jwksUrl, gateway, userToken, exchange, close: () => httpServer.close() };
}

test('valid exchange: short-lived, audience-bound, downscoped, with an act claim', async () => {
  const s = await setup();
  try {
    const { status, body } = await s.exchange({ scope: 'hcp:read content:read' });
    assert.equal(status, 200);
    assert.equal(body.issued_token_type, 'urn:ietf:params:oauth:token-type:access_token');
    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.scope, 'hcp:read content:read');

    const claims = await s.gateway.verifyAgentToken(body.access_token);
    assert.equal(claims.sub, 'rep.jlee', 'still the user');
    assert.deepEqual(claims.act, { sub: 'precall-planner' }, 'names the acting agent');
    assert.equal(claims.aud, 'mcp-gateway');
    assert.equal(claims.exp - claims.iat, 300, 'five minutes');
    assert.ok(!claims.scope.includes('metrics:read'), 'downscoped below the user (who has metrics:read)');

    assert.equal(s.gateway.authorizeToolCall(claims, 'get_hcp_profile', { npi: '9000000011' }).allow, true);
    assert.equal(s.gateway.authorizeToolCall(claims, 'search_approved_content', { query: 'dosing' }).allow, true);
  } finally { s.close(); }
});

test('agent token never outlives the user token it came from', async () => {
  const s = await setup();
  try {
    const shortUserToken = await s.idp.issueUserToken('rep.jlee', 'precall-planner', { ttlSeconds: 90 });
    const { body } = await s.exchange({ subjectToken: shortUserToken });
    const claims = peek(body.access_token);
    assert.equal(claims.exp, peek(shortUserToken).exp);
    assert.ok(body.expires_in <= 90);
  } finally { s.close(); }
});

test('expired token: an expired user token cannot be exchanged, and an expired agent token is refused', async () => {
  const s = await setup();
  try {
    const expiredUserToken = await s.idp.issueUserToken('rep.jlee', 'precall-planner', { ttlSeconds: -60 });
    const r = await s.exchange({ subjectToken: expiredUserToken });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_grant');
    assert.match(r.body.error_description, /exp/);

    const { body } = await s.exchange();
    const sixMinutesLater = createVerifier({
      jwksUrl: s.jwksUrl, directory: s.idp.directory, now: () => Date.now() + 6 * 60_000,
    });
    await assert.rejects(sixMinutesLater.verifyAgentToken(body.access_token), { code: 'ERR_JWT_EXPIRED' });
  } finally { s.close(); }
});

test('wrong audience: blocked at exchange, at the gateway, and when another agent swaps the token', async () => {
  const s = await setup();
  try {
    const crm = await s.exchange({ audience: 'crm-write-api' });
    assert.equal(crm.status, 400);
    assert.equal(crm.body.error, 'invalid_target');

    // The user's own token (aud = precall-planner) is not valid at the gateway.
    await assert.rejects(s.gateway.verifyAgentToken(s.userToken), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' });

    // A token minted for some other API is not valid at the gateway either.
    const otherApi = await s.idp.sign({ scope: 'hcp:read', act: { sub: 'precall-planner' } },
      { subject: 'rep.jlee', audience: 'crm-write-api', expiresAt: Math.floor(Date.now() / 1000) + 300 });
    await assert.rejects(s.gateway.verifyAgentToken(otherApi), { claim: 'aud' });

    // Another agent cannot swap a token that was issued to the pre-call planner.
    const swapped = await s.exchange({ clientId: 'brand-insights-bot', clientSecret: 'brand-insights-dev-secret' });
    assert.equal(swapped.body.error, 'invalid_grant');

    const badSecret = await s.exchange({ clientSecret: 'guess' });
    assert.equal(badSecret.status, 401);
    assert.equal(badSecret.body.error, 'invalid_client');
  } finally { s.close(); }
});

test('scope escalation: the agent cannot get, or use, more than the user and agent share', async () => {
  const s = await setup();
  try {
    // metrics:read: the user has it, but this agent may never hold it.
    const beyondAgent = await s.exchange({ scope: 'hcp:read metrics:read' });
    assert.equal(beyondAgent.status, 400);
    assert.equal(beyondAgent.body.error, 'invalid_scope');
    // content:approve: nobody in this directory has it.
    assert.equal((await s.exchange({ scope: 'content:approve' })).body.error, 'invalid_scope');

    // A downscoped token cannot call a tool outside its scope.
    const { body } = await s.exchange({ scope: 'content:read' });
    const claims = await s.gateway.verifyAgentToken(body.access_token);
    assert.match(s.gateway.authorizeToolCall(claims, 'get_hcp_profile', { npi: '9000000011' }).reason, /insufficient_scope/);
    // Nor reach a territory the user does not cover.
    const full = await s.gateway.verifyAgentToken((await s.exchange()).body.access_token);
    assert.match(s.gateway.authorizeToolCall(full, 'get_hcp_profile', { npi: '9000000052' }).reason, /territory_not_entitled/);
  } finally { s.close(); }
});

test('a token that claims more than the user has today is cut back to the user', async () => {
  const s = await setup();
  try {
    // Pretend the IdP had a bug, or the token predates a territory change.
    const inflated = await s.idp.sign(
      { scope: 'hcp:read metrics:read', territories: ['T-NE-101', 'T-SE-201'], act: { sub: 'precall-planner' } },
      { subject: 'rep.jlee', audience: 'mcp-gateway', expiresAt: Math.floor(Date.now() / 1000) + 300 });
    const claims = await s.gateway.verifyAgentToken(inflated);
    assert.match(s.gateway.authorizeToolCall(claims, 'get_hcp_profile', { npi: '9000000052' }).reason, /territory_not_entitled/);
    // metrics:read is in the token and the user has it, but this agent may never hold it.
    assert.match(s.gateway.authorizeToolCall(claims, 'get_brand_metrics', { brand: 'Zentivra' }).reason, /insufficient_scope/);

    s.idp.directory.users['rep.jlee'].scopes = ['content:read']; // hcp:read revoked from the user
    assert.match(s.gateway.authorizeToolCall(claims, 'get_hcp_profile', { npi: '9000000011' }).reason, /insufficient_scope/);
  } finally { s.close(); }
});

test('a token signed by anyone other than the IdP is rejected, and so is one with no act claim', async () => {
  const s = await setup();
  try {
    const attacker = await generateKeyPair('ES256');
    const forged = await new SignJWT({ scope: 'hcp:read', territories: ['T-SE-201'], act: { sub: 'precall-planner' } })
      .setProtectedHeader({ alg: 'ES256', kid: 'demo-key-1' })
      .setIssuer(ISSUER).setAudience('mcp-gateway').setSubject('rep.jlee').setExpirationTime('5m')
      .sign(attacker.privateKey);
    await assert.rejects(s.gateway.verifyAgentToken(forged), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });

    const noAct = await s.idp.sign({ scope: 'hcp:read' },
      { subject: 'rep.jlee', audience: 'mcp-gateway', expiresAt: Math.floor(Date.now() / 1000) + 300 });
    await assert.rejects(s.gateway.verifyAgentToken(noAct), /act\.sub missing/);
  } finally { s.close(); }
});
