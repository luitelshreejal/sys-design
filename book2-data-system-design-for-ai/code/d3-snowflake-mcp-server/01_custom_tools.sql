-- =============================================================================
-- Example D3, file 01: two custom tools as stored procedures
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE PROCEDURE", Snowflake Scripting handler
--     (https://docs.snowflake.com/en/sql-reference/sql/create-procedure)
--   "Working with variables" (SELECT ... INTO :variable)
--     (https://docs.snowflake.com/en/developer-guide/snowflake-scripting/variables)
--   "EXECUTE IMMEDIATE" (https://docs.snowflake.com/en/sql-reference/sql/execute-immediate)
--   "Understanding caller's rights and owner's rights stored procedures"
--     (caller's rights procedures can set the caller's session parameters)
--     (https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-rights)
--   "SEMANTIC_VIEW" clause (https://docs.snowflake.com/en/sql-reference/constructs/semantic_view)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--   Querying SEMANTIC_VIEW(...) from inside a stored procedure with bind
--   variables in the outer WHERE clause follows the documented syntax but was
--   not tested.
--
-- Why stored procedures, and why EXECUTE AS CALLER
--   The MCP server (file 02) exposes these procedures as GENERIC tools. With
--   EXECUTE AS CALLER the procedure runs with the role and user of whoever
--   called the tool, so the territory row access policy and patient masking
--   from Example D1 apply exactly as they would to a direct query. An owner's
--   rights procedure would run as its owner (here SYSADMIN), which could see
--   every territory: that would turn a tool into a way around the policies.
--
-- Why the tools read the semantic view
--   get_territory_rx gets TRx, NRx, NBRx, and share from the certified
--   metrics in Example D2. It does not recompute share in its own SQL, so the
--   tool cannot drift from the definition that BI and the agent use.
--
-- QUERY_TAG
--   Each tool sets a JSON QUERY_TAG such as
--     {"agent":"field","tool":"get_territory_rx","trace":"7f2c9a10-..."}
--   so QUERY_HISTORY can tie every query to a tool call and a trace. The trace
--   ID comes from the caller; it is checked against a strict pattern before it
--   is placed in the ALTER SESSION statement, which prevents SQL injection.
-- =============================================================================

USE ROLE SYSADMIN;

-- -----------------------------------------------------------------------------
-- Tool 1: get_territory_rx
-- -----------------------------------------------------------------------------
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
AS
$$
DECLARE
  safe_trace VARCHAR;
  tag_stmt   VARCHAR;
  products   VARIANT;
  share      VARIANT;
BEGIN
  -- 1. Tag every query this call makes.
  safe_trace := IFF(REGEXP_LIKE(trace_id, '^[A-Za-z0-9-]{1,64}$'), trace_id, 'invalid');
  tag_stmt := 'ALTER SESSION SET QUERY_TAG = ''' ||
              TO_JSON(OBJECT_CONSTRUCT('agent', 'field', 'tool', 'get_territory_rx', 'trace', safe_trace)) ||
              '''';
  EXECUTE IMMEDIATE :tag_stmt;

  -- 2. Product-level volumes from the certified metrics.
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
           'product', brand,
           'is_company_product', is_our_brand,
           'trx', total_trx,
           'nrx', total_nrx,
           'nbrx', total_nbrx))
    INTO :products
  FROM SEMANTIC_VIEW(
         COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY
         METRICS rx.total_trx, rx.total_nrx, rx.total_nbrx
         DIMENSIONS territory.territory_code, rx.week, product.brand, product.is_our_brand
       )
  WHERE territory_code = :territory_id
    AND week = :week_ending_date;

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

  -- 4. One predictable JSON shape. If the territory is not in the caller's
  --    entitlements, the row access policy returns no rows and products is NULL.
  RETURN OBJECT_CONSTRUCT(
    'contract', 'get_territory_rx/1.0.0',
    'territory_id', territory_id,
    'week_ending_date', week_ending_date,
    'products', COALESCE(products, ARRAY_CONSTRUCT()),
    'summary', share,
    'note', IFF(products IS NULL, 'No rows: the territory or week is outside your access or has no data.', NULL)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Tool 2: get_hcp_profile
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE COMMERCIAL.AI.GET_HCP_PROFILE(
    HCP_NPI  VARCHAR,
    TRACE_ID VARCHAR DEFAULT 'none'
  )
  COPY GRANTS
  RETURNS VARIANT
  LANGUAGE SQL
  COMMENT = 'MCP tool get_hcp_profile v1.0.0: name, specialty, state, and territory for one NPI in the caller territories.'
  EXECUTE AS CALLER
AS
$$
DECLARE
  safe_trace VARCHAR;
  tag_stmt   VARCHAR;
  profile    VARIANT;
BEGIN
  safe_trace := IFF(REGEXP_LIKE(trace_id, '^[A-Za-z0-9-]{1,64}$'), trace_id, 'invalid');
  tag_stmt := 'ALTER SESSION SET QUERY_TAG = ''' ||
              TO_JSON(OBJECT_CONSTRUCT('agent', 'field', 'tool', 'get_hcp_profile', 'trace', safe_trace)) ||
              '''';
  EXECUTE IMMEDIATE :tag_stmt;

  -- consent_status is not in V_HCP_DIM, so this tool cannot return it.
  SELECT OBJECT_CONSTRUCT(
           'hcp_master_id', h.hcp_master_id,
           'npi', h.npi,
           'name', h.hcp_full_name,
           'specialty', h.specialty_desc,
           'state', h.state_code,
           'territory_id', h.primary_territory_id,
           'territory_name', t.territory_name)
    INTO :profile
  FROM COMMERCIAL.AGENT_SERVING.V_HCP_DIM h
  LEFT JOIN COMMERCIAL.AGENT_SERVING.V_TERRITORY_DIM t
    ON t.territory_id = h.primary_territory_id
  WHERE h.npi = :hcp_npi
  LIMIT 1;

  RETURN OBJECT_CONSTRUCT(
    'contract', 'get_hcp_profile/1.0.0',
    'hcp', profile,
    'note', IFF(profile IS NULL, 'No HCP with this NPI in your territories.', NULL)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants: USAGE on each procedure (with its argument types) to an access role.
-- -----------------------------------------------------------------------------
USE ROLE USERADMIN;
CREATE ROLE IF NOT EXISTS AR_FIELD_AGENT_TOOLS
  COMMENT = 'Access role: USAGE on the field agent custom tools in COMMERCIAL.AI.';

USE ROLE SECURITYADMIN;
GRANT USAGE ON DATABASE COMMERCIAL TO ROLE AR_FIELD_AGENT_TOOLS;
GRANT USAGE ON SCHEMA COMMERCIAL.AI TO ROLE AR_FIELD_AGENT_TOOLS;
GRANT USAGE ON PROCEDURE COMMERCIAL.AI.GET_TERRITORY_RX(VARCHAR, DATE, VARCHAR) TO ROLE AR_FIELD_AGENT_TOOLS;
GRANT USAGE ON PROCEDURE COMMERCIAL.AI.GET_HCP_PROFILE(VARCHAR, VARCHAR)        TO ROLE AR_FIELD_AGENT_TOOLS;
GRANT ROLE AR_FIELD_AGENT_TOOLS TO ROLE AGENT_FIELD_READ;

-- -----------------------------------------------------------------------------
-- Quick test as a role that holds AGENT_FIELD_READ
-- -----------------------------------------------------------------------------
-- CALL COMMERCIAL.AI.GET_TERRITORY_RX('NE-01-BOS-02', '2026-10-09'::DATE, 'trace-0001');
--   Expected: two products (Cardiozen 10 mg 14 TRx, Vasorel 25 mg 22 TRx) and
--   summary.trx_market_share = 0.389.
-- CALL COMMERCIAL.AI.GET_TERRITORY_RX('TX-07-SE-02', '2026-10-09'::DATE, 'trace-0002');
--   Expected as SVC_AGENT_FIELD: empty products and the "outside your access" note.
-- SELECT query_tag FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY_BY_USER(RESULT_LIMIT => 5));
--   Expected: {"agent":"field","tool":"get_territory_rx","trace":"trace-0002"}
