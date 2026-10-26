## Example C1: An MCP server for the HCP 360 data product

Code: `book1-ai-system-design/code/c1-mcp-server/`. All data is invented. NPIs start with 9, which the real NPI registry never issues, and the brands Zentivra and Lumotrex are fictional.

### What this demonstrates

A Model Context Protocol (MCP) server is the agent-facing front of a data product. Chapter 10 (Agents, Tools, and Orchestration) introduces the idea in section 10.5: you define `get_hcp_profile` once, with its description, schema, and entitlement logic, and every agent in the company uses the same definition. Chapter 18 (Enterprise Agent Infrastructure) goes deeper on how such servers are governed. This example makes those ideas concrete:

- **Tools, a resource, and their descriptions.** Three tools (`get_hcp_profile`, `get_brand_metrics`, `search_approved_content`) and one resource (`hcp360://data-dictionary`). Each tool has a plain-English description, an input schema, and read-only annotations. These are what the model reads when it decides what to call (Chapter 10, section 10.2).
- **Parameterized tools instead of free SQL.** The agent can ask for "one HCP by NPI" or "one brand's weekly TRx". It cannot write its own query (Chapter 10, section 10.2.3).
- **The server enforces access.** The caller's territory decides which HCPs and which metrics they see. Patient-level fields are never returned, because the server uses an allow-list of fields (Chapter 10, section 10.8.2 on tool guardrails, and Chapter 6, Security, Privacy, and Compliance by Design).
- **Two transports.** stdio (the client launches the server as a child process, typical for desktop tools) and Streamable HTTP (a remote server, typical for an enterprise platform behind a gateway).

The JSON fixture `data/hcp360.json` stands in for a Snowflake HCP 360 data product. In production the same rules would be Snowflake row access policies and masking policies on secure views, and the server would query Snowflake with the user's identity or a service identity scoped to the user.

### How to run

You need Node.js 20 or later. No credentials, no network after `npm install`.

```bash
cd book1-ai-system-design/code/c1-mcp-server
npm install
npm test            # 12 tests
npm run demo        # client talks to the server over stdio
npm run demo:http   # the same client over Streamable HTTP
```

The demo connects as field rep `rep.jlee`, who covers territory T-NE-101 (Boston North) only. Expected output (abridged):

```text
Connected over stdio to { name: 'hcp360-mcp-server', version: '1.4.0' }

Tools:
  get_hcp_profile  readOnly=true
  get_brand_metrics  readOnly=true
  search_approved_content  readOnly=true

Resource hcp360://data-dictionary, patient_level = NEVER EXPOSED to agents. Patient-level detail stays in Snowflake.

get_hcp_profile 9000000011 (in my territory)
  OK: {"npi":"9000000011","first_name":"Maya","last_name":"Okafor","specialty":"Cardiology","hco_name":"North Shore Heart Associates","territory_id":"T-NE-1 ...
  patient_level present? false

get_hcp_profile 9000000052 (Atlanta, not my territory)
  REFUSED: No HCP with NPI 9000000052 in your territories.

get_brand_metrics Zentivra in T-SE-201 (not mine)
  REFUSED: Not entitled to territory T-SE-201.

search_approved_content "savings" (only an EXPIRED piece matches)
  OK: []
```

### Walkthrough

The code is split so that the data rules do not depend on MCP:

| File | Role |
|---|---|
| `data/hcp360.json` | Invented HCP 360 data: 5 HCPs, weekly brand metrics, 5 content pieces |
| `src/data-product.js` | Entitlement rules and the field allow-list. Knows nothing about MCP |
| `src/server.js` | Registers the tools and the resource with the MCP SDK |
| `src/caller.js` | Works out who is calling (environment variables or gateway headers) |
| `src/stdio.js`, `src/http.js` | The two transports |
| `src/client.js` | A demo client playing the part of an agent application |

#### Step 1: the entitlement rules

The most important design choice is the allow-list. The server copies only named fields into its answer. The `patient_level` block in the fixture is not on the list, so it can never leak, and neither can any column an engineer adds later.

*`src/data-product.js`, lines 21 to 51:*

```js
// ALLOW-LIST of HCP fields an agent may see. We list what IS allowed rather
// than what is NOT allowed. If an engineer later adds a new column to the
// data product (say, patient_level.new_thing), it stays hidden by default.
// Patient-level fields are deliberately absent from this list.
const HCP_FIELDS_FOR_AGENTS = [
  'npi', 'first_name', 'last_name', 'specialty', 'hco_name', 'territory_id',
  'decile', 'segment', 'preferred_channel', 'office_phone', 'office_email',
  'last_call_date', 'trx_13wk', 'nrx_13wk',
];

// Copy only the allowed fields into a new object.
function projectAllowedFields(hcp) {
  const out = {};
  for (const field of HCP_FIELDS_FOR_AGENTS) out[field] = hcp[field];
  return out;
}

// The entitlement rule: a caller may see a territory only if it is listed
// in their own territories. A field rep has one; a district manager has several.
export function canSeeTerritory(caller, territoryId) {
  return caller.territories.includes(territoryId);
}

// Look up one HCP by NPI. Returns null both when the NPI does not exist and
// when the caller is not entitled to it. Giving the same answer in both cases
// means a caller cannot probe for HCPs outside their territory.
export function getHcpProfile(caller, npi) {
  const hcp = data.hcps.find((h) => h.npi === npi);
  if (!hcp || !canSeeTerritory(caller, hcp.territory_id)) return null;
  return projectAllowedFields(hcp);
}
```

Notice that an HCP outside your territory and an NPI that does not exist get the same answer (`null`). If they gave different answers, a rep could probe for which NPIs exist in other territories.

#### Step 2: registering a tool

Each tool gets a title, a description written for the model, an input schema, and annotations. The schema is written with zod (a validation library the SDK uses); the SDK turns it into JSON Schema for clients and rejects bad input (for example, an NPI that is not 10 digits) before the handler runs.

*`src/server.js`, lines 21 to 58:*

```js
// Every tool here only reads data. These hints tell clients (and gateways)
// that calling the tool changes nothing, so it is safe to retry.
// Hints are advisory: a client should not trust them from an unknown server.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false, // talks only to our own data product, not the internet
};

// Helpers to shape a tool result. MCP results are a list of content blocks;
// we return one text block holding JSON, which any client can display.
const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

export function buildServer(caller) {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'get_hcp_profile',
    {
      title: 'Get HCP profile',
      description:
        'Look up one healthcare professional (HCP) by 10-digit NPI. Returns name, ' +
        'specialty, affiliated HCO, segment, decile, preferred channel, last call date, ' +
        'and 13-week TRx/NRx by brand. Only HCPs in the caller\'s territories are visible. ' +
        'Never returns patient-level data. Use this to prepare for a call with one HCP.',
      inputSchema: {
        npi: z.string().regex(/^\d{10}$/).describe('10-digit National Provider Identifier'),
      },
      annotations: READ_ONLY,
    },
    async ({ npi }) => {
      const profile = getHcpProfile(caller, npi);
      if (!profile) return fail(`No HCP with NPI ${npi} in your territories.`);
      return ok(profile);
    },
  );
```

The description says what the tool returns, what it will never return, and when to use it. That text is effectively a prompt, so it should be reviewed like one. Example C2 shows how a gateway pins it so it cannot change without review.

The annotations (`readOnlyHint` and the rest) are hints. A client should trust them only from a server it has approved, which again is the gateway's job.

#### Step 3: a resource

A resource is something a client reads rather than calls. Exposing the data dictionary lets an agent (or a person) learn what `decile` or `trx_13wk` means before using it.

*`src/server.js`, lines 97 to 110:*

```js
  // A resource is something the client can READ (not call). Here, the data
  // dictionary, so an agent can learn what each field means before using it.
  server.registerResource(
    'hcp360-data-dictionary',
    'hcp360://data-dictionary',
    {
      title: 'HCP 360 data dictionary',
      description: 'Field definitions for the HCP 360 data product, including what is never exposed.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dataDictionary(), null, 2) }],
    }),
  );
```

#### Step 4: who is calling

The server is built for one caller. Over stdio, the launching app sets environment variables. Over HTTP, the gateway sets headers after it has authenticated the user.

*`src/caller.js`, lines 16 to 36:*

```js
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
```

Trusting headers is only acceptable when the server is reachable solely from the gateway. Examples C2 and C3 show the gateway side: C2 authenticates a bearer token and sets these headers, and C3 shows the token being a short-lived, downscoped agent token.

#### Step 5: Streamable HTTP in stateless mode

Each HTTP POST gets a fresh server built for that request's caller. No session state is kept, so any copy of the server can answer any request.

*`src/http.js`, lines 19 to 35:*

```js
async function handle(req, res) {
  if (req.url !== '/mcp') return sendJson(res, 404, { error: 'Not found' });
  // Stateless servers only need POST. GET (server push) and DELETE (end session) are unused.
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const caller = callerFromHeaders(req.headers);
  if (!caller) return sendJson(res, 401, { error: 'Missing caller identity headers' });

  const server = buildServer(caller);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // undefined = stateless mode
    enableJsonResponse: true,      // plain JSON replies instead of an event stream
  });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res); // the transport reads the body itself
}
```

#### Step 6: the client

The demo client shows what an agent application does: connect, discover tools, then call them. Over stdio it launches the server itself and passes the identity as environment variables.

*`src/client.js`, lines 31 to 49:*

```js
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
```

In a real agent, the tool list from `listTools()` goes to the model, the model picks a tool and arguments, and the application calls `callTool()` and gives the result back to the model.

### What to notice

- **The rules live in one place.** `data-product.js` has no MCP code, so the same entitlement rules apply whatever calls them, and they are unit tested on their own (`test/data-product.test.js`).
- **Refuse, do not mislead.** Asking for metrics in a territory you do not cover returns an error, not an empty list. An empty list could be read by the model as "zero TRx".
- **Expired and draft content is invisible.** `search_approved_content` filters on MLR status and expiry date, so an agent cannot quote a savings offer that expired on 2026-06-30. The snapshot date (`as_of`) is fixed in the fixture so results do not depend on today's date.
- **Schema validation is free defense.** A malformed NPI is rejected by the SDK before your code runs (see the test "input that breaks the schema is rejected").
- **The same server, two transports.** `buildServer(caller)` does not know or care whether it is on stdio or HTTP.

### What production would add

This is a teaching example. A production version would need, at least:

- **Real Snowflake access.** Queries against secure views, with row access policies and masking policies doing the filtering, using the user's identity or a scoped service identity rather than a JSON file. Connection pooling and query timeouts.
- **Real identity.** Validate a token on every HTTP request (or sit behind a gateway that does, on a private network with mutual TLS) instead of trusting headers. See C2 and C3.
- **Entitlements from a system of record.** Territory alignments come from the sales operations alignment table, refreshed when reps move, not from environment variables.
- **Observability.** Structured logs, metrics, and traces per tool call (Chapter 10, section 10.10, and Chapter 19, Operating AI Platforms).
- **Pagination and limits.** Result size caps, so a broad query cannot return 50,000 rows into a model's context window.
- **Versioning.** A process for changing tool descriptions and schemas without breaking agents (Example C7).
- **High availability.** Several instances behind a load balancer, health checks, and graceful shutdown. Stateless mode makes this straightforward.
- **SDK currency.** This example uses `@modelcontextprotocol/sdk` 1.32.2, the v1 maintenance line, as of October 2026. The v2 SDK ships as separate packages (`@modelcontextprotocol/server` and `@modelcontextprotocol/client`) and supports a newer protocol revision. The concepts are the same; check the current SDK docs before starting new work.
