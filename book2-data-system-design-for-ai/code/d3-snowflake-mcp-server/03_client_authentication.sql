-- =============================================================================
-- Example D3, file 03: how MCP clients authenticate
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "Snowflake-managed MCP server", sections "Set up OAuth authentication",
--     "Role behavior in OAuth sessions", "Network policies for MCP clients",
--     "MCP server security recommendations"
--     (https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp)
--   "ALTER USER ... ADD PROGRAMMATIC ACCESS TOKEN (PAT)"
--     (https://docs.snowflake.com/en/sql-reference/sql/alter-user-add-programmatic-access-token)
--   "Using programmatic access tokens for authentication"
--     (https://docs.snowflake.com/en/user-guide/programmatic-access-tokens)
--   "CREATE USER", "GRANT ROLE"
-- Not verified: not executed (no Snowflake account in the authoring environment).
--
-- Two ways to connect, matching the two agent models in Book 2 Chapter 16:
--
--   A. Delegated (recommended for people): a field rep connects Claude,
--      ChatGPT, or Cursor to the MCP server and signs in to Snowflake with
--      OAuth. The session runs AS THE REP, with the rep's default role, so the
--      rep's own territories apply. Snowflake recommends OAuth over tokens.
--
--   B. Autonomous (for a server-side agent host): a backend agent connects as
--      SVC_AGENT_FIELD with a programmatic access token (PAT) restricted to
--      AGENT_FIELD_READ and short-lived. Use this only where no human is in
--      the loop, and store the token in a secrets manager.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Delegated access with Snowflake OAuth
-- -----------------------------------------------------------------------------
USE ROLE USERADMIN;

-- The functional role for Northeast field reps. It receives the same access
-- roles as the agent's role, so a rep and the agent see the same governed
-- objects, each limited to their own territories by the row access policy.
CREATE ROLE IF NOT EXISTS FIELD_REP_NE
  COMMENT = 'Functional role for Northeast field reps using AI assistants over MCP.';

USE ROLE SECURITYADMIN;
GRANT ROLE AR_HCP360_AGENT_SELECT        TO ROLE FIELD_REP_NE;
GRANT ROLE AR_COMMERCIAL_SEMANTIC_SELECT TO ROLE FIELD_REP_NE;
GRANT ROLE AR_APPROVED_CONTENT_SEARCH    TO ROLE FIELD_REP_NE;
GRANT ROLE AR_FIELD_AGENT_TOOLS          TO ROLE FIELD_REP_NE;
GRANT ROLE AR_WH_AGENT_FIELD_USAGE       TO ROLE FIELD_REP_NE;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_AGENT_USER TO ROLE FIELD_REP_NE;
GRANT USAGE ON MCP SERVER COMMERCIAL.AI.FIELD_TOOLS_MCP     TO ROLE FIELD_REP_NE;
GRANT USAGE ON MCP SERVER COMMERCIAL.AI.FIELD_ASSISTANT_MCP TO ROLE FIELD_REP_NE;
GRANT USAGE ON AGENT COMMERCIAL.AI.FIELD_ASSISTANT          TO ROLE FIELD_REP_NE;
GRANT ROLE FIELD_REP_NE TO ROLE SYSADMIN;

-- One OAuth integration can serve every user and every MCP server in the
-- account. ALLOWED_ROLES_LIST stops a token being issued for any other role.
-- Secondary roles are off, so the session uses exactly one role.
-- Use 'PUBLIC' with PKCE for clients that cannot keep a secret, such as
-- Claude Desktop; 'CONFIDENTIAL' for clients that can, such as Cursor.
USE ROLE ACCOUNTADMIN;

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

-- Retrieve the client ID and secret to paste into the MCP client. The
-- integration name must be uppercase here. Treat the output as a secret.
SELECT SYSTEM$SHOW_OAUTH_CLIENT_SECRETS('OAUTH_MCP_FIELD_TOOLS');

-- Each rep's DEFAULT_ROLE must be FIELD_REP_NE and DEFAULT_WAREHOUSE must be
-- set, because the OAuth session uses the user's default role and warehouse.
-- Example for one invented rep (normally done by SCIM from the IdP):
USE ROLE USERADMIN;
-- ALTER USER AKOWALSKI SET DEFAULT_ROLE = FIELD_REP_NE DEFAULT_WAREHOUSE = WH_AGENT_FIELD;
-- GRANT ROLE FIELD_REP_NE TO USER AKOWALSKI;
-- The rep's territories come from USER_TERRITORY_MAP (Example D1).

-- If the account has a network policy, it must allow the MCP client
-- provider's outbound IPs (for example the addresses Anthropic publishes for
-- Claude), because remote MCP calls come from the provider, not the browser.

-- -----------------------------------------------------------------------------
-- B. Autonomous access with a programmatic access token for SVC_AGENT_FIELD
--    A SERVICE user can only generate or use a PAT while it is subject to a
--    network policy (attached in Example D1, file 03).
-- -----------------------------------------------------------------------------
USE ROLE USERADMIN;

ALTER USER SVC_AGENT_FIELD ADD PROGRAMMATIC ACCESS TOKEN AGENT_FIELD_MCP_PAT
  ROLE_RESTRICTION = 'AGENT_FIELD_READ'
  DAYS_TO_EXPIRY = 30
  COMMENT = 'MCP access for the server-side field agent host. Rotate monthly. Ticket COMMDATA-1190.';
-- The token secret is shown once in the output. Put it straight into the
-- secrets manager; never in a config file, a ticket, or a chat.

-- The agent host then calls the MCP endpoint with the header
--   Authorization: Bearer <token secret>
-- For example, to list tools (the server answers tools/call with an SSE
-- stream, so the client must accept both content types):
--   curl -X POST \
--     "https://<orgname>-<account_name>.snowflakecomputing.com/api/v2/databases/COMMERCIAL/schemas/AI/mcp-servers/FIELD_TOOLS_MCP" \
--     -H "Authorization: Bearer $SNOWFLAKE_PAT" \
--     -H "Content-Type: application/json" \
--     -H "Accept: application/json, text/event-stream" \
--     -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
