# C1: MCP server for the HCP 360 data product

Book 1, Appendix C, Example C1. Walkthrough: [WALKTHROUGH.md](WALKTHROUGH.md).

## What it shows

An MCP (Model Context Protocol) server, built with the official SDK, that exposes a commercial pharma data product to agents:

- Tools `get_hcp_profile`, `get_brand_metrics`, `search_approved_content`, each with a description written for the model, an input schema, and read-only annotations.
- Resource `hcp360://data-dictionary`, a plain-English field dictionary.
- Entitlement filtering: the caller's territories decide which HCPs and metrics they see, and patient-level fields are never returned (field allow-list).
- Only MLR-approved, unexpired content is searchable.
- Two transports: stdio and Streamable HTTP (stateless).
- A small client (`src/client.js`) that connects and calls every tool.

`data/hcp360.json` stands in for a Snowflake HCP 360 data product. **All data is invented.** NPIs start with 9 (never issued in the real registry), and Zentivra and Lumotrex are fictional brands.

## Requirements

Node.js 20 or later (tested on Node 26.12.1, npm 11). No credentials. No network access after `npm install`.

## How to run

```bash
cd book1-ai-system-design/code/c1-mcp-server
npm install
npm test             # runs 12 tests with node --test
npm run demo         # client -> server over stdio
npm run demo:http    # client -> server over Streamable HTTP
```

To run the server on its own:

```bash
HCP360_USER=rep.jlee HCP360_TERRITORIES=T-NE-101 npm start   # stdio, for an MCP host app
npm run start:http                                            # HTTP on http://127.0.0.1:3001/mcp
```

The HTTP server expects `x-caller-user` and `x-caller-territories` headers, which a gateway would set after authenticating the user (see C2). Without them it answers 401.

## Expected output

`npm test`:

```text
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

`npm run demo` (connected as field rep `rep.jlee`, territory T-NE-101 only):

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

get_brand_metrics Zentivra (my territories)
  OK: {"brand":"Zentivra","as_of":"2026-10-16","rows":[{"brand":"Zentivra","territory_id":"T-NE-101","week_ending":"2026-09-25","trx":402,"nrx":88,"market_s ...

get_brand_metrics Zentivra in T-SE-201 (not mine)
  REFUSED: Not entitled to territory T-SE-201.

search_approved_content "hospitalization"
  OK: [{"content_id":"ZEN-CORE-001","brand":"Zentivra","title":"Core efficacy message","text":"In the pivotal trial, Zentivra reduced the risk of heart fail ...

search_approved_content "savings" (only an EXPIRED piece matches)
  OK: []
```

`npm run demo:http` prints the same, except the first line says `Connected over Streamable HTTP`.

## Files

| Path | Purpose |
|---|---|
| `data/hcp360.json` | Invented fixture: HCPs, weekly brand metrics, approved content |
| `src/data-product.js` | Entitlement rules and field allow-list (no MCP code) |
| `src/server.js` | Tool and resource registration |
| `src/caller.js` | Caller identity from environment variables or gateway headers |
| `src/stdio.js`, `src/http.js` | Transports |
| `src/client.js` | Demo client |
| `test/` | Unit tests for the rules, end-to-end tests over in-memory, stdio, and HTTP transports |

## Versions

`@modelcontextprotocol/sdk` 1.32.2 (the v1 maintenance line; v2 ships as `@modelcontextprotocol/server` and `@modelcontextprotocol/client`), `zod` 4.6.7.
