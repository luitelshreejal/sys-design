-- =============================================================================
-- Example D1, file 03: network rule and network policy for the service user
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE NETWORK RULE" (https://docs.snowflake.com/en/sql-reference/sql/create-network-rule)
--   "CREATE NETWORK POLICY" (https://docs.snowflake.com/en/sql-reference/sql/create-network-policy)
--   "ALTER USER" (NETWORK_POLICY object parameter)
--     (https://docs.snowflake.com/en/sql-reference/sql/alter-user)
--   "Using programmatic access tokens for authentication" (network policy
--     requirement for SERVICE users)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--
-- What this does
--   The agent runtime (for example the MCP gateway in Example D5, or an agent
--   host in the company cloud) connects from a small, known set of egress IPs.
--   The network policy says: SVC_AGENT_FIELD may connect only from those IPs.
--   A stolen private key is then useless from anywhere else.
--
--   A network policy is also a prerequisite if this SERVICE user is ever given
--   a programmatic access token (PAT): Snowflake only lets SERVICE users
--   generate or use a PAT when they are subject to a network policy.
--
-- The IP ranges below are documentation ranges (RFC 5737), not real addresses.
-- =============================================================================

USE ROLE SYSADMIN;

-- Network rules are schema objects. Keep account-level security objects in a
-- small admin database that only the platform team can write to.
CREATE DATABASE IF NOT EXISTS PLATFORM_ADMIN
  COMMENT = 'Platform security objects: network rules, shared policies';
CREATE SCHEMA IF NOT EXISTS PLATFORM_ADMIN.NETWORK
  COMMENT = 'Ingress and egress network rules';

GRANT USAGE ON DATABASE PLATFORM_ADMIN TO ROLE SECURITYADMIN;
GRANT USAGE, CREATE NETWORK RULE ON SCHEMA PLATFORM_ADMIN.NETWORK TO ROLE SECURITYADMIN;

USE ROLE SECURITYADMIN;

-- INGRESS + IPV4: who may connect TO Snowflake.
CREATE NETWORK RULE IF NOT EXISTS PLATFORM_ADMIN.NETWORK.NR_AGENT_RUNTIME_IPS
  TYPE = IPV4
  VALUE_LIST = ('198.51.100.16/28', '203.0.113.40')
  MODE = INGRESS
  COMMENT = 'Egress IPs of the agent runtime (NAT gateway). Owner: Platform. Change via CHG ticket.';

CREATE NETWORK POLICY IF NOT EXISTS NP_AGENT_FIELD
  ALLOWED_NETWORK_RULE_LIST = ('PLATFORM_ADMIN.NETWORK.NR_AGENT_RUNTIME_IPS')
  COMMENT = 'SVC_AGENT_FIELD may connect only from the agent runtime.';

-- Attach the policy to the one user it is for (not to the whole account).
ALTER USER SVC_AGENT_FIELD SET NETWORK_POLICY = NP_AGENT_FIELD;
