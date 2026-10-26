-- =============================================================================
-- Example D1, file 05: least-privilege grants
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "GRANT <privileges> ... TO ROLE"
--     (https://docs.snowflake.com/en/sql-reference/sql/grant-privilege)
--   "Using SQL commands to create and manage semantic views", section
--     "Granting privileges on semantic views" (SELECT, FUTURE SEMANTIC VIEWS)
--     (https://docs.snowflake.com/en/user-guide/views-semantic/sql)
--   "Snowflake-managed MCP server", section "Access control" (the database
--     role SNOWFLAKE.CORTEX_AGENT_USER)
--     (https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp)
--   "GRANT DATABASE ROLE"
-- Not verified: not executed (no Snowflake account in the authoring environment).
--
-- Least privilege, written out:
--   * USAGE on the database and on exactly two schemas (AGENT_SERVING, AI).
--   * SELECT on five named views, one by one. No ALL VIEWS, no FUTURE VIEWS in
--     AGENT_SERVING: a new view must be granted on purpose, after review.
--   * SELECT on semantic views in COMMERCIAL.AI. This is a FUTURE grant
--     because the semantic view is created later, in Example D2. Only the
--     semantic layer team can create semantic views in COMMERCIAL.AI.
--   * No grant at all on COMMERCIAL.HCP360 or COMMERCIAL.PATIENT base tables.
--   * No CREATE privilege anywhere. The agent cannot create or change objects.
-- =============================================================================

USE ROLE SECURITYADMIN;

-- -----------------------------------------------------------------------------
-- Access role: agent-serving views
-- -----------------------------------------------------------------------------
GRANT USAGE ON DATABASE COMMERCIAL               TO ROLE AR_HCP360_AGENT_SELECT;
GRANT USAGE ON SCHEMA COMMERCIAL.AGENT_SERVING   TO ROLE AR_HCP360_AGENT_SELECT;

GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_HCP_DIM               TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_PRODUCT_DIM           TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_TERRITORY_DIM         TO ROLE AR_HCP360_AGENT_SELECT;
GRANT SELECT ON VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS   TO ROLE AR_HCP360_AGENT_SELECT;

-- -----------------------------------------------------------------------------
-- Access role: semantic views (created in Example D2)
-- Querying a semantic view needs SELECT on the semantic view only, not on the
-- tables or views behind it. Row access and masking policies on those views
-- still apply to the querying session.
-- -----------------------------------------------------------------------------
GRANT USAGE ON DATABASE COMMERCIAL TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;
GRANT USAGE ON SCHEMA COMMERCIAL.AI TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;
GRANT SELECT ON FUTURE SEMANTIC VIEWS IN SCHEMA COMMERCIAL.AI TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;

-- -----------------------------------------------------------------------------
-- Cortex access for the functional role.
-- SNOWFLAKE.CORTEX_AGENT_USER lets the role run Cortex Agents. Granting this
-- narrower database role is preferred over SNOWFLAKE.CORTEX_USER, which opens
-- every Cortex AI function. Check current docs for which database role your
-- account's Cortex features require before go-live.
-- -----------------------------------------------------------------------------
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_AGENT_USER TO ROLE AGENT_FIELD_READ;

-- Grants on the Cortex Search service, the agent, the custom tools, and the
-- MCP server are made in Examples D2 and D3, next to the objects themselves.
