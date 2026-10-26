-- =============================================================================
-- Example D2, file 02: a Cortex Search service over MLR-approved content
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE CORTEX SEARCH SERVICE"
--     (https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search)
--   "CREATE WAREHOUSE", "CREATE TABLE", "GRANT DATABASE ROLE"
-- Not verified: not executed (no Snowflake account in the authoring environment).
--   The embedding model name is one listed on the CREATE CORTEX SEARCH
--   SERVICE page; check regional availability for your account before use.
--
-- What Cortex Search is (Book 2 Chapter 10, "Data for Generative AI")
--   A managed hybrid (keyword plus vector) search index over a text column.
--   Snowflake embeds the text, keeps the index fresh within TARGET_LAG, and
--   serves queries. The agent uses it to quote approved field content, such
--   as the core visual aid or the approved objection handlers, instead of
--   letting the model improvise claims (an MLR and compliance risk).
--
-- The governance rule is in the source query: only chunks whose MLR approval
-- status is APPROVED are indexed. Withdrawn or expired material drops out of
-- the index at the next refresh. The content pipeline sets approval_status to
-- EXPIRED on the expiry date; the source query does not use CURRENT_DATE(),
-- because time-dependent filters do not suit incremental refresh.
-- =============================================================================

USE ROLE SYSADMIN;

-- -----------------------------------------------------------------------------
-- 1. Chunked, approved content (invented rows). In production this table is
--    loaded by the content pipeline from the MLR system (Veeva PromoMats or
--    similar), one row per chunk of an approved document.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS COMMERCIAL.CONTENT.APPROVED_CONTENT_CHUNKS (
  chunk_id        VARCHAR(40)   NOT NULL,  -- primary key, TEXT as Cortex Search requires
  document_id     VARCHAR(40)   NOT NULL,
  document_title  VARCHAR(300)  NOT NULL,
  mlr_approval_id VARCHAR(40)   NOT NULL,  -- for example CZN-US-0193 (invented)
  product_id      VARCHAR(10)   NOT NULL,
  audience        VARCHAR(20)   NOT NULL,  -- FIELD_INTERNAL or HCP_FACING
  content_type    VARCHAR(30)   NOT NULL,  -- VISUAL_AID, OBJECTION_HANDLER, PI_EXCERPT
  approval_status VARCHAR(20)   NOT NULL,  -- APPROVED, EXPIRED, WITHDRAWN
  expiry_date     DATE          NOT NULL,
  chunk_text      VARCHAR       NOT NULL,
  CONSTRAINT pk_content_chunks PRIMARY KEY (chunk_id)
);

INSERT INTO COMMERCIAL.CONTENT.APPROVED_CONTENT_CHUNKS VALUES
  ('CZN-0193-003', 'CZN-0193', 'Cardiozen core visual aid 2026', 'CZN-US-0193', 'PRD-0231',
   'FIELD_INTERNAL', 'VISUAL_AID', 'APPROVED', '2027-06-30',
   'Cardiozen is indicated to reduce the risk of hospitalization for heart failure in adults with chronic heart failure. See full Prescribing Information.'),
  ('CZN-0207-001', 'CZN-0207', 'Cardiozen objection handler: formulary access', 'CZN-US-0207', 'PRD-0231',
   'FIELD_INTERNAL', 'OBJECTION_HANDLER', 'APPROVED', '2027-03-31',
   'If an HCP raises prior authorization concerns, direct them to the access support program and the approved payer coverage sheet. Do not discuss pricing.'),
  ('CZN-0150-002', 'CZN-0150', 'Cardiozen launch leave-behind 2025', 'CZN-US-0150', 'PRD-0231',
   'HCP_FACING', 'VISUAL_AID', 'EXPIRED', '2026-06-30',
   'Superseded launch messaging. Not for use.');

-- -----------------------------------------------------------------------------
-- 2. A dedicated warehouse for building and refreshing the index. Snowflake
--    recommends one warehouse per search service, no larger than MEDIUM, so
--    indexing does not compete with agent queries.
-- -----------------------------------------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS WH_AI_INDEXING WITH
  WAREHOUSE_SIZE = XSMALL
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Builds and refreshes Cortex Search indexes in COMMERCIAL.AI';

-- The creating role needs the Cortex embedding functions.
USE ROLE ACCOUNTADMIN;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_EMBED_USER TO ROLE SYSADMIN;

-- -----------------------------------------------------------------------------
-- 3. The search service
--    ON          the column that is searched
--    PRIMARY KEY lets refreshes touch only changed rows (must be TEXT)
--    ATTRIBUTES  columns a caller may filter on (the agent filters on audience)
--    TARGET_LAG  how stale the index may be; content changes daily at most
-- -----------------------------------------------------------------------------
USE ROLE SYSADMIN;

CREATE OR REPLACE CORTEX SEARCH SERVICE COMMERCIAL.AI.CSS_APPROVED_FIELD_CONTENT
  ON chunk_text
  PRIMARY KEY (chunk_id)
  ATTRIBUTES product_id, audience, content_type
  WAREHOUSE = WH_AI_INDEXING
  TARGET_LAG = '1 day'
  EMBEDDING_MODEL = 'snowflake-arctic-embed-l-v2.0'
  REQUEST_LOGGING = TRUE
  COMMENT = 'MLR-approved field content only. Owner: Commercial Content Operations.'
AS (
  SELECT
    chunk_id,
    chunk_text,
    document_id,
    document_title,
    mlr_approval_id,
    product_id,
    audience,
    content_type,
    expiry_date
  FROM COMMERCIAL.CONTENT.APPROVED_CONTENT_CHUNKS
  WHERE approval_status = 'APPROVED'
);
