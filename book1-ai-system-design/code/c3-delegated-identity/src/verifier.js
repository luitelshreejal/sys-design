// verifier.js
//
// The gateway side. This is the code the MCP gateway (Example C2) would run
// on every request when agents present delegated tokens. Two steps:
//
//   1. verifyAgentToken: is this a genuine, unexpired agent token issued for
//      THIS gateway, and does it name an acting agent?
//   2. authorizeToolCall: may this agent, acting for this user, make this call?
//
// The rule that matters most: the agent can never exceed the user. Even if a
// token claims more, the verifier intersects it with the user's CURRENT
// entitlements from the directory, so a user who loses a territory today
// cannot have an agent use it via a token minted this morning.

import { readFileSync } from 'node:fs';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { ISSUER } from './idp.js';

const HCPS = JSON.parse(readFileSync(new URL('../data/hcps.json', import.meta.url), 'utf8')).hcps;

// Each tool needs one scope. A tool that is not listed cannot be called at all.
export const TOOL_SCOPES = {
  get_hcp_profile: 'hcp:read',
  get_brand_metrics: 'metrics:read',
  search_approved_content: 'content:read',
};

export function createVerifier({ jwksUrl, directory, audience = 'mcp-gateway', now = () => Date.now() }) {
  // Fetches the IdP's public keys once and caches them (and refetches when a
  // token arrives signed with a key id it has not seen, for key rotation).
  const keys = createRemoteJWKSet(new URL(jwksUrl));

  async function verifyAgentToken(token) {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ISSUER,
      audience,               // a token for any other API is rejected here
      algorithms: ['ES256'],
      currentDate: new Date(now()),
      requiredClaims: ['exp', 'sub'],
    });
    if (!payload.act?.sub) throw new Error('not a delegated token: act.sub missing');
    return payload;
  }

  function authorizeToolCall(claims, tool, args = {}) {
    const deny = (reason) => ({ allow: false, reason, user: claims.sub, agent: claims.act.sub });

    // The user and the agent as they are NOW, not when the token was minted.
    const user = directory.users[claims.sub];
    const agent = directory.agents[claims.act.sub];
    if (!user) return deny('user_not_active');
    if (!agent) return deny('agent_not_registered');

    // Effective permissions = what the token says AND what the user still has
    // AND what the agent is still allowed.
    const tokenScopes = (claims.scope || '').split(' ');
    const scopes = tokenScopes.filter((s) => user.scopes.includes(s) && agent.maxScopes.includes(s));
    const territories = (claims.territories || []).filter((t) => user.territories.includes(t));

    const needed = TOOL_SCOPES[tool];
    if (!needed) return deny('unknown_tool');
    if (!scopes.includes(needed)) return deny(`insufficient_scope: ${tool} needs ${needed}`);

    // Row-level check, the same territory rule the data product applies (C1).
    const territory = tool === 'get_hcp_profile' ? HCPS[args.npi]?.territory_id : args.territory_id;
    if (tool === 'get_hcp_profile' && !territory) return deny('hcp_not_found');
    if (territory && !territories.includes(territory)) return deny(`territory_not_entitled: ${territory}`);

    return { allow: true, user: claims.sub, agent: claims.act.sub, scopes, territories };
  }

  return { verifyAgentToken, authorizeToolCall };
}
