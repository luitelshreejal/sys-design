-- =============================================================================
-- Example D3, file 02: the Snowflake-managed MCP server
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE MCP SERVER" (https://docs.snowflake.com/en/sql-reference/sql/create-mcp-server)
--   "Snowflake-managed MCP server" (tool types, GENERIC tool config, tool
--     annotations, access control, URL format, limitations)
--     (https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp)
--   "GRANT <privileges> ... TO ROLE" (MCP SERVER: USAGE, MODIFY)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--   * The "required" list inside input_schema is standard JSON Schema; the
--     Snowflake examples show only "type" and "properties", so confirm that
--     "required" is accepted.
--   * The week_ending_date argument is passed as a JSON string and relies on
--     Snowflake converting it to the procedure's DATE parameter. Test this.
--
-- What the managed MCP server is
--   MCP (Model Context Protocol) is the open standard that agent clients such
--   as Claude, ChatGPT, and Cursor use to discover and call tools. Snowflake
--   can host an MCP server as a schema object: no container, no code. Each
--   tool in the YAML specification points at a governed Snowflake object:
--     CORTEX_ANALYST_MESSAGE      a semantic view (text to SQL)
--     CORTEX_SEARCH_SERVICE_QUERY a Cortex Search service
--     GENERIC                     a UDF or stored procedure
--     CORTEX_AGENT_RUN            a whole Cortex Agent
--     SYSTEM_EXECUTE_SQL          arbitrary SQL (deliberately NOT used here)
--
-- Access is layered: USAGE on the MCP server lets a role connect and list
-- tools, but each tool still needs its own privilege (SELECT on the semantic
-- view, USAGE on the search service or procedure). The server never grants
-- more than the caller already has.
--
-- The server URL is:
--   https://<orgname>-<account_name>.snowflakecomputing.com/api/v2/databases/COMMERCIAL/schemas/AI/mcp-servers/FIELD_TOOLS_MCP
-- Use hyphens, not underscores, in the account part of the hostname.
-- =============================================================================

USE ROLE SYSADMIN;

-- Who may create MCP servers in this schema: the platform role only.
-- (SYSADMIN owns COMMERCIAL.AI, so it already holds CREATE MCP SERVER.)

CREATE OR REPLACE MCP SERVER COMMERCIAL.AI.FIELD_TOOLS_MCP
  FROM SPECIFICATION $$
    tools:
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

      - name: "get_hcp_profile"
        type: "GENERIC"
        identifier: "COMMERCIAL.AI.GET_HCP_PROFILE"
        title: "HCP profile by NPI"
        description: "Returns name, specialty, state, and territory for one HCP by 10-digit NPI, if the HCP is in the caller's territories. Does not return consent status."
        annotations:
          readOnlyHint: true
          destructiveHint: false
          idempotentHint: true
          openWorldHint: false
        config:
          type: "procedure"
          warehouse: "WH_AGENT_FIELD"
          query_timeout: 30
          input_schema:
            type: "object"
            properties:
              hcp_npi:
                type: "string"
                description: "10-digit National Provider Identifier"
              trace_id:
                type: "string"
                description: "Caller trace ID for audit, letters, digits, and hyphens only"
            required: ["hcp_npi"]
  $$;

-- -----------------------------------------------------------------------------
-- Alternative recommended by Snowflake for business users: expose one Cortex
-- Agent as the only tool, and let the agent orchestrate the tools above.
-- The client then has one governed entry point instead of four.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE MCP SERVER COMMERCIAL.AI.FIELD_ASSISTANT_MCP
  FROM SPECIFICATION $$
    tools:
      - name: "field_assistant"
        type: "CORTEX_AGENT_RUN"
        identifier: "COMMERCIAL.AI.FIELD_ASSISTANT"
        title: "Field Assistant (HCP 360)"
        description: "Answers governed questions about prescriptions, market share, and approved content for the caller's territories."
        annotations:
          openWorldHint: false
  $$;

-- -----------------------------------------------------------------------------
-- Grants. USAGE on a server lets a role connect and discover tools; it does
-- not let the role call a tool it has no privilege on.
-- -----------------------------------------------------------------------------
USE ROLE SECURITYADMIN;
GRANT USAGE ON MCP SERVER COMMERCIAL.AI.FIELD_TOOLS_MCP     TO ROLE AGENT_FIELD_READ;
GRANT USAGE ON MCP SERVER COMMERCIAL.AI.FIELD_ASSISTANT_MCP TO ROLE AGENT_FIELD_READ;

-- Inspect what was created.
DESCRIBE MCP SERVER COMMERCIAL.AI.FIELD_TOOLS_MCP;
SHOW MCP SERVERS IN SCHEMA COMMERCIAL.AI;
SHOW GRANTS ON MCP SERVER COMMERCIAL.AI.FIELD_TOOLS_MCP;
