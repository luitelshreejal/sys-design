-- =============================================================================
-- Example D1, file 00: sample databases, schemas, and tables (invented data)
-- -----------------------------------------------------------------------------
-- Syntax checked against these docs.snowflake.com pages on 2026-10-23:
--   "CREATE TABLE", "INSERT" (standard DDL/DML, nothing feature-specific here).
-- Not verified: nothing in this file needs a feature-specific check, but it has
-- not been executed, because there is no Snowflake account in the authoring
-- environment.
--
-- What this file is for
--   D1 to D5 assume a COMMERCIAL database that holds the HCP 360 data product.
--   In a real account Terraform (Example D6) and the data engineering pipeline
--   create these objects. This file creates a tiny, invented copy so the rest
--   of the examples can be read (and run in a sandbox) end to end.
--
-- Every name, number, NPI, and patient token below is invented.
-- =============================================================================

USE ROLE SYSADMIN;

CREATE DATABASE IF NOT EXISTS COMMERCIAL
  COMMENT = 'Commercial analytics: HCP 360 data product, agent-serving views, AI objects';

-- One schema per purpose, so grants can be given per schema.
CREATE SCHEMA IF NOT EXISTS COMMERCIAL.HCP360
  COMMENT = 'HCP 360 data product (Gold). Owned by HCP 360 data engineering.';
CREATE SCHEMA IF NOT EXISTS COMMERCIAL.PATIENT
  COMMENT = 'Patient-level, de-identified claims events (APLD-style). Restricted.';
CREATE SCHEMA IF NOT EXISTS COMMERCIAL.GOVERNANCE
  COMMENT = 'Entitlement tables and policies that protect COMMERCIAL';
CREATE SCHEMA IF NOT EXISTS COMMERCIAL.AGENT_SERVING
  COMMENT = 'Secure views that agents are allowed to read';
CREATE SCHEMA IF NOT EXISTS COMMERCIAL.AI
  COMMENT = 'Semantic views, Cortex Search services, agents, MCP servers, tools';
CREATE SCHEMA IF NOT EXISTS COMMERCIAL.CONTENT
  COMMENT = 'MLR-approved content, chunked for retrieval (used in Example D2)';

-- -----------------------------------------------------------------------------
-- Dimensions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS COMMERCIAL.HCP360.HCP_DIM (
  hcp_master_id        VARCHAR(20)  NOT NULL,  -- MDM golden record ID
  npi                  VARCHAR(10),            -- National Provider Identifier
  hcp_full_name        VARCHAR(200),
  specialty_code       VARCHAR(10),
  specialty_desc       VARCHAR(100),
  state_code           VARCHAR(2),
  primary_territory_id VARCHAR(12),            -- territory of the primary account
  consent_status       VARCHAR(16),            -- opt_in, opt_out, not_specified (Restricted)
  CONSTRAINT pk_hcp_dim PRIMARY KEY (hcp_master_id)
);

CREATE TABLE IF NOT EXISTS COMMERCIAL.HCP360.PRODUCT_DIM (
  product_id         VARCHAR(10)  NOT NULL,
  product_name       VARCHAR(100),
  market_id          VARCHAR(10),            -- the competitive market the product sits in
  market_name        VARCHAR(100),
  is_company_product BOOLEAN,                -- TRUE for our brand, FALSE for competitors
  CONSTRAINT pk_product_dim PRIMARY KEY (product_id)
);

CREATE TABLE IF NOT EXISTS COMMERCIAL.HCP360.TERRITORY_DIM (
  territory_id   VARCHAR(12) NOT NULL,
  territory_name VARCHAR(100),
  district_name  VARCHAR(100),
  region_name    VARCHAR(100),
  CONSTRAINT pk_territory_dim PRIMARY KEY (territory_id)
);

-- -----------------------------------------------------------------------------
-- The HCP 360 Prescriber Weekly fact: one row per HCP, product, and week.
-- TRx, NRx, and NBRx are derived from IQVIA Xponent-style weekly data
-- (see Book 2 Chapter 8, BR-HCP-05). Units, not scripts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS COMMERCIAL.HCP360.HCP_PRESCRIBER_WEEKLY (
  hcp_master_id            VARCHAR(20)   NOT NULL,
  product_id               VARCHAR(10)   NOT NULL,
  territory_id             VARCHAR(12),
  week_ending_date         DATE          NOT NULL,  -- enterprise week, ending Friday
  trx_units                NUMBER(18,2)  NOT NULL,  -- total prescriptions, net of reversals
  nrx_units                NUMBER(18,2)  NOT NULL,  -- new prescriptions (new and refill-1)
  nbrx_units               NUMBER(18,2)  NOT NULL,  -- new-to-brand prescriptions
  reach_flag               NUMBER(1)     NOT NULL,  -- 1 if the HCP had a call this week
  vendor_data_through_date DATE          NOT NULL,
  load_batch_id            VARCHAR(40)   NOT NULL
);

-- -----------------------------------------------------------------------------
-- Patient-level events (de-identified). patient_token is a vendor token, not a
-- name or member ID, but it is still treated as PHI-adjacent: it can be linked
-- across datasets. Birth year and 3-digit ZIP are quasi-identifiers.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS COMMERCIAL.PATIENT.NBRX_PATIENT_EVENTS (
  patient_token          VARCHAR(64)  NOT NULL,
  patient_birth_year     NUMBER(4),
  patient_zip3           VARCHAR(3),
  hcp_master_id          VARCHAR(20)  NOT NULL,
  territory_id           VARCHAR(12),
  product_id             VARCHAR(10)  NOT NULL,
  event_week_ending_date DATE         NOT NULL,
  payer_channel          VARCHAR(20)             -- COMMERCIAL, MEDICARE_D, MEDICAID, CASH
);

-- -----------------------------------------------------------------------------
-- Invented sample rows
-- -----------------------------------------------------------------------------
INSERT INTO COMMERCIAL.HCP360.TERRITORY_DIM VALUES
  ('NE-01-BOS-02', 'Boston North',   'Boston',   'Northeast'),
  ('NE-01-BOS-03', 'Boston South',   'Boston',   'Northeast'),
  ('TX-07-SE-02',  'Houston East',   'Houston',  'South Central');

INSERT INTO COMMERCIAL.HCP360.PRODUCT_DIM VALUES
  ('PRD-0231', 'Cardiozen 10 mg', 'MKT-HF', 'Heart failure market', TRUE),
  ('PRD-0412', 'Vasorel 25 mg',   'MKT-HF', 'Heart failure market', FALSE),
  ('PRD-0533', 'Lipitrex 40 mg',  'MKT-HF', 'Heart failure market', FALSE);

INSERT INTO COMMERCIAL.HCP360.HCP_DIM VALUES
  ('HCP-00481276', '1234567893', 'Dana Whitfield, MD', 'CD',  'Cardiology',        'MA', 'NE-01-BOS-02', 'opt_in'),
  ('HCP-00519034', '1245319599', 'Priya Raman, MD',    'IM',  'Internal medicine', 'MA', 'NE-01-BOS-03', 'not_specified'),
  ('HCP-00602117', '1093817446', 'Luis Ortega, DO',    'CD',  'Cardiology',        'TX', 'TX-07-SE-02',  'opt_out');

INSERT INTO COMMERCIAL.HCP360.HCP_PRESCRIBER_WEEKLY VALUES
  ('HCP-00481276', 'PRD-0231', 'NE-01-BOS-02', '2026-10-09', 14.00, 5.00, 3.00, 1, '2026-10-09', 'B20261012-01'),
  ('HCP-00481276', 'PRD-0412', 'NE-01-BOS-02', '2026-10-09', 22.00, 6.00, 2.00, 1, '2026-10-09', 'B20261012-01'),
  ('HCP-00519034', 'PRD-0231', 'NE-01-BOS-03', '2026-10-09',  6.00, 2.00, 1.00, 0, '2026-10-09', 'B20261012-01'),
  ('HCP-00519034', 'PRD-0533', 'NE-01-BOS-03', '2026-10-09', 11.00, 3.00, 0.00, 0, '2026-10-09', 'B20261012-01'),
  ('HCP-00602117', 'PRD-0231', 'TX-07-SE-02',  '2026-10-09',  9.00, 4.00, 2.00, 1, '2026-10-09', 'B20261012-01'),
  ('HCP-00602117', 'PRD-0412', 'TX-07-SE-02',  '2026-10-09', 18.00, 5.00, 1.00, 1, '2026-10-09', 'B20261012-01');

INSERT INTO COMMERCIAL.PATIENT.NBRX_PATIENT_EVENTS VALUES
  ('TKN-7f3a91c2e8', 1958, '021', 'HCP-00481276', 'NE-01-BOS-02', 'PRD-0231', '2026-10-09', 'MEDICARE_D'),
  ('TKN-2b44d0a913', 1971, '021', 'HCP-00481276', 'NE-01-BOS-02', 'PRD-0231', '2026-10-09', 'COMMERCIAL'),
  ('TKN-91ce55f0a7', 1964, '773', 'HCP-00602117', 'TX-07-SE-02',  'PRD-0231', '2026-10-09', 'COMMERCIAL');
