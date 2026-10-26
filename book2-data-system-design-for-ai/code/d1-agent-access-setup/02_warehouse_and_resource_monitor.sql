-- =============================================================================
-- Example D1, file 02: a dedicated warehouse and a resource monitor
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE RESOURCE MONITOR"
--     (https://docs.snowflake.com/en/sql-reference/sql/create-resource-monitor)
--   "CREATE WAREHOUSE" (https://docs.snowflake.com/en/sql-reference/sql/create-warehouse)
--   "ALTER WAREHOUSE"
-- Not verified: not executed (no Snowflake account in the authoring environment).
--
-- Why the agent gets its own warehouse (Book 2 Chapter 7 "Warehouses as
-- boundaries" and Chapter 14 on cost):
--   * Cost attribution. Every credit the agent spends lands on WH_AGENT_FIELD,
--     so the monthly cost of the field assistant is one number.
--   * A hard cap. The resource monitor suspends the warehouse when the monthly
--     credit quota is used up. An agent stuck in a loop cannot spend more.
--   * A kill switch. Revoking USAGE on this warehouse, or suspending it, stops
--     the agent from running any query, without touching other workloads.
-- =============================================================================

-- Only account administrators can create resource monitors.
USE ROLE ACCOUNTADMIN;

CREATE RESOURCE MONITOR IF NOT EXISTS RM_AGENT_FIELD WITH
  CREDIT_QUOTA = 60                 -- credits per month; size from a pilot, then review
  FREQUENCY = MONTHLY
  START_TIMESTAMP = IMMEDIATELY
  TRIGGERS
    ON 50 PERCENT DO NOTIFY         -- early warning to account administrators
    ON 80 PERCENT DO NOTIFY
    ON 100 PERCENT DO SUSPEND       -- finish running queries, then stop
    ON 110 PERCENT DO SUSPEND_IMMEDIATE;  -- cancel running queries too

-- SYSADMIN owns warehouses by convention.
USE ROLE SYSADMIN;

CREATE WAREHOUSE IF NOT EXISTS WH_AGENT_FIELD WITH
  WAREHOUSE_TYPE = STANDARD
  WAREHOUSE_SIZE = XSMALL           -- agent queries hit a small, aggregated mart
  MAX_CLUSTER_COUNT = 1             -- no scale-out: concurrency spikes queue instead of costing more
  AUTO_SUSPEND = 60                 -- seconds idle before the warehouse stops billing
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Warehouse for the field assistant agent (SVC_AGENT_FIELD). Capped by RM_AGENT_FIELD.'
  STATEMENT_TIMEOUT_IN_SECONDS = 120        -- a generated query that runs longer is cancelled
  STATEMENT_QUEUED_TIMEOUT_IN_SECONDS = 60; -- do not let agent calls queue for minutes

-- Attach the monitor. A monitor does nothing until it is assigned.
USE ROLE ACCOUNTADMIN;
ALTER WAREHOUSE WH_AGENT_FIELD SET RESOURCE_MONITOR = RM_AGENT_FIELD;

-- Let the access role use (but not modify) the warehouse.
USE ROLE SECURITYADMIN;
GRANT USAGE ON WAREHOUSE WH_AGENT_FIELD TO ROLE AR_WH_AGENT_FIELD_USAGE;
