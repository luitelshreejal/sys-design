-- =============================================================================
-- Example D1, file 04: entitlements, row access policy, masking policies, and
-- the secure views the agent reads
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE ROW ACCESS POLICY"
--     (https://docs.snowflake.com/en/sql-reference/sql/create-row-access-policy)
--   "CREATE MASKING POLICY"
--     (https://docs.snowflake.com/en/sql-reference/sql/create-masking-policy)
--   "ALTER VIEW" (ADD ROW ACCESS POLICY, MODIFY COLUMN ... SET MASKING POLICY)
--     (https://docs.snowflake.com/en/sql-reference/sql/alter-view)
--   "Agent identity" (SYS_CONTEXT('SNOWFLAKE$CURRENT', 'IS_AGENT_ACTIVATED'))
--     (https://docs.snowflake.com/en/user-guide/agent-identity)
--   "CREATE VIEW" (SECURE)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--
-- The rules this file implements (Book 2 Chapter 7, section 7.4):
--   1. Rows: a user, human or agent, sees only rows for territories mapped to
--      that user in COMMERCIAL.GOVERNANCE.USER_TERRITORY_MAP on today's date.
--      Holders of COMM_ALL_TERRITORIES (HQ analytics) see every territory.
--   2. Patient columns: patient_token, patient_birth_year, and patient_zip3 are
--      masked for everyone except approved roles, and are ALWAYS masked when
--      the session is agent-active, even if a human with an approved role is
--      asking through an agent.
--   3. The agent reads only secure views in COMMERCIAL.AGENT_SERVING. The views
--      leave out columns the agent never needs (consent_status, load_batch_id).
-- =============================================================================

USE ROLE USERADMIN;
-- Roles referenced by the policies. They are granted to people elsewhere.
CREATE ROLE IF NOT EXISTS COMM_ALL_TERRITORIES
  COMMENT = 'HQ analytics: may see all territories in COMMERCIAL';
CREATE ROLE IF NOT EXISTS PATIENT_TOKEN_READ
  COMMENT = 'Approved data science users: may see patient tokens and quasi-identifiers';

USE ROLE SYSADMIN;

-- -----------------------------------------------------------------------------
-- 1. The entitlement table. It is itself a governed data product: loaded from
--    the alignment system, refreshed when alignments change, and writable only
--    by the alignment pipeline. Snowflake recommends keeping a mapping table in
--    the same database as the data it protects, so it lives in COMMERCIAL.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS COMMERCIAL.GOVERNANCE.USER_TERRITORY_MAP (
  user_name      VARCHAR(256) NOT NULL,  -- Snowflake user name, as CURRENT_USER() returns it
  territory_id   VARCHAR(12)  NOT NULL,
  effective_from DATE         NOT NULL,
  effective_to   DATE         NOT NULL,
  source_system  VARCHAR(40)  NOT NULL   -- e.g. ALIGNMENT_2026_C4, or AGENT_SCOPE_APPROVAL
);

-- The field assistant serves the Boston district, so the service user is
-- mapped to the two Boston territories only. A rep in Houston would need a
-- different agent identity (or delegated access as the rep, see WALKTHROUGH).
INSERT INTO COMMERCIAL.GOVERNANCE.USER_TERRITORY_MAP VALUES
  ('SVC_AGENT_FIELD', 'NE-01-BOS-02', '2026-10-01', '2026-12-31', 'AGENT_SCOPE_APPROVAL'),
  ('SVC_AGENT_FIELD', 'NE-01-BOS-03', '2026-10-01', '2026-12-31', 'AGENT_SCOPE_APPROVAL'),
  ('JMORALES',        'TX-07-SE-02',  '2026-10-01', '2026-12-31', 'ALIGNMENT_2026_C4');

-- -----------------------------------------------------------------------------
-- 2. Row access policy by territory.
--    The argument is named row_territory_id so it can never be confused with
--    the mapping table's own territory_id column.
-- -----------------------------------------------------------------------------
CREATE ROW ACCESS POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.RAP_TERRITORY
  AS (row_territory_id VARCHAR) RETURNS BOOLEAN ->
    IS_ROLE_IN_SESSION('COMM_ALL_TERRITORIES')
    OR EXISTS (
      SELECT 1
      FROM COMMERCIAL.GOVERNANCE.USER_TERRITORY_MAP m
      WHERE m.user_name = CURRENT_USER()
        AND m.territory_id = row_territory_id
        AND CURRENT_DATE() BETWEEN m.effective_from AND m.effective_to
    )
  COMMENT = 'Rows visible only for territories mapped to the current user (BR-HCP-06). Owner: Commercial Data.';

-- -----------------------------------------------------------------------------
-- 3. Masking policies for patient fields.
--    The first branch checks whether the session is agent-active (a Cortex
--    Agent, Snowflake-managed MCP server, agentic OAuth, or SERVICE_AGENT
--    user). It returns the string 'TRUE' or 'FALSE', so it is cast to BOOLEAN.
--    Order matters: the agent check comes before the role check, so an agent
--    never sees patient values, whoever it is acting for.
-- -----------------------------------------------------------------------------
CREATE MASKING POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.MP_PATIENT_TOKEN
  AS (val VARCHAR) RETURNS VARCHAR ->
    CASE
      WHEN SYS_CONTEXT('SNOWFLAKE$CURRENT', 'IS_AGENT_ACTIVATED')::BOOLEAN = TRUE THEN '***MASKED***'
      WHEN IS_ROLE_IN_SESSION('PATIENT_TOKEN_READ') THEN val
      ELSE '***MASKED***'
    END
  COMMENT = 'Patient token: visible to PATIENT_TOKEN_READ only, never to agents.';

-- Quasi-identifiers are nulled rather than replaced with a string, so numeric
-- and text columns keep their data types.
CREATE MASKING POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.MP_PATIENT_QUASI_ID_TEXT
  AS (val VARCHAR) RETURNS VARCHAR ->
    CASE
      WHEN SYS_CONTEXT('SNOWFLAKE$CURRENT', 'IS_AGENT_ACTIVATED')::BOOLEAN = TRUE THEN NULL
      WHEN IS_ROLE_IN_SESSION('PATIENT_TOKEN_READ') THEN val
      ELSE NULL
    END
  COMMENT = 'Patient quasi-identifier (text, e.g. ZIP3): PATIENT_TOKEN_READ only, never agents.';

CREATE MASKING POLICY IF NOT EXISTS COMMERCIAL.GOVERNANCE.MP_PATIENT_QUASI_ID_NUMBER
  AS (val NUMBER) RETURNS NUMBER ->
    CASE
      WHEN SYS_CONTEXT('SNOWFLAKE$CURRENT', 'IS_AGENT_ACTIVATED')::BOOLEAN = TRUE THEN NULL
      WHEN IS_ROLE_IN_SESSION('PATIENT_TOKEN_READ') THEN val
      ELSE NULL
    END
  COMMENT = 'Patient quasi-identifier (number, e.g. birth year): PATIENT_TOKEN_READ only, never agents.';

-- -----------------------------------------------------------------------------
-- 4. Secure views for the agent. SECURE hides the view definition from roles
--    that do not own it and stops the optimizer from leaking filtered rows.
--    Each view selects only the columns the agent needs.
-- -----------------------------------------------------------------------------
CREATE SECURE VIEW IF NOT EXISTS COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY
  COMMENT = 'Agent view of HCP 360 Prescriber Weekly. Territory-scoped. Version 2.1.'
AS
-- market_id and is_company_product are copied onto each row so market share
-- (our TRx divided by all TRx in the market) can be computed from one table.
SELECT f.hcp_master_id, f.product_id, p.market_id, p.is_company_product,
       f.territory_id, f.week_ending_date,
       f.trx_units, f.nrx_units, f.nbrx_units, f.reach_flag, f.vendor_data_through_date
FROM COMMERCIAL.HCP360.HCP_PRESCRIBER_WEEKLY f
JOIN COMMERCIAL.HCP360.PRODUCT_DIM p
  ON p.product_id = f.product_id;

CREATE SECURE VIEW IF NOT EXISTS COMMERCIAL.AGENT_SERVING.V_HCP_DIM
  COMMENT = 'Agent view of HCPs. consent_status deliberately excluded (Restricted).'
AS
SELECT hcp_master_id, npi, hcp_full_name, specialty_code, specialty_desc,
       state_code, primary_territory_id
FROM COMMERCIAL.HCP360.HCP_DIM;

CREATE SECURE VIEW IF NOT EXISTS COMMERCIAL.AGENT_SERVING.V_PRODUCT_DIM
  COMMENT = 'Agent view of products and markets.'
AS
SELECT product_id, product_name, market_id, market_name, is_company_product
FROM COMMERCIAL.HCP360.PRODUCT_DIM;

CREATE SECURE VIEW IF NOT EXISTS COMMERCIAL.AGENT_SERVING.V_TERRITORY_DIM
  COMMENT = 'Agent view of the territory hierarchy.'
AS
SELECT territory_id, territory_name, district_name, region_name
FROM COMMERCIAL.HCP360.TERRITORY_DIM;

CREATE SECURE VIEW IF NOT EXISTS COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  COMMENT = 'Agent view of new-to-brand patient events. Patient fields masked for agents.'
AS
SELECT patient_token, patient_birth_year, patient_zip3,
       hcp_master_id, territory_id, product_id, event_week_ending_date, payer_channel
FROM COMMERCIAL.PATIENT.NBRX_PATIENT_EVENTS;

-- -----------------------------------------------------------------------------
-- 5. Attach the policies to the agent's views.
-- -----------------------------------------------------------------------------
ALTER VIEW COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY
  ADD ROW ACCESS POLICY COMMERCIAL.GOVERNANCE.RAP_TERRITORY ON (territory_id);

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_HCP_DIM
  ADD ROW ACCESS POLICY COMMERCIAL.GOVERNANCE.RAP_TERRITORY ON (primary_territory_id);

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  ADD ROW ACCESS POLICY COMMERCIAL.GOVERNANCE.RAP_TERRITORY ON (territory_id);

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  MODIFY COLUMN patient_token SET MASKING POLICY COMMERCIAL.GOVERNANCE.MP_PATIENT_TOKEN;

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  MODIFY COLUMN patient_zip3 SET MASKING POLICY COMMERCIAL.GOVERNANCE.MP_PATIENT_QUASI_ID_TEXT;

ALTER VIEW COMMERCIAL.AGENT_SERVING.V_NBRX_PATIENT_EVENTS
  MODIFY COLUMN patient_birth_year SET MASKING POLICY COMMERCIAL.GOVERNANCE.MP_PATIENT_QUASI_ID_NUMBER;

-- Production note: attach the same policies to the base tables in HCP360 and
-- PATIENT as well, so every path to the data (BI, notebooks, agents) is
-- protected, not only the agent views. This file protects the agent path,
-- which is the scope of Example D1.
