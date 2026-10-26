## Example D2: Semantic view, Cortex Search service, and Cortex Agent

Code: `code/d2-semantic-view-and-cortex-agent/`

### What this demonstrates

[Chapter 8 (Data Products and the Semantic Layer)](chapters/08-data-products-and-the-semantic-layer.md) argues that TRx should be defined once and reused by every consumer, including AI assistants. This example does exactly that on Snowflake:

- a **semantic view** that defines TRx, NRx, NBRx, and TRx market share over the HCP 360 data product, with synonyms ("scripts", "new patient starts", "share") and descriptions that carry the valid grains from the Chapter 8 spec;
- a **Cortex Search service** over chunks of MLR-approved field content, where only approved chunks are ever indexed ([Chapter 10 (Data for Generative AI)](chapters/10-data-for-generative-ai.md));
- a **Cortex Agent** that chooses between the two tools, with a budget, a strict rule for missing grants, and its SQL running on the capped warehouse from Example D1;
- grants and smoke tests whose expected results are written down from the invented sample data.

It sits on top of Example D1: the semantic view reads the secure agent views, so the territory row access policy applies to every agent answer. [Chapter 16 (Exposing Governed Data to Agents on Snowflake)](chapters/16-exposing-governed-data-to-agents-on-snowflake.md) explains where this fits among the options for serving agents.

### How to use it

Run Example D1 first, then these files in order in a non-production account: `01_semantic_view.sql`, `02_cortex_search_service.sql`, `03_cortex_agent.sql`, `04_grants_and_smoke_tests.sql`. The smoke tests in file 04 state the numbers you should get from the sample data, so a reviewer can compare actual against expected without recomputing anything.

For a design review, read file 01 against the data product spec: every metric's comment should match the certified definition, and every synonym should be a word the business actually uses.

### Walkthrough

**Step 1: the logical tables and how they join.** Each logical table is one of the D1 secure views, with a primary key so Snowflake knows the grain, and synonyms so "doctor" and "prescriber" both resolve to the HCP table.

<!-- listing: 01_semantic_view.sql | from: CREATE OR REPLACE SEMANTIC VIEW | to: rx_to_territory AS -->
```sql
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
```
<!-- /listing -->

**Step 2: facts.** Facts are row-level values. `company_trx` keeps TRx only for our brand, which becomes the numerator of market share.

<!-- listing: 01_semantic_view.sql | from:   FACTS ( | to: COMMENT = 'TRx counted only -->
```sql
  FACTS (
    rx.trx AS trx_units
      COMMENT = 'TRx units for one HCP, product, and week, net of reversals (BR-HCP-05)',
    rx.nrx AS nrx_units
      COMMENT = 'NRx units: new prescriptions, excluding refills beyond the first',
    rx.nbrx AS nbrx_units
      COMMENT = 'NBRx units: prescriptions for patients new to the brand',
    rx.company_trx AS IFF(is_company_product, trx_units, 0)
      COMMENT = 'TRx counted only when the product is our brand; numerator of market share'
```
<!-- /listing -->

**Step 3: metrics, with the definition in the comment.** The share metric is written as a ratio of two sums, so it is recomputed at whatever grain is asked for, never summed (Chapter 8, "Metrics that cannot be summed"). Its comment says where it is not valid.

<!-- listing: 01_semantic_view.sql | from:   METRICS ( | to: COMMENT = 'Our TRx divided -->
```sql
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
```
<!-- /listing -->

**Step 4: instructions for text to SQL.** `AI_SQL_GENERATION` and `AI_QUESTION_CATEGORIZATION` are plain-language rules for Cortex Analyst. They repeat the business rules that matter most for an assistant: what "last week" means, how to show share, and which questions are out of scope.

<!-- listing: 01_semantic_view.sql | from:   AI_SQL_GENERATION | to: AI_QUESTION_CATEGORIZATION -->
```sql
  AI_SQL_GENERATION 'Weeks end on Friday. When the user says last week, use the latest week_ending_date available. Market share is a fraction; present it as a percentage with one decimal place. Never break market share down by product or brand; compute it by market, territory, week, or HCP. Do not sum market share across territories or weeks; recompute it from the metric at the requested grain. Always state the week and the data_through date in the answer.'

  AI_QUESTION_CATEGORIZATION 'Questions about individual patients, patient counts below the HCP level, consent status, or anything outside prescriptions and market share are out of scope: reply that this assistant cannot answer them.'
```
<!-- /listing -->

**Step 5: index only approved content.** The search service's source query is the governance control: a chunk that is not `APPROVED` is not in the index, so the agent cannot retrieve it.

<!-- listing: 02_cortex_search_service.sql | from: CREATE OR REPLACE CORTEX SEARCH SERVICE | to: ); -->
```sql
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
```
<!-- /listing -->

**Step 6: the agent specification.** Two tools, each with a description the planner reads to decide which to call, and a `tool_resources` entry that binds the tool to a governed object.

<!-- listing: 03_cortex_agent.sql | from:   tools: | to:   $$; -->
```sql
  tools:
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "hcp360_metrics"
        description: "Answers questions about TRx, NRx, NBRx, and TRx market share by HCP, territory, district, product, market, and week, using the certified HCP 360 semantic view. Results are limited to the caller's territories."
    - tool_spec:
        type: "cortex_search"
        name: "approved_content"
        description: "Searches MLR-approved, field-internal content (visual aid text, objection handlers, Prescribing Information excerpts). Returns passages with document title and approval ID."

  tool_resources:
    hcp360_metrics:
      semantic_view: "COMMERCIAL.AI.SV_HCP360_PRESCRIBER_WEEKLY"
      execution_environment:
        type: "warehouse"
        warehouse: "WH_AGENT_FIELD"
        query_timeout: 60
    approved_content:
      search_service: "COMMERCIAL.AI.CSS_APPROVED_FIELD_CONTENT"
      max_results: 5
      title_column: "document_title"
      id_column: "chunk_id"
      filter:
        "@eq":
          audience: "FIELD_INTERNAL"
  $$;
```
<!-- /listing -->

**Step 7: the guardrails in the agent header.**

<!-- listing: 03_cortex_agent.sql | from:   models: | to: tokens: 20000 -->
```sql
  models:
    orchestration: auto

  orchestration:
    tool_not_accessible: reject
    budget:
      seconds: 60
      tokens: 20000
```
<!-- /listing -->

**Step 8: smoke test with expected numbers.**

<!-- listing: 04_grants_and_smoke_tests.sql | from: SELECT * FROM SEMANTIC_VIEW( | to: No Houston East row -->
```sql
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
```
<!-- /listing -->

### What to notice

- **One definition, many consumers.** The same semantic view can serve a BI tool, a notebook, and the agent. If Brand Analytics changes the TRx definition, it changes once, through review of file 01.
- **Descriptions are part of the product.** The planner chooses tools by their descriptions, and Cortex Analyst maps words to columns by synonyms and comments. A vague comment produces vague SQL. Treat these strings like data dictionary entries and review them the same way.
- **The share metric warns about its own misuse.** Grouping share by product would always return 0 or 1. The rule is stated in the metric comment and again in `AI_SQL_GENERATION`, because either may be what the model reads.
- **The agent inherits D1's governance; it does not add its own.** The agent runs with the caller's role, so the territory policy and masking apply without any agent-specific logic. `tool_not_accessible: reject` turns a missing grant into a visible error rather than a quietly worse answer.
- **Metadata is not a place for data.** Snowflake asks that no personal or regulated data be entered as metadata. Comments and synonyms describe columns; they never include an HCP name or a patient value.

### Verification status

| File | Status |
|---|---|
| `01_semantic_view.sql` | Syntax checked against CREATE SEMANTIC VIEW and Querying semantic views on docs.snowflake.com on 2026-10-23. Not executed. AI_VERIFIED_QUERIES intentionally omitted because the form of the SQL inside a verified query was not confirmed. |
| `02_cortex_search_service.sql` | Syntax checked against CREATE CORTEX SEARCH SERVICE on 2026-10-23. Not executed. Embedding model availability is region-dependent. |
| `03_cortex_agent.sql` | Syntax checked against CREATE AGENT, the Cortex Agents REST API schemas, and Inaccessible tool handling on 2026-10-23. Not executed. Snowflake states that a successful CREATE AGENT does not validate tool specifications. |
| `04_grants_and_smoke_tests.sql` | Syntax checked against GRANT privileges, SHOW SEMANTIC METRICS, SEARCH_PREVIEW, and DATA_AGENT_RUN on 2026-10-23. Not executed. Expected values computed by hand from the invented rows in D1 file 00. |

### What production would add

- Verified queries (`AI_VERIFIED_QUERIES`) for the ten most common field questions, each signed off by Brand Analytics, plus an evaluation set that compares agent answers to those queries before every change to the semantic view or agent spec.
- A reach metric with distinct counting (BR-HCP-08) and calls per targeted HCP, so the agent covers the full Chapter 8 metric list.
- A separate agent object per audience (field, brand, market access) rather than one agent with broad instructions, each with its own role and warehouse.
- Monitoring: search request logs (`REQUEST_LOGGING = TRUE` is already set), agent run history, and cost per question from `QUERY_HISTORY` grouped by the JSON `QUERY_TAG`.
- Versioning of the semantic view and agent spec as contracts (Example D7), with a change log and a deprecation window for consumers.
- A dedicated engineering role that owns these objects instead of `SYSADMIN`, created and granted through Terraform (Example D6).
