// agent-client.js
//
// What the AGENT app does: ask the IdP to exchange the signed-in user's token
// for a gateway token. This is a plain RFC 8693 request: an HTTP POST with a
// form-encoded body, the agent authenticating with its own client id and secret.

export async function requestAgentToken(idpBaseUrl, { clientId, clientSecret, subjectToken, audience, scope }) {
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,                                     // the user's token
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience,                                                        // where the new token will be used
  });
  if (scope) form.set('scope', scope);                               // the least the agent needs

  const res = await fetch(`${idpBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

// Simulates the user signing in to an agent app. Mock only.
export async function demoLogin(idpBaseUrl, user, clientId) {
  const res = await fetch(`${idpBaseUrl}/demo/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user, client_id: clientId }),
  });
  return (await res.json()).access_token;
}

// Read a JWT's claims WITHOUT checking the signature. For display only;
// never make a security decision on claims read this way.
export const peek = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
