// caller.js
//
// Works out WHO is calling, so the server can apply entitlements.
// A caller looks like: { userId: 'rep.jlee', role: 'field_rep', territories: ['T-NE-101'] }
//
// Where the caller comes from depends on the transport:
//   stdio: the process that launched the server sets environment variables.
//          (A desktop agent launches the server for one signed-in user.)
//   HTTP:  headers set by the MCP gateway after it authenticated the user.
//          See Examples C2 and C3 for the gateway and token side.

function parseTerritories(value) {
  return (value || '').split(',').map((t) => t.trim()).filter(Boolean);
}

export function callerFromEnv(env = process.env) {
  const caller = {
    userId: env.HCP360_USER,
    role: env.HCP360_ROLE || 'field_rep',
    territories: parseTerritories(env.HCP360_TERRITORIES),
  };
  if (!caller.userId || caller.territories.length === 0) {
    throw new Error('Set HCP360_USER and HCP360_TERRITORIES before starting the server.');
  }
  return caller;
}

// WARNING: trusting headers is only safe when this server is reachable ONLY
// from the gateway (private network, mutual TLS, or similar). Anyone who can
// reach the server directly could otherwise claim any territory.
export function callerFromHeaders(headers) {
  const userId = headers['x-caller-user'];
  const territories = parseTerritories(headers['x-caller-territories']);
  if (!userId || territories.length === 0) return null;
  return { userId, role: headers['x-caller-role'] || 'field_rep', territories };
}
