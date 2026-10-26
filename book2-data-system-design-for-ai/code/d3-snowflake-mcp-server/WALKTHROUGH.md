## Example D3: Exposing governed tools through Snowflake's managed MCP server

Code: `code/d3-snowflake-mcp-server/`

### What this demonstrates

The Model Context Protocol (MCP) is the open standard that agent clients such as Claude, ChatGPT, and Cursor use to discover and call tools. Snowflake can host an MCP server as an ordinary schema object, so the tools an external agent sees are governed Snowflake objects with grants, policies, and audit. This example:

- writes two custom tools, `get_territory_rx` and `get_hcp_profile`, as caller's rights stored procedures that read the certified semantic view and tag every query with a JSON `QUERY_TAG`;
- creates an MCP server, `FIELD_TOOLS_MCP`, that exposes the semantic view (Cortex Analyst), the approved content search service, and the two procedures, and a second server that exposes the whole Cortex Agent as a single tool;
- shows both ways a client authenticates: OAuth as the signed-in rep (delegated) and a short-lived, role-restricted programmatic access token for the agent's service user (autonomous);
- gives JSON configuration for an external MCP client.

It builds on Examples D1 and D2 and is the Snowflake-native counterpart to the self-built MCP server and gateway in Book 1 Appendix C (Examples C1 and C2). The design choices are discussed in [Chapter 16 (Exposing Governed Data to Agents on Snowflake)](chapters/16-exposing-governed-data-to-agents-on-snowflake.md), with the governance basis in [Chapter 7 (Governance, Security, and Privacy)](chapters/07-governance-security-privacy.md) and the metric definitions in [Chapter 8 (Data Products and the Semantic Layer)](chapters/08-data-products-and-the-semantic-layer.md).

### How to use it

1. Run Examples D1 and D2.
2. Run `01_custom_tools.sql` (procedures and their grants), then `02_mcp_server.sql` (the servers), then `03_client_authentication.sql` (roles for reps, the OAuth integration, and the agent's token).
3. Configure a client. `mcp-client-config.oauth.json` is in the format Snowflake documents for Cursor (client ID and secret from the OAuth integration, read from environment variables). `mcp-client-config.pat.json` is in the HTTP-with-headers format used by clients such as Claude Code, for a backend agent host that holds the service user's token. Client formats differ; check your client's documentation.

The server URL always has this shape, with hyphens rather than underscores in the account part:

```text
https://<orgname>-<account_name>.snowflakecomputing.com/api/v2/databases/COMMERCIAL/schemas/AI/mcp-servers/FIELD_TOOLS_MCP
```

### Walkthrough

**Step 1: a tool runs as the caller, never as its owner.** `EXECUTE AS CALLER` is the single most important line in a custom tool. It means the row access policy sees the rep (or the agent's service user), not `SYSADMIN`.

<!-- listing: 01_custom_tools.sql | from: CREATE OR REPLACE PROCEDURE COMMERCIAL.AI.GET_TERRITORY_RX( | to: EXECUTE AS CALLER -->
```sql
CREATE OR REPLACE PROCEDURE COMMERCIAL.AI.GET_TERRITORY_RX(
    TERRITORY_ID     VARCHAR,
    WEEK_ENDING_DATE DATE,
    TRACE_ID         VARCHAR DEFAULT 'none'
  )
  COPY GRANTS
  RETURNS VARIANT
  LANGUAGE SQL
  COMMENT = 'MCP tool get_territory_rx v1.0.0: TRx, NRx, NBRx by product and TRx share for one territory and week.'
  EXECUTE AS CALLER
```
<!-- /listing -->

**Step 2: tag the query, safely.** The tool writes `{"agent":"field","tool":"get_territory_rx","trace":"..."}` into the session's `QUERY_TAG`. The trace ID comes from outside, so it is checked against a strict pattern before it is concatenated into SQL.

<!-- listing: 01_custom_tools.sql | from:   -- 1. Tag every query this call makes. | to: EXECUTE IMMEDIATE :tag_stmt; -->
```sql
  -- 1. Tag every query this call makes.
  safe_trace := IFF(REGEXP_LIKE(trace_id, '^[A-Za-z0-9-]{1,64}$'), trace_id, 'invalid');
  tag_stmt := 'ALTER SESSION SET QUERY_TAG = ''' ||
              TO_JSON(OBJECT_CONSTRUCT('agent', 'field', 'tool', 'get_territory_rx', 'trace', safe_trace)) ||
              '''';
  EXECUTE IMMEDIATE :tag_stmt;
```
<!-- /listing -->

**Step 3: reuse the certified metrics.** The tool reads TRx and share from the semantic view instead of writing its own `SUM` and division. One definition, as Chapter 8 requires.

<!-- listing: 01_custom_tools.sql | from:   -- 3. Market share at territory and week grain | to:     AND week = :week_ending_date; -->
```sql
  -- 3. Market share at territory and week grain (never by product).
  SELECT OBJECT_CONSTRUCT('trx_market_share', ROUND(trx_market_share, 3),
                          'data_through', data_through)
    INTO :share
  FROM SEMANTIC_VIEW(
         COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY
         METRICS rx.trx_market_share
         DIMENSIONS territory.territory_code, rx.week, rx.data_through
       )
  WHERE territory_code = :territory_id
    AND week = :week_ending_date;
```
<!-- /listing -->

**Step 4: the MCP server specification for the custom tool.** The description tells the client's model when to use the tool. The annotations tell the client the tool is read-only and does not reach outside Snowflake. They are hints, not enforcement; the grants are the enforcement.

<!-- listing: 02_mcp_server.sql | from:       - name: "get_territory_rx" | to:             required: ["territory_id", "week_ending_date"] -->
```sql
      - name: "get_territory_rx"
        type: "GENERIC"
        identifier: "COMMERCIAL.AI.GET_TERRITORY_RX"
        title: "Territory weekly prescriptions"
        description: "Returns TRx, NRx, and NBRx by product, and TRx market share, for one territory and one week ending Friday. Use when the user names a territory ID such as NE-01-BOS-02."
        annotations:
          readOnlyHint: true
          destructiveHint: false
          idempotentHint: true
          openWorldHint: false
        config:
          type: "procedure"
          warehouse: "WH_AGENT_FIELD"
          query_timeout: 60
          input_schema:
            type: "object"
            properties:
              territory_id:
                type: "string"
                description: "Territory ID, for example NE-01-BOS-02"
              week_ending_date:
                type: "string"
                description: "Week ending date (a Friday) in YYYY-MM-DD format"
              trace_id:
                type: "string"
                description: "Caller trace ID for audit, letters, digits, and hyphens only"
            required: ["territory_id", "week_ending_date"]
```
<!-- /listing -->

**Step 5: the semantic view and search service as tools.** Each points at an object by fully qualified name. No `SYSTEM_EXECUTE_SQL` tool is exposed: an agent that can run arbitrary SQL is only as safe as the broadest privilege of its role.

<!-- listing: 02_mcp_server.sql | from:       - name: "hcp360-metrics" | to: Quote results verbatim -->
```sql
      - name: "hcp360-metrics"
        type: "CORTEX_ANALYST_MESSAGE"
        identifier: "COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY"
        title: "HCP 360 prescription metrics"
        description: "Turns a question about TRx, NRx, NBRx, or TRx market share by HCP, territory, product, market, or week into SQL over the certified HCP 360 semantic view, and returns the SQL and answer. Results are limited to the caller's territories."

      - name: "approved-content-search"
        type: "CORTEX_SEARCH_SERVICE_QUERY"
        identifier: "COMMERCIAL.AI.CSS_APPROVED_FIELD_CONTENT"
        title: "Approved field content search"
        description: "Searches MLR-approved, field-internal content (visual aid text, objection handlers, Prescribing Information excerpts). Quote results verbatim with the document title and approval ID."
```
<!-- /listing -->

**Step 6: delegated sign-in with OAuth.** One integration serves every rep. `ALLOWED_ROLES_LIST` limits the roles a token can carry, and secondary roles are off.

<!-- listing: 03_client_authentication.sql | from: CREATE SECURITY INTEGRATION IF NOT EXISTS OAUTH_MCP_FIELD_TOOLS | to: ALLOWED_ROLES_LIST = ('FIELD_REP_NE'); -->
```sql
CREATE SECURITY INTEGRATION IF NOT EXISTS OAUTH_MCP_FIELD_TOOLS
  TYPE = OAUTH
  OAUTH_CLIENT = CUSTOM
  ENABLED = TRUE
  OAUTH_CLIENT_TYPE = 'CONFIDENTIAL'
  -- Must match the callback URI your MCP client shows exactly. For claude.ai
  -- it is typically https://claude.ai/api/mcp/auth_callback; Cursor and
  -- VS Code show their own (use OAUTH_ALTERNATE_REDIRECT_URIS for extras).
  OAUTH_REDIRECT_URI = '<redirect URI shown by your MCP client>'
  OAUTH_USE_SECONDARY_ROLES = NONE
  ALLOWED_ROLES_LIST = ('FIELD_REP_NE');
```
<!-- /listing -->

**Step 7: the client configuration (OAuth).**

<!-- listing: mcp-client-config.oauth.json -->
```json
{
  "mcpServers": {
    "snowflake-hcp360-field-tools": {
      "url": "https://<orgname>-<account_name>.snowflakecomputing.com/api/v2/databases/COMMERCIAL/schemas/AI/mcp-servers/FIELD_TOOLS_MCP",
      "auth": {
        "CLIENT_ID": "${env:MCP_CLIENT_ID}",
        "CLIENT_SECRET": "${env:MCP_CLIENT_SECRET}"
      }
    }
  }
}
```
<!-- /listing -->

**Step 8: autonomous access with a token restricted to one role.** A service user can only use a programmatic access token while a network policy applies to it, which Example D1 already set up.

<!-- listing: 03_client_authentication.sql | from: ALTER USER SVC_AGENT_FIELD ADD PROGRAMMATIC ACCESS TOKEN | to: COMMENT = 'MCP access -->
```sql
ALTER USER SVC_AGENT_FIELD ADD PROGRAMMATIC ACCESS TOKEN AGENT_FIELD_MCP_PAT
  ROLE_RESTRICTION = 'AGENT_FIELD_READ'
  DAYS_TO_EXPIRY = 30
  COMMENT = 'MCP access for the server-side field agent host. Rotate monthly. Ticket COMMDATA-1190.';
```
<!-- /listing -->

<!-- listing: mcp-client-config.pat.json -->
```json
{
  "mcpServers": {
    "snowflake-hcp360-field-tools": {
      "type": "http",
      "url": "https://<orgname>-<account_name>.snowflakecomputing.com/api/v2/databases/COMMERCIAL/schemas/AI/mcp-servers/FIELD_TOOLS_MCP",
      "headers": {
        "Authorization": "Bearer ${SNOWFLAKE_PAT}"
      }
    }
  }
}
```
<!-- /listing -->

### What to notice

- **Server access is not tool access.** USAGE on `FIELD_TOOLS_MCP` lets a role connect and list tools. Calling `hcp360-metrics` still needs SELECT on the semantic view; calling `get_territory_rx` still needs USAGE on the procedure. Revoke one privilege and exactly one tool stops working.
- **Delegated and autonomous are different risk profiles.** With OAuth the rep's identity, territories, and audit trail apply. With the service user's token, the agent's own mapping applies, and the token is a bearer secret: anyone who holds it is the agent until it expires. Prefer OAuth for people and keep tokens short-lived and role-restricted for machines.
- **Two servers, two styles.** `FIELD_TOOLS_MCP` lets the client's model pick tools itself. `FIELD_ASSISTANT_MCP` gives the client one tool, the Cortex Agent, which Snowflake recommends for business data because orchestration then stays inside Snowflake's governance.
- **Hostnames use hyphens.** MCP clients have trouble with underscores in hostnames, so `my_org-my_account` must become `my-org-my-account` in the URL.
- **Watch for loops.** A client that calls a Cortex Agent tool which itself calls an MCP server that calls back into an agent can loop. Snowflake caps recursion at 10 invocations, but the cost of 10 nested agent runs is already high.

### Verification status

| File | Status |
|---|---|
| `01_custom_tools.sql` | Syntax checked against CREATE PROCEDURE (Snowflake Scripting), Working with variables, EXECUTE IMMEDIATE, caller's and owner's rights, and the SEMANTIC_VIEW clause on docs.snowflake.com on 2026-10-23. Not executed. Querying SEMANTIC_VIEW inside a procedure with bind variables was not tested. |
| `02_mcp_server.sql` | Syntax checked against CREATE MCP SERVER, the Snowflake-managed MCP server guide, SHOW MCP SERVERS, and DESCRIBE MCP SERVER on 2026-10-23. Not executed. The `required` list in `input_schema` and string-to-DATE conversion of `week_ending_date` are not confirmed. |
| `03_client_authentication.sql` | Syntax checked against the MCP guide's OAuth section, ALTER USER ... ADD PROGRAMMATIC ACCESS TOKEN, and Using programmatic access tokens on 2026-10-23. Not executed. |
| `mcp-client-config.oauth.json` | Matches the Cursor `mcp.json` example in the Snowflake MCP guide (2026-10-23). Valid JSON (checked with `python3 -m json.tool`). |
| `mcp-client-config.pat.json` | Not verified against a specific client's documentation: the `type`/`url`/`headers` layout and `${VAR}` expansion are client-specific. Valid JSON. |

### What production would add

- A review step for tool descriptions, because the client's model reads them as instructions. Pin the approved descriptions (Book 1 Example C2 pins tool-description hashes) and treat any change as a versioned contract change (Example D7).
- Monitoring of `QUERY_HISTORY` by `QUERY_TAG`, with alerts on unusual call volume per tool, and the `agent_type` column to separate agent queries from human ones.
- External OAuth with the corporate identity provider (Okta or Entra ID) bound to the schema, so reps sign in with SSO and offboarding is immediate.
- An evaluation suite that calls each tool through MCP with known inputs and compares outputs to the expected values in Examples D1 and D2.
- A gateway in front of the server if you need controls Snowflake does not provide (per-user rate limits, PII redaction in responses, a kill switch per tool); Example D5 shows how to host one.
- Token rotation automated by the secrets manager, with `DAYS_TO_EXPIRY` short enough that a leaked token is useful for days, not months.
