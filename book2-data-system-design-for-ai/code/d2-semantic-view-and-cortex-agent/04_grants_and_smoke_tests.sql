-- =============================================================================
-- Example D2, file 04: grants for the new objects, and smoke tests
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "GRANT <privileges> ... TO ROLE" (SEMANTIC VIEW: SELECT; CORTEX SEARCH
--     SERVICE: USAGE; AGENT: USAGE)
--     (https://docs.snowflake.com/en/sql-reference/sql/grant-privilege)
--   "Querying semantic views" (https://docs.snowflake.com/en/user-guide/views-semantic/querying)
--   "SHOW SEMANTIC METRICS" (https://docs.snowflake.com/en/sql-reference/sql/show-semantic-metrics)
--   "SEARCH_PREVIEW (SNOWFLAKE.CORTEX)"
--     (https://docs.snowflake.com/en/sql-reference/functions/search_preview-snowflake-cortex)
--   "DATA_AGENT_RUN (SNOWFLAKE.CORTEX)"
--     (https://docs.snowflake.com/en/sql-reference/functions/data_agent_run-snowflake-cortex)
--   "CREATE ROLE", "GRANT ROLE"
-- Not verified: not executed (no Snowflake account in the authoring environment).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Grants
-- -----------------------------------------------------------------------------
USE ROLE USERADMIN;
CREATE ROLE IF NOT EXISTS AR_APPROVED_CONTENT_SEARCH
  COMMENT = 'Access role: USAGE on Cortex Search services over approved content.';

USE ROLE SECURITYADMIN;

-- The future grant from D1 already covers this semantic view. The explicit
-- grant is repeated so the intent is visible in SHOW GRANTS ON SEMANTIC VIEW.
GRANT SELECT ON SEMANTIC VIEW COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY
  TO ROLE AR_COMMERCIAL_SEMANTIC_SELECT;

GRANT USAGE ON DATABASE COMMERCIAL TO ROLE AR_APPROVED_CONTENT_SEARCH;
GRANT USAGE ON SCHEMA COMMERCIAL.AI TO ROLE AR_APPROVED_CONTENT_SEARCH;
GRANT USAGE ON CORTEX SEARCH SERVICE COMMERCIAL.AI.CSS_APPROVED_FIELD_CONTENT
  TO ROLE AR_APPROVED_CONTENT_SEARCH;
GRANT ROLE AR_APPROVED_CONTENT_SEARCH TO ROLE AGENT_FIELD_READ;

-- USAGE on the agent lets a role run it. MODIFY and MONITOR stay with the owner.
GRANT USAGE ON AGENT COMMERCIAL.AI.FIELD_ASSISTANT TO ROLE AGENT_FIELD_READ;

-- -----------------------------------------------------------------------------
-- 2. Smoke tests (run as a role that holds AGENT_FIELD_READ, ideally as the
--    service user SVC_AGENT_FIELD itself)
-- -----------------------------------------------------------------------------
SHOW SEMANTIC METRICS IN COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY;
-- Expected: TOTAL_TRX, TOTAL_NRX, TOTAL_NBRX, TRX_MARKET_SHARE with comments.

-- The certified numbers, straight from the semantic view.
SELECT * FROM SEMANTIC_VIEW(
    COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY
    DIMENSIONS territory.territory, rx.week
    METRICS rx.total_trx, rx.total_nrx, rx.total_nbrx, rx.trx_market_share
  )
  ORDER BY territory, week;
-- Expected as SVC_AGENT_FIELD, week ending 2026-10-09 (invented sample data):
--   Boston North: TRx 36, NRx 11, NBRx 5, share 14/36 = 0.389
--   Boston South: TRx 17, NRx 5,  NBRx 1, share 6/17  = 0.353
--   No Houston East row (row access policy).

-- Approved content search, filtered the same way the agent filters.
SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
  'COMMERCIAL.AI.CSS_APPROVED_FIELD_CONTENT',
  '{
     "query": "prior authorization concern",
     "columns": ["document_title", "mlr_approval_id", "chunk_text"],
     "filter": {"@eq": {"audience": "FIELD_INTERNAL"}},
     "limit": 3
   }'
);
-- Expected: the objection handler CZN-US-0207 first. The EXPIRED leave-behind
-- never appears, because it was never indexed.

-- One end-to-end agent run.
SELECT TRY_PARSE_JSON(
  SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
    'COMMERCIAL.AI.FIELD_ASSISTANT',
    $${
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": "What was Cardiozen TRx market share in Boston North for the latest week?" }
          ]
        }
      ]
    }$$
  )
) AS agent_response;
-- Expected: an answer of about 38.9 percent for the week ending 2026-10-09,
-- with the week and data-through date stated, and the generated SQL visible
-- in the tool result.
