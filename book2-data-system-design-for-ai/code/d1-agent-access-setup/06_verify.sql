-- =============================================================================
-- Example D1, file 06: verification queries (run these in the design review)
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "SHOW GRANTS" (https://docs.snowflake.com/en/sql-reference/sql/show-grants)
--   "POLICY_REFERENCES" (https://docs.snowflake.com/en/sql-reference/functions/policy_references)
--   "SHOW USER KEY PAIRS" (https://docs.snowflake.com/en/sql-reference/sql/show-user-key-pairs)
--   "DESCRIBE USER", "SHOW PARAMETERS", "DESCRIBE NETWORK POLICY",
--   "SHOW RESOURCE MONITORS"
-- Not verified: not executed (no Snowflake account in the authoring environment).
-- The "Expected" comments describe what a correct setup should return.
-- =============================================================================

USE ROLE SECURITYADMIN;

-- -----------------------------------------------------------------------------
-- A. What can the agent's role do?
-- -----------------------------------------------------------------------------
SHOW GRANTS TO ROLE AGENT_FIELD_READ;
-- Expected: the three access roles (granted as ROLE), the database role
-- SNOWFLAKE.CORTEX_AGENT_USER, and later (D2, D3) USAGE on the search
-- service, agent, tools, and MCP server. Nothing with OWNERSHIP or CREATE.

SHOW GRANTS TO ROLE AR_HCP360_AGENT_SELECT;
-- Expected: USAGE on COMMERCIAL and COMMERCIAL.AGENT_SERVING, and SELECT on
-- exactly five views. No TABLE privileges.

SHOW GRANTS TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;
SHOW FUTURE GRANTS IN SCHEMA COMMERCIAL.AI;
-- Expected: SELECT on future SEMANTIC VIEWs in COMMERCIAL.AI.

SHOW GRANTS TO ROLE AR_WH_AGENT_FIELD_USAGE;
-- Expected: USAGE on WH_AGENT_FIELD only (not OPERATE, not MODIFY).

-- -----------------------------------------------------------------------------
-- B. Who holds the role?
-- -----------------------------------------------------------------------------
SHOW GRANTS OF ROLE AGENT_FIELD_READ;
-- Expected: granted to USER SVC_AGENT_FIELD and to ROLE SYSADMIN. Any human
-- user here is a finding for the access review.

SHOW GRANTS TO USER SVC_AGENT_FIELD;
-- Expected: AGENT_FIELD_READ only.

-- -----------------------------------------------------------------------------
-- C. How does the service user authenticate, and from where?
-- -----------------------------------------------------------------------------
DESCRIBE USER SVC_AGENT_FIELD;
-- Expected: TYPE = SERVICE, DEFAULT_ROLE = AGENT_FIELD_READ,
-- DEFAULT_SECONDARY_ROLES = [], no password set.

SHOW USER KEY PAIRS FOR USER SVC_AGENT_FIELD;
-- Expected: AGENT_FIELD_KEY_2026Q4 with role restriction AGENT_FIELD_READ and
-- an expiry date about 90 days out.

SHOW PARAMETERS LIKE 'NETWORK_POLICY' IN USER SVC_AGENT_FIELD;
DESCRIBE NETWORK POLICY NP_AGENT_FIELD;
-- Expected: NP_AGENT_FIELD, allowing only PLATFORM_ADMIN.NETWORK.NR_AGENT_RUNTIME_IPS.

SHOW PARAMETERS LIKE 'QUERY_TAG' IN USER SVC_AGENT_FIELD;
-- Expected: {"agent": "field", "tool": "none", "trace": "none"}

-- -----------------------------------------------------------------------------
-- D. Cost guardrails
-- -----------------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;
SHOW RESOURCE MONITORS LIKE 'RM_AGENT_FIELD';
SHOW WAREHOUSES LIKE 'WH_AGENT_FIELD';
-- Expected: XSMALL, max 1 cluster, auto-suspend 60, resource_monitor RM_AGENT_FIELD.

-- -----------------------------------------------------------------------------
-- E. Which policies protect the agent's views?
--    POLICY_REFERENCES is an Information Schema table function, so it is
--    called through the database that holds the views.
-- -----------------------------------------------------------------------------
USE ROLE SYSADMIN;

SELECT policy_name, policy_kind, ref_entity_name, ref_column_name, ref_arg_column_names, policy_status
FROM TABLE(
  COMMERCIAL.INFORMATION_SCHEMA.POLICY_REFERENCES(
    REF_ENTITY_NAME   => 'COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS',
    REF_ENTITY_DOMAIN => 'VIEW'
  )
);
-- Expected: RAP_TERRITORY (ROW_ACCESS_POLICY) on territory_id, and three
-- MASKING_POLICY rows on patient_token, patient_zip3, patient_birth_year.

-- Every object the territory policy is attached to:
SELECT ref_database_name, ref_schema_name, ref_entity_name, ref_entity_domain, ref_arg_column_names
FROM TABLE(
  COMMERCIAL.INFORMATION_SCHEMA.POLICY_REFERENCES(
    POLICY_NAME => 'COMMERCIAL.GOVERNANCE.RAP_TERRITORY'
  )
);
-- Expected: V_HCP_PRESCRIBER_WEEKLY, V_HCP_DIM, V_NBRX_PATIENT_EVENTS.

-- -----------------------------------------------------------------------------
-- F. Behaviour test. Run this block as SVC_AGENT_FIELD itself, for example
--    from the agent runtime host with SnowSQL or the Snowflake CLI using the
--    key pair. (An administrator cannot simply "become" the service user.)
-- -----------------------------------------------------------------------------
-- SELECT CURRENT_USER(), CURRENT_ROLE();
--   Expected: SVC_AGENT_FIELD, AGENT_FIELD_READ
--
-- SELECT territory_id, SUM(trx_units) AS trx
-- FROM COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY
-- GROUP BY territory_id;
--   Expected: only NE-01-BOS-02 and NE-01-BOS-03. No TX-07-SE-02 row.
--
-- SELECT patient_token, patient_birth_year, patient_zip3, payer_channel
-- FROM COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS;
--   Expected: two Boston rows, patient_token = '***MASKED***',
--   birth year and ZIP3 NULL, payer_channel visible.
--
-- SELECT COUNT(*) FROM COMMERCIAL.HCP360.HCP_PRESCRIBER_WEEKLY;
--   Expected: an error (object does not exist or not authorized).
