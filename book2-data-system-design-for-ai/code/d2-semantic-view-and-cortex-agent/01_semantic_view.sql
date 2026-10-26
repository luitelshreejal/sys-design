-- =============================================================================
-- Example D2, file 01: the semantic view over the commercial mart
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE SEMANTIC VIEW" (https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view)
--   "Querying semantic views" (SEMANTIC_VIEW clause)
--     (https://docs.snowflake.com/en/user-guide/views-semantic/querying)
-- Not verified: not executed (no Snowflake account in the authoring environment).
--   AI_VERIFIED_QUERIES is deliberately not used: the clause syntax is
--   documented, but the expected form of the SQL inside a verified query was
--   not confirmed, so it is left for the engineer to add and test.
--
-- What a semantic view is (Book 2 Chapter 8, section 8.7)
--   A schema-level object that writes down, once, how the business talks about
--   the data: which tables exist (TABLES), how they join (RELATIONSHIPS),
--   row-level values (FACTS), the things you group by (DIMENSIONS), and the
--   numbers you aggregate (METRICS). Cortex Analyst and Cortex Agents read it
--   to turn a question such as "What was Cardiozen TRx share in Boston North
--   last week?" into SQL that uses the certified definitions.
--
-- It is built over the secure agent views from Example D1, so the territory
-- row access policy applies to every query that goes through it.
--
-- Clause order matters: TABLES, RELATIONSHIPS, FACTS, DIMENSIONS, METRICS,
-- then COMMENT and the AI_* instructions, then COPY GRANTS.
--
-- Snowflake asks that no personal or regulated data be put in metadata, so
-- comments and synonyms below describe columns; they never contain values.
-- =============================================================================

USE ROLE SYSADMIN;

CREATE OR REPLACE SEMANTIC VIEW COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY

  TABLES (
    rx AS COMMERCIAL.AGENT_SERVING.V_HCP_PRESCRIBER_WEEKLY
      PRIMARY KEY (hcp_master_id, product_id, week_ending_date)
      WITH SYNONYMS ('prescriber weekly', 'HCP 360 weekly', 'prescription facts')
      COMMENT = 'HCP 360 Prescriber Weekly v2.1: one row per HCP, product, and week ending Friday. Source: IQVIA Xponent-style weekly Rx.',
    hcp AS COMMERCIAL.AGENT_SERVING.V_HCP_DIM
      PRIMARY KEY (hcp_master_id)
      WITH SYNONYMS ('prescriber', 'physician', 'doctor', 'HCP')
      COMMENT = 'Healthcare professionals from the MDM golden record',
    product AS COMMERCIAL.AGENT_SERVING.V_PRODUCT_DIM
      PRIMARY KEY (product_id)
      WITH SYNONYMS ('brand', 'drug', 'product')
      COMMENT = 'Products in the heart failure market, ours and competitors',
    territory AS COMMERCIAL.AGENT_SERVING.V_TERRITORY_DIM
      PRIMARY KEY (territory_id)
      WITH SYNONYMS ('sales territory', 'geography')
      COMMENT = 'Sales territory hierarchy: territory, district, region'
  )

  RELATIONSHIPS (
    rx_to_hcp AS rx (hcp_master_id) REFERENCES hcp,
    rx_to_product AS rx (product_id) REFERENCES product,
    rx_to_territory AS rx (territory_id) REFERENCES territory
  )

  FACTS (
    rx.trx AS trx_units
      COMMENT = 'TRx units for one HCP, product, and week, net of reversals (BR-HCP-05)',
    rx.nrx AS nrx_units
      COMMENT = 'NRx units: new prescriptions, excluding refills beyond the first',
    rx.nbrx AS nbrx_units
      COMMENT = 'NBRx units: prescriptions for patients new to the brand',
    rx.company_trx AS IFF(is_company_product, trx_units, 0)
      COMMENT = 'TRx counted only when the product is our brand; numerator of market share'
  )

  DIMENSIONS (
    rx.week AS week_ending_date
      WITH SYNONYMS ('week', 'reporting week', 'data week', 'week ending')
      COMMENT = 'Enterprise reporting week, ending Friday',
    rx.data_through AS vendor_data_through_date
      COMMENT = 'Last date covered by the vendor file for this row',
    hcp.hcp_name AS hcp_full_name
      WITH SYNONYMS ('doctor name', 'prescriber name')
      COMMENT = 'HCP name as held in MDM',
    hcp.hcp_npi AS npi
      WITH SYNONYMS ('NPI', 'NPI number')
      COMMENT = 'National Provider Identifier (10 digits)',
    hcp.hcp_specialty AS specialty_desc
      WITH SYNONYMS ('specialty')
      COMMENT = 'Primary specialty from MDM',
    hcp.hcp_state AS state_code
      COMMENT = 'Two-letter state of the primary practice address',
    product.brand AS product_name
      WITH SYNONYMS ('product name', 'brand name')
      COMMENT = 'Product name, including strength',
    product.market AS market_name
      WITH SYNONYMS ('therapeutic market', 'competitive market')
      COMMENT = 'Competitive market the product is measured in',
    product.is_our_brand AS is_company_product
      WITH SYNONYMS ('our brand', 'company product')
      COMMENT = 'TRUE for our products, FALSE for competitors',
    territory.territory AS territory_name
      WITH SYNONYMS ('territory name')
      COMMENT = 'Territory name',
    territory.territory_code AS territory_id
      COMMENT = 'Territory ID, for example NE-01-BOS-02',
    territory.district AS district_name
      COMMENT = 'District name',
    territory.region AS region_name
      COMMENT = 'Region name'
  )

  METRICS (
    rx.total_trx AS SUM(rx.trx)
      WITH SYNONYMS ('TRx', 'total prescriptions', 'total Rx', 'scripts')
      COMMENT = 'Total prescriptions (units), net of reversals. Certified. Valid by product, week, territory, specialty, HCP. Not for patient-level analysis.',
    rx.total_nrx AS SUM(rx.nrx)
      WITH SYNONYMS ('NRx', 'new prescriptions', 'new Rx')
      COMMENT = 'New prescriptions (units). Certified. Same valid grains as TRx.',
    rx.total_nbrx AS SUM(rx.nbrx)
      WITH SYNONYMS ('NBRx', 'new to brand', 'new-to-brand prescriptions', 'new patient starts')
      COMMENT = 'New-to-brand prescriptions (units). Certified. Same valid grains as TRx.',
    rx.trx_market_share AS DIV0(SUM(rx.company_trx), SUM(rx.trx))
      WITH SYNONYMS ('market share', 'share', 'TRx share', 'share of market')
      COMMENT = 'Our TRx divided by all TRx in the market, as a fraction (0.25 means 25 percent). Valid by market, week, territory, HCP. Never group or filter by product: share within one product is always 0 or 1.'
  )

  COMMENT = 'HCP 360 commercial metrics for agents and BI. Owner: Brand Analytics (metric definitions), Commercial Data (structure). Version 2.1.0.'

  AI_SQL_GENERATION 'Weeks end on Friday. When the user says last week, use the latest week_ending_date available. Market share is a fraction; present it as a percentage with one decimal place. Never break market share down by product or brand; compute it by market, territory, week, or HCP. Do not sum market share across territories or weeks; recompute it from the metric at the requested grain. Always state the week and the data_through date in the answer.'

  AI_QUESTION_CATEGORIZATION 'Questions about individual patients, patient counts below the HCP level, consent status, or anything outside prescriptions and market share are out of scope: reply that this assistant cannot answer them.'

  COPY GRANTS;
