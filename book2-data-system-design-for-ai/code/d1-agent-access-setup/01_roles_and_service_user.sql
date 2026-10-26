-- =============================================================================
-- Example D1, file 01: roles and the agent's service user
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE USER" (https://docs.snowflake.com/en/sql-reference/sql/create-user)
--   "ALTER USER ... ADD KEY PAIR"
--     (https://docs.snowflake.com/en/sql-reference/sql/alter-user-add-key-pair)
--   "Key-pair authentication and key-pair rotation"
--     (https://docs.snowflake.com/en/user-guide/key-pair-auth)
--   "GRANT ROLE", "CREATE ROLE"
--   "Agent identity" (https://docs.snowflake.com/en/user-guide/agent-identity)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--
-- The design (Book 2 Chapter 7, "Users, roles, and grants"):
--   * Access roles hold privileges on objects. They are never granted to people.
--       AR_HCP360_AGENT_SELECT        SELECT on the agent-serving views
--       AR_COMMERCIAL_SEMANTIC_SELECT SELECT on semantic views in COMMERCIAL.AI
--       AR_WH_AGENT_FIELD_USAGE       USAGE on the agent's own warehouse
--   * One functional role describes the job: AGENT_FIELD_READ, "the field
--     assistant agent may read governed HCP 360 data". It receives the access
--     roles and is granted to the service user.
--   * One service user, SVC_AGENT_FIELD, is the agent's identity. It has no
--     password. It signs in with a key pair that is restricted to one role.
-- =============================================================================

-- USERADMIN creates users and roles. SECURITYADMIN manages grants.
USE ROLE USERADMIN;

-- -----------------------------------------------------------------------------
-- 1. Access roles (privilege holders)
-- -----------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS AR_HCP360_AGENT_SELECT
  COMMENT = 'Access role: SELECT on COMMERCIAL.AGENT_SERVING views. Never granted to people.';
CREATE ROLE IF NOT EXISTS AR_COMMERCIAL_SEMANTIC_SELECT
  COMMENT = 'Access role: SELECT on semantic views in COMMERCIAL.AI. Never granted to people.';
CREATE ROLE IF NOT EXISTS AR_WH_AGENT_FIELD_USAGE
  COMMENT = 'Access role: USAGE on warehouse WH_AGENT_FIELD.';

-- -----------------------------------------------------------------------------
-- 2. The functional role for the field assistant agent
-- -----------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS AGENT_FIELD_READ
  COMMENT = 'Functional role for the field assistant agent. Read-only, territory-scoped, patient fields masked. Owner: Commercial Data.';

-- -----------------------------------------------------------------------------
-- 3. Role hierarchy
--    Access roles roll up into the functional role, and the functional role
--    rolls up into SYSADMIN so administrators can see what the agent sees.
-- -----------------------------------------------------------------------------
USE ROLE SECURITYADMIN;

GRANT ROLE AR_HCP360_AGENT_SELECT        TO ROLE AGENT_FIELD_READ;
GRANT ROLE AR_COMMERCIAL_SEMANTIC_SELECT TO ROLE AGENT_FIELD_READ;
GRANT ROLE AR_WH_AGENT_FIELD_USAGE       TO ROLE AGENT_FIELD_READ;
GRANT ROLE AGENT_FIELD_READ              TO ROLE SYSADMIN;

-- -----------------------------------------------------------------------------
-- 4. The service user
--    TYPE = SERVICE means: no password, no MFA enrolment, no SSO. The user can
--    only authenticate with non-interactive methods such as a key pair.
--
--    Note on TYPE = SERVICE_AGENT: since July 2026 Snowflake also offers
--    TYPE = SERVICE_AGENT for autonomous AI agents. Every session it opens is
--    marked "agent-active", which policies can detect (see file 04) and which
--    QUERY_HISTORY labels as EXTERNAL_AGENT. This example keeps TYPE = SERVICE
--    because it matches the Terraform provider resource used in Example D6
--    (snowflake_service_user). Evaluate SERVICE_AGENT with your security team.
--
--    DEFAULT_SECONDARY_ROLES = () switches secondary roles off, so the agent
--    can never use the union of several roles. Only AGENT_FIELD_READ applies.
--
--    QUERY_TAG is a JSON string that every query from this user carries unless
--    the caller overrides it. Tools in Example D3 set "tool" and "trace" per
--    call, so cost and audit reports can group queries by agent, tool, and
--    trace. The value is plain JSON text; QUERY_HISTORY stores it as given.
-- -----------------------------------------------------------------------------
USE ROLE USERADMIN;

CREATE USER IF NOT EXISTS SVC_AGENT_FIELD
  TYPE = SERVICE
  DEFAULT_ROLE = AGENT_FIELD_READ
  DEFAULT_WAREHOUSE = WH_AGENT_FIELD
  DEFAULT_SECONDARY_ROLES = ()
  COMMENT = 'Service identity for the field assistant agent. Key-pair only. Owner: Commercial Data. Review quarterly.'
  QUERY_TAG = '{"agent": "field", "tool": "none", "trace": "none"}';

-- The user needs the role before a key pair can be restricted to it.
USE ROLE SECURITYADMIN;
GRANT ROLE AGENT_FIELD_READ TO USER SVC_AGENT_FIELD;

-- -----------------------------------------------------------------------------
-- 5. Key-pair authentication
--    The platform team generates the key pair outside Snowflake, for example:
--      openssl genrsa 2048 | openssl pkcs8 -topk8 -v2 aes-256-cbc -inform PEM -out svc_agent_field.p8
--      openssl rsa -in svc_agent_field.p8 -pubout -out svc_agent_field.pub
--    The private key goes into the secrets manager used by the agent runtime.
--    Only the public key (without the BEGIN/END lines) is pasted below.
--
--    ADD KEY PAIR (recommended by Snowflake) supports:
--      ROLE_RESTRICTION  the key can only open sessions as AGENT_FIELD_READ
--      DAYS_TO_EXPIRY    the key stops working after 90 days, forcing rotation
-- -----------------------------------------------------------------------------
USE ROLE USERADMIN;

ALTER USER SVC_AGENT_FIELD ADD KEY PAIR AGENT_FIELD_KEY_2026Q4
  PUBLIC_KEY = '<paste the public key body here, one line, no BEGIN/END lines>'
  ROLE_RESTRICTION = 'AGENT_FIELD_READ'
  DAYS_TO_EXPIRY = 90
  COMMENT = 'Issued 2026-10-23. Rotate before expiry. Ticket COMMDATA-1182.';

-- Older alternative that many accounts still use. It does not support role
-- restriction or expiry, so prefer ADD KEY PAIR where it is available:
--   ALTER USER SVC_AGENT_FIELD SET RSA_PUBLIC_KEY = '<public key body>';

-- The network policy is attached in file 03, after it has been created.
