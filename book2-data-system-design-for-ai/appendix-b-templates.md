# Appendix B: Templates

> These ten templates cover the artifacts a Data Specialist writes most often: the data product specification, source-to-target mapping, data dictionary, DQ rule register, SLA and SLO sheet, user story with acceptance criteria, UAT sign-off, data request intake form, model-ready dataset request, and agent tool specification (for data products exposed to AI agents as callable tools, see Chapters 8 and 16). Each template has a field guide that says what to write in each field, followed by one filled example. Copy the field guide into a document or spreadsheet, delete nothing from the required set, and keep the field names identical so that engineers can trace a requirement from spec to test.

All brands, people, identifiers, counts, and dates in the examples are invented. "Solveta" is a fictional product. Use your own vendor contracts, field names, and approval chain, and check the vendor license before you put any syndicated field into a shared specification (see Chapter 7). Chapter references point to the chapters where each element is explained in depth.


## B.1 Data product specification

**Purpose**: The single document that defines what a data product is, who it is for, what it contains, how fresh it must be, and what quality it must meet. Engineers build from it, consumers test against it, and it is the anchor for change requests (see Chapter 8).

**When to use**: Before any build starts, and again whenever a breaking change is proposed.

### Field guide

| Field | What to write | Required |
|---|---|---|
| Product name | A business-readable name with its purpose, such as "HCP Weekly Rx Mart" | Yes |
| Product ID and version | A short unique ID and semantic version, such as `DP-RX-001 v1.2.0` | Yes |
| Business owner | The named person accountable for definitions and change approval | Yes |
| Data steward | The named person who maintains the data dictionary and DQ rules day to day | Yes |
| Business questions answered | Three to five questions in plain language, each one a real decision | Yes |
| Consumers | Teams or tools that read the product, including the Snowflake role names | Yes |
| Grain | What one row means, stated as a sentence | Yes |
| Primary key | The column or columns that make a row unique at the grain | Yes |
| Source systems | Each source with vendor, feed name, delivery method, and contract reference | Yes |
| Refresh frequency and freshness SLA | How often the product updates and the maximum acceptable lag | Yes |
| Business rules | Numbered rules that define meaning, such as "active HCP" or "TRx definition" | Yes |
| Data dictionary reference | Link or location of the dictionary for this product | Yes |
| DQ rule register reference | Link or location of the rule register for this product | Yes |
| SLA and SLO reference | Link or location of the service sheet | Yes |
| Classification | Public, internal, confidential, or restricted (PHI or PII) | Yes |
| Vendor license constraints | Permitted uses, restricted fields, and retention limits from each contract | Yes |
| Access model | Snowflake roles, row access policy, and masking policy names | Yes |
| Change policy | What counts as a breaking change, notice period, and approvers | Yes |
| Out of scope | Items consumers might assume are included but are not | Yes |
| Open questions | Unresolved decisions, each with an owner and a due date | No |

### Filled example

| Field | Entry |
|---|---|
| Product name | HCP Weekly Rx Mart (invented example) |
| Product ID and version | DP-RX-001 v1.2.0 |
| Business owner | Brand Analytics Lead, Solveta brand team |
| Data steward | Commercial Data Specialist, Sales Analytics |
| Business questions answered | Which HCPs wrote the most Solveta TRx last week by territory? Which accounts changed prescribing trend over the last four weeks? |
| Consumers | Field reporting dashboard (role `RPT_FIELD_READ`), incentive compensation model (role `IC_MODEL_READ`) |
| Grain | One row per HCP (master ID), per product (NDC-11 rolled to product), per week (week-ending Friday) |
| Primary key | `HCP_MASTER_ID`, `PRODUCT_ID`, `WEEK_END_DATE` |
| Source systems | IQVIA Xponent weekly feed (delivered to S3 stage, Snowpipe), contract reference IQ-2024-0113; Veeva CRM account sync via managed connector, reference CRM-SYNC-07 |
| Refresh and freshness | Weekly, Tuesday load; freshness SLA is data no older than 9 days at load |
| Business rules | BR-01: TRx equals the projected total prescriptions field, never raw; BR-02: territory is resolved as of `WEEK_END_DATE` using the alignment effective on that date; BR-03: HCP is active if at least one Rx in the trailing 12 months |
| Data dictionary reference | `DD-RX-001` in the team wiki |
| DQ rule register reference | `DQR-RX-001` |
| SLA and SLO reference | `SLA-RX-001` |
| Classification | Confidential; contains no patient-level fields |
| Vendor license constraints | Xponent data may be used for internal commercial analytics on contracted products only; no export outside the commercial analytics environment; retention capped at 36 months |
| Access model | `RPT_FIELD_READ` and `IC_MODEL_READ` read the product schema; `MP_ROW_TERRITORY` row access policy limits field users to their own territories |
| Change policy | Adding a nullable column is non-breaking with 5 business days' notice; renaming or removing a column, or changing a business rule, is breaking and needs a new major version with 30 days' notice, approved by the business owner and the IC analytics lead |
| Out of scope | Patient-level claims, Symphony data, and any sample or unprojected raw Rx counts |
| Open questions | Whether NDC-to-product mapping will move to the product master (owner: Data Steward, due next quarter) |

## B.2 Source-to-target mapping

**Purpose**: Documents, column by column, how each target field is produced from its source. It is the bridge between the business rule and the pipeline code, and the first document to check when a number looks wrong (see Chapter 5).

**When to use**: For every new table or changed column, and as the basis for source profiling and testing.

### Field guide

| Field | What to write |
|---|---|
| Mapping ID | Unique ID tied to the data product, such as `STTM-RX-014` |
| Target table | Fully qualified Snowflake name, such as `COMM_MART.RX.FCT_RX_WEEKLY` |
| Target column | Column name exactly as it will appear in Snowflake |
| Target data type | Snowflake data type, such as `NUMBER(18,0)`, `VARCHAR(20)`, `DATE` |
| Source system | Name of the system or vendor |
| Source object | Table, file, or endpoint |
| Source column | Column or field name exactly as delivered |
| Transformation rule | Plain-language rule plus the SQL or logic expression, if simple |
| Null and default handling | What happens when the source is null or invalid |
| Validation rule ID | The DQ rule that tests this column (from the register) |
| Business rule ID | The business rule from the product spec that this mapping implements |
| Load type | Full, incremental, CDC, or snapshot |
| Notes | Known source quirks, vendor caveats, or open questions |

### Filled example

| Field | Entry |
|---|---|
| Mapping ID | STTM-RX-014 |
| Target table | COMM_MART.RX.FCT_RX_WEEKLY |
| Target column | TRX_PROJECTED |
| Target data type | NUMBER(18,2) |
| Source system | IQVIA Xponent (weekly prescriber file) |
| Source object | XPONENT_WEEKLY_RX (external stage file, pattern `xpo_rx_*.csv`) |
| Source column | `TRX_PROJ` |
| Transformation rule | Copy the projected total prescriptions value as delivered. Do not recalculate from raw counts. Cast to decimal with two places. |
| Null and default handling | If null, load null and write a row to the reject table with reason `MISSING_TRX_PROJ`. Do not default to zero, because zero and missing mean different things. |
| Validation rule ID | DQR-RX-004 (non-negative), DQR-RX-006 (projected is not less than raw, within tolerance) |
| Business rule ID | BR-01 |
| Load type | Incremental, weekly, keyed on `WEEK_END_DATE` with replace-on-reload for the week |
| Notes | Projection factors can be restated by the vendor. A restatement arrives as a full file for the affected weeks, and the load must replace those weeks, not append them. |

## B.3 Data dictionary

**Purpose**: Gives every table and column a business definition, a technical type, allowed values, an owner, and a sensitivity level. It turns tribal knowledge into something a new analyst or engineer can read without asking (see Chapter 8).

**When to use**: Created with the data product spec and kept current with each change.

### Field guide

| Field | What to write |
|---|---|
| Table name | Fully qualified Snowflake name |
| Column name | Exact column name |
| Business name | The name business users see |
| Business definition | One to three sentences, written for a non-engineer, saying what the value means |
| Data type | Snowflake type |
| Allowed values or format | Enumerated list, range, or format pattern |
| Nullable | Yes or no, with the meaning of null |
| Source and lineage | Upstream source column or the calculation that produces it |
| Business rule ID | Link to the rule that defines the meaning, where one applies |
| Sensitivity | Public, internal, confidential, PII, or PHI |
| Masking policy | Policy name, if the column is masked for some roles |
| Owner | Named steward for the column |
| Example value | One realistic value, invented if the real one is restricted |
| Last reviewed | Date of the last steward review |

### Filled example

| Field | Entry |
|---|---|
| Table name | COMM_MART.RX.FCT_RX_WEEKLY |
| Column name | TRX_PROJECTED |
| Business name | Projected total prescriptions |
| Business definition | The national projected count of prescriptions dispensed for this product, for this HCP, in the week ending on `WEEK_END_DATE`, including new and refill prescriptions. Use this for field and incentive compensation reporting. It is not a count of patients. |
| Data type | NUMBER(18,2) |
| Allowed values or format | Zero or greater, up to two decimal places; never negative |
| Nullable | No for active HCPs; null means the vendor did not report a value for that HCP and week, and the row is in the reject table |
| Source and lineage | IQVIA Xponent `TRX_PROJ`, copied directly (STTM-RX-014) |
| Business rule ID | BR-01 |
| Sensitivity | Confidential |
| Masking policy | None |
| Owner | Commercial Data Specialist, Sales Analytics |
| Example value | 42.75 (invented) |
| Last reviewed | 2026-09-30 |

## B.4 DQ rule register

**Purpose**: A single list of every data quality rule for a product, with its dimension, logic, severity, threshold, and what happens when it fails. It makes quality expectations explicit and testable, and it gives incidents a clear owner (see Chapter 6).

**When to use**: Written during design and maintained whenever a source, rule, or threshold changes.

### Field guide

| Field | What to write |
|---|---|
| Rule ID | Unique ID, such as `DQR-RX-004` |
| Table and column | Target table and column, or "table-level" for rules such as row counts |
| Quality dimension | Completeness, validity, accuracy, uniqueness, timeliness, consistency, or reasonableness |
| Rule description | One sentence in business language |
| Logic | Test expressed as a SQL condition, Data Metric Function, or dbt test name |
| Severity | Blocking (stops the publish), warning (publishes and alerts), or informational |
| Threshold | Allowed failure rate or absolute limit |
| Action on failure | Who is notified, what is held back, and how the issue is resolved |
| Check frequency | Per load, daily, or weekly |
| Owner | Named steward who responds |
| Rule status | Active, proposed, or retired, with the date changed |

### Filled example

| Field | Entry |
|---|---|
| Rule ID | DQR-RX-006 |
| Table and column | COMM_MART.RX.FCT_RX_WEEKLY.TRX_PROJECTED |
| Quality dimension | Reasonableness (consistency with raw counts) |
| Rule description | Projected prescriptions must not be less than raw prescriptions for the same HCP, product, and week, allowing a small tolerance for rounding. |
| Logic | `COUNT(*) WHERE TRX_PROJECTED < TRX_RAW * 0.99` must be zero, after the tolerance is applied to rows with TRX_RAW above 0 |
| Severity | Warning for the first occurrence in a load; blocking if more than 0.5 percent of rows fail |
| Threshold | 0.5 percent of rows for the load |
| Action on failure | Notify the Xponent feed owner and the data steward within one hour; hold the publish of the affected week until the steward confirms whether the vendor restated the projection factors |
| Check frequency | Per weekly load |
| Owner | Commercial Data Specialist, Sales Analytics |
| Rule status | Active since 2026-03-02 |

## B.5 SLA and SLO sheet

**Purpose**: States what the consumer is promised (SLA), how it is measured (SLI), the internal target that protects the promise (SLO), and what happens when it is missed. It keeps freshness and availability conversations concrete (see Chapter 6 and Chapter 14).

**When to use**: For each data product before go-live, and reviewed quarterly against actual performance.

### Field guide

| Field | What to write |
|---|---|
| Service name | The data product or pipeline the commitment covers |
| Consumers | Teams that rely on the commitment |
| SLA (promise) | The commitment in plain language, with time and percentage |
| SLI (measure) | Exactly what is measured, and where the measurement is recorded |
| SLO (internal target) | The stricter internal target |
| Measurement window | Weekly, monthly, or quarterly |
| Business hours and time zone | When the clock runs and in which time zone |
| Dependencies | Upstream sources and their own delivery commitments |
| Exclusions | Planned maintenance, vendor delays outside contract, and known holidays |
| Breach response | Who is notified, how quickly, and the recovery expectation |
| Escalation path | Named people and roles, in order |
| Reporting | Where the monthly results are published |
| Review date | Next scheduled review |

### Filled example

| Field | Entry |
|---|---|
| Service name | HCP Weekly Rx Mart (DP-RX-001) |
| Consumers | Field reporting dashboard, incentive compensation model |
| SLA (promise) | The weekly mart is ready for field reporting by 9:00 a.m. Eastern on Tuesday, in at least 48 of every 52 weeks. |
| SLI (measure) | Percentage of weeks where the publish timestamp of the mart is before the Tuesday 9:00 a.m. deadline, recorded in the pipeline audit table `OPS.PIPELINE_RUN_LOG` |
| SLO (internal target) | 50 of 52 weeks on time, with no single miss lasting more than one business day |
| Measurement window | Rolling 52 weeks, reported monthly |
| Business hours and time zone | Eastern time; the clock starts when the Xponent file lands in the stage |
| Dependencies | IQVIA Xponent weekly delivery, contracted for delivery by Monday 18:00 Eastern (vendor SLA, not controlled by this team) |
| Exclusions | Vendor delivery delays beyond Monday 18:00 Eastern; planned Snowflake maintenance windows announced at least 5 business days in advance |
| Breach response | Data steward notified within 30 minutes of a missed deadline; consumer notified by 11:00 a.m. with an expected time of availability |
| Escalation path | Data steward, then Data Engineering Lead, then Commercial Analytics Director |
| Reporting | Monthly SLA report in the commercial analytics team space |
| Review date | 2026-12-15 |

## B.6 User story with acceptance criteria

**Purpose**: Expresses a need from the user's point of view and defines, in testable terms, when the need is met. It is the unit the engineering team plans and the business accepts (see Chapter 13).

**When to use**: For each backlog item that changes behavior, data, or a report.

### Field guide

| Field | What to write |
|---|---|
| Story ID | Backlog ID, such as `RX-214` |
| Epic | Parent epic or initiative |
| Story statement | "As a [role], I want [capability], so that [benefit]." |
| Persona | The role the story is written for, such as Territory Manager or Market Access Analyst |
| Acceptance criteria | Numbered, testable conditions written as Given, When, Then where helpful |
| Data definitions referenced | Links to the data dictionary and business rules used |
| Priority | Must, should, could, or won't (for this release) |
| Dependencies | Other stories, sources, or approvals the story needs |
| Definition of done | Engineering and business conditions, such as tests passing and UAT sign-off |
| Out of scope | What the story deliberately does not cover |
| Estimate | Size agreed with engineering, in points or days |

### Filled example

| Field | Entry |
|---|---|
| Story ID | RX-214 |
| Epic | Field reporting refresh, Q4 |
| Story statement | As a Territory Manager, I want to see each HCP's TRx trend for the last four weeks on one screen, so that I can decide which accounts need a follow-up call this week. |
| Persona | Territory Manager |
| Acceptance criteria | 1. Given a manager logged in with territory T102, when they open the trend view, then only HCPs aligned to T102 on the week-ending date appear. 2. Given an HCP with no Rx in the last four weeks, when the view loads, then the HCP shows zero, not blank, and is flagged "no recent Rx." 3. Given the weekly mart has loaded, when the view is opened on Tuesday after 9:00 a.m., then the most recent week matches the mart total within 0.01 for the sum of TRX_PROJECTED. 4. Given a territory realignment effective mid-period, when the trend is shown, then each week uses the territory in effect that week, and the view notes the realignment. |
| Data definitions referenced | DD-RX-001 (TRX_PROJECTED), BR-01, BR-02 |
| Priority | Must |
| Dependencies | DP-RX-001 v1.2.0 published; alignment history loaded for the last 52 weeks (story RX-208) |
| Definition of done | Automated tests for criteria 1 to 4 pass in the test environment; UAT sign-off recorded (see B.7); row-level security tested with two territory users |
| Out of scope | Activity or call data; forecasting; export to Excel |
| Estimate | 5 points |

## B.7 UAT sign-off

**Purpose**: Records that business users tested the delivered product against the acceptance criteria, what passed and failed, and who accepts the result. It is the business's formal decision that the product is fit for use (see Chapter 13).

**When to use**: At the end of user acceptance testing for each release or story group, before production release.

### Field guide

| Field | What to write |
|---|---|
| UAT ID | Unique ID, such as `UAT-RX-2026Q4-01` |
| Release or scope | Product name, version, and the stories included |
| Test environment and data date | Where the test ran and the data as-of date |
| Test cases | Numbered, traced to acceptance criteria IDs |
| Tester and role | Named business tester |
| Result per case | Pass, fail, or blocked |
| Defects raised | Defect IDs, severity, and status |
| Conditions of acceptance | Any accepted limitations, with owner and date |
| Decision | Accepted, accepted with conditions, or rejected |
| Approver name, role, and date | Business owner or delegate |
| Signature or electronic approval reference | Reference to the approval record in your workflow tool |

### Filled example

| Field | Entry |
|---|---|
| UAT ID | UAT-RX-2026Q4-01 |
| Release or scope | HCP Weekly Rx Mart v1.2.0; stories RX-208, RX-214 |
| Test environment and data date | UAT schema, data as of week ending 2026-10-16 |
| Test cases | TC-01 (maps to RX-214 AC1), TC-02 (RX-214 AC2), TC-03 (RX-214 AC3), TC-04 (RX-214 AC4), TC-05 (RX-208 AC1) |
| Tester and role | Territory Manager, Region 3 (invented example) |
| Result per case | TC-01 pass, TC-02 pass, TC-03 pass (sum difference 0.00), TC-04 fail, TC-05 pass |
| Defects raised | DEF-392 (medium): realignment note not shown when the realignment falls on a Monday; status fixed and retested |
| Conditions of acceptance | None outstanding after retest of TC-04 |
| Decision | Accepted with conditions: TC-04 retest passed on 2026-10-21 before release |
| Approver name, role, and date | Brand Analytics Lead, 2026-10-21 |
| Signature or electronic approval reference | Workflow record APR-88310 (invented example) |

## B.8 Data request intake form

**Purpose**: Turns an ad hoc request into a structured item the data team can triage, estimate, and prioritize. It captures the business decision the data will support, which is the single most useful piece of information for scoping (see Chapter 13).

**When to use**: Every time a business group asks for new data, a new report, or a new extract. Existing products should be checked first.

### Field guide

| Field | What to write |
|---|---|
| Request ID | Assigned by the intake queue |
| Requestor name, function, and manager | Who is asking and who approves |
| Business question | The question in one or two sentences |
| Decision supported | The action the answer will drive, such as a call plan change or a budget reallocation |
| Deadline and reason | Date needed and why that date matters |
| Existing products checked | Data products or dashboards already reviewed, and why they do not answer the question |
| Data requested | Entities, measures, and fields needed |
| Grain | Level of detail required |
| Time period and frequency | Date range and whether it is one-off or recurring |
| Output format | Dashboard, table, file, or model input |
| Sensitivity | Whether PII, PHI, or licensed vendor data is involved |
| Approvals needed | Data owner, privacy, legal, or vendor approvals |
| Expected users | Who will see the output |
| Impact of delay | What happens if the date is missed |
| Priority | Set by the requestor and confirmed by the data owner |

### Filled example

| Field | Entry |
|---|---|
| Request ID | REQ-2026-0457 (assigned by queue) |
| Requestor name, function, and manager | Ana Ruiz, Sales Operations, manager: Director of Sales Operations (invented example) |
| Business question | Which Region 3 territories gained or lost more than 15 percent of Solveta TRx after the September realignment? |
| Decision supported | Whether to adjust Q4 quota targets for affected territories |
| Deadline and reason | 2026-11-06; quota letters are issued the following Monday |
| Existing products checked | HCP Weekly Rx Mart (DP-RX-001) shows TRx by territory, but does not show realignment impact on a like-for-like basis; field dashboard shows current alignment only |
| Data requested | TRx projected by territory, by month, before and after realignment, using the alignment in effect on each date |
| Grain | Territory by month |
| Time period and frequency | January 2025 to September 2026; one-off, with a possible monthly refresh if the analysis is adopted |
| Output format | Table in the Sales Ops analytics schema and a summary view |
| Sensitivity | Confidential; no patient-level data; Xponent data is used under the internal analytics license |
| Approvals needed | Data steward (for alignment history use), IC analytics lead (for quota use) |
| Expected users | Sales Operations, Region 3 managers |
| Impact of delay | Quota letters go out without realignment adjustments, which would require a later correction for affected reps |
| Priority | High, confirmed by the data steward on 2026-10-22 |

## B.9 Model-ready dataset request

**Purpose**: Specifies the dataset a data scientist or ML engineer needs to train or score a model, including the label, the as-of date, the population, the features, and the rules that prevent leakage. Most failed models trace back to a vague version of this document (see Chapter 9).

**When to use**: Before any model training or scoring dataset is built, and whenever features or labels change.

### Field guide

| Field | What to write |
|---|---|
| Model name and purpose | The business objective and the decision the model supports |
| Model owner and data owner | Named people |
| Prediction target (label) | Exact definition of the outcome, including the window and the source |
| As-of date rule | The date at which the prediction is made, and the rule that prevents later information from entering the features |
| Population | Who is included, and the criteria, such as active HCPs with at least one Rx in the trailing 12 months |
| Entity and grain | One row per what, per what time period |
| Feature list | Each feature with its name, definition, source, and lookback window |
| Point-in-time rules | How each feature is computed as of the as-of date, including alignment and affiliation lookups |
| Exclusions | Records removed, such as opted-out HCPs, deceased flags, or test accounts, with the rule source |
| Consent and privacy filters | Consent, opt-out, and licensing filters applied before use |
| Train, validation, and test split | Date ranges for each split and the reason |
| Refresh cadence | How often the dataset is rebuilt, and whether training or scoring uses it |
| Evaluation metrics | Metrics the model will be judged on, with the baseline to beat |
| Known leakage risks | Features that could leak the label, and how they were checked |
| Delivery location and format | Snowflake schema and table, or feature store view |
| Freshness SLA | Maximum age of the input data at scoring time |
| Sign-offs | Data owner, privacy reviewer, and model owner, with dates |

### Filled example

| Field | Entry |
|---|---|
| Model name and purpose | Solveta NBRx propensity (invented example); estimates which active HCPs are likely to write a first new-to-brand prescription in the next 90 days, to prioritize field calls |
| Model owner and data owner | Data Science Lead, Commercial Analytics; Commercial Data Specialist, Sales Analytics |
| Prediction target (label) | HCP has at least one NBRx for Solveta in the 90 days after the as-of date, from the Xponent weekly feed (NBRx defined in BR-07) |
| As-of date rule | Monthly as-of dates, the last business day of each month. Features use only data loaded on or before that date. Labels use data from the following 90 days, loaded by the label cutoff. |
| Population | Active HCPs (BR-03) with a specialty in the approved list and no opt-out flag as of the as-of date; excludes HCPs with a deceased flag |
| Entity and grain | One row per HCP per as-of date |
| Feature list | `TRX_L13W` (total Solveta TRx, last 13 weeks, from FCT_RX_WEEKLY); `NRX_L26W` (Solveta NRx, last 26 weeks); `CALLS_L13W` (calls received, from CRM activity, last 13 weeks); `SPEC_CD` (primary specialty, from HCP master as of the as-of date) |
| Point-in-time rules | HCP master attributes and territory are taken as of the as-of date, from effective-dated tables; no feature may use data from a week ending after the as-of date |
| Exclusions | Samples-only accounts flagged in CRM; test HCP records (flag from MDM); HCPs in the opt-out list at the as-of date |
| Consent and privacy filters | Opt-out list applied before feature build; no patient-level data used |
| Train, validation, and test split | Train: as-of dates from January 2024 to June 2025; validation: July to December 2025; test: January to March 2026. Time-based, to match production. |
| Refresh cadence | Monthly rebuild after the Xponent load; scoring runs the first business day after the rebuild |
| Evaluation metrics | Lift in the top decile against random selection, and precision at 20 percent of population. Baseline: the current rules-based list, which gives 1.8x lift (invented example). |
| Known leakage risks | `CALLS_L13W` could include calls scheduled because of a prescription already written; checked by confirming call dates precede the as-of date and by reviewing the top 20 features for suspicious importance |
| Delivery location and format | `COMM_MART.ML.NBRX_PROPENSITY_TRAIN` and `COMM_MART.ML.NBRX_PROPENSITY_SCORE`, one row per HCP per as-of date |
| Freshness SLA | Input data no more than 9 days old at scoring time, matching DP-RX-001 |
| Sign-offs | Data owner (2026-10-12), privacy reviewer (2026-10-13), model owner (pending at time of writing, invented example) |

## B.10 Agent tool specification

**Purpose**: Defines one tool that an AI agent may call to read a data product, such as a Cortex Agent tool, a tool published through Snowflake's managed MCP server, or a function behind an MCP gateway. The tool is part of the product's interface, so it needs the same discipline as a published table: a definition the model can act on, typed inputs and outputs, the identity and entitlements it runs under, service levels, an owner, and a version with a deprecation policy (see Chapter 8 and Chapter 16). Full working examples of the Snowflake setup are in Appendix D (Examples D1 to D3), and the versioning checker is Example D7.

**When to use**: Before any data product is exposed to an agent, and whenever the tool's description, inputs, outputs, or entitlements change. Write one specification per tool, not one per agent.

### Field guide

| Field | What to write | Required |
|---|---|---|
| Tool name | A short, stable, verb-first name in lower case with underscores, such as `get_hcp_profile`. Never reuse a retired name for a different behavior. | Yes |
| Version | Semantic version (MAJOR.MINOR.PATCH), with the rule that removing or renaming a field, adding a required input, narrowing allowed values, or changing units or meaning is a major change | Yes |
| Owner | The named product owner (business) and engineering owner for the tool | Yes |
| Backing data product and object | The data product ID and version, and the Snowflake object the tool reads (table, semantic view, Cortex Search service, function, or procedure) | Yes |
| Model-facing description | The text the model reads to decide whether to call the tool. State what it returns, when to use it, when not to use it (with the alternative tool), and any hard limits. Write it for a model, in plain sentences, and keep it under about 80 words. | Yes |
| Inputs | Each input with name, type, required or optional, format or pattern, allowed values, and example | Yes |
| Outputs | Each output field with name, type, business definition (from the data dictionary), and whether it can be masked or null. Always include the data-through date. | Yes |
| Errors and empty results | What the tool returns when the input is invalid, when no row is found, and when the caller is not entitled, and what the agent should say in each case | Yes |
| Identity and entitlements | Which identity the query runs as (on behalf of the user, the agent's service user, or an owner's rights procedure), the Snowflake role, and the row access and masking policies that apply | Yes |
| Data classification and license | Highest classification of any output field, and the vendor license terms that apply to agent use | Yes |
| Example calls | Two to four realistic calls with inputs and expected outputs, including one where the tool should not be used and one that returns masked or empty data. These become evaluation cases. | Yes |
| Service levels | Latency target, availability, rate limit per agent, and freshness (data-through clock) | Yes |
| Audit and logging | Where calls are logged (for example, query tags and `QUERY_HISTORY`), and the retention period | Yes |
| Deprecation policy | Notice period, parallel-run period for major versions, sunset date rule, and who approves | Yes |
| Change log | Date, version, and one line per change | Yes |
| Open questions | Unresolved decisions, each with an owner and a due date | No |

### Filled example

| Field | Entry |
|---|---|
| Tool name | `get_hcp_profile` |
| Version | 1.3.0 (adds optional output `last_call_channel`; minor, additive) |
| Owner | Business: Commercial Data Specialist, Sales Analytics. Engineering: HCP 360 data engineering lead (invented example) |
| Backing data product and object | HCP 360 Prescriber Weekly v2.1.0; reads the secure view `HCP360.PUBLISHED.V_HCP_PROFILE_LATEST` (one row per HCP for the latest complete week) |
| Model-facing description | "Returns the profile of ONE health care professional (HCP) from HCP 360 for the latest complete week: specialty, territory, 13-week Solveta TRx, calls in the last 90 days, last call channel, consent status, and the data-through date. Use when the user names a single HCP or gives an HCP ID. Do not use for territory, regional, or national totals; use `hcp360_metrics` instead. Never returns patient data." |
| Inputs | `hcp_master_id` (string, required, pattern `^HCP-[0-9]{8}$`, example `HCP-00481276`) |
| Outputs | `hcp_master_id` (string); `specialty_code` (string, from MDM); `territory_id` (string, territory on the reporting date); `trx_13wk` (number, Solveta TRx units over the 13 most recent complete weeks, net of reversals per BR-01); `calls_90d` (integer, submitted calls); `last_call_channel` (string, optional, one of in_person, remote, email); `consent_status` (string, opt_in, opt_out, or not_specified; masked to null for roles without Compliance access); `npi_masked` (string, last four digits only); `vendor_data_through_date` (date) |
| Errors and empty results | Invalid ID format: return error `INVALID_HCP_ID`, and the agent asks the user to confirm the ID. No row: return `NOT_FOUND_OR_NOT_ENTITLED` (the tool does not reveal which), and the agent says it cannot find that HCP in the user's data. Snowflake error or timeout: return `TEMPORARILY_UNAVAILABLE`, and the agent does not guess. |
| Identity and entitlements | Runs on behalf of the requesting user through delegated authentication where available; otherwise as service user `SVC_FIELD_INSIGHTS_AGENT` with role `AGENT_FIELD_INSIGHTS` (Chapter 7). Row access policy `RAP_TERRITORY` limits rows to the user's territories; masking policies `MASK_NPI` and the consent mask apply. The role holds no `PII_UNMASKED_READ`, `COMM_ALL_TERRITORIES`, patient, or Market Access roles. |
| Data classification and license | Confidential, HCP PII (masked NPI); derived from IQVIA Xponent under the internal analytics license. Legal confirmed on 2026-10-14 that agent use inside Snowflake is within license; external LLM APIs may not receive outputs (invented example). |
| Example calls | 1. Input `HCP-00481276` from a rep aligned to that HCP's territory: returns specialty `CARD`, `trx_13wk` 46, `calls_90d` 3, data through 2026-10-09. 2. Same input from a rep in another territory: returns `NOT_FOUND_OR_NOT_ENTITLED`. 3. User asks "what is Solveta TRx for territory T0412?": the tool must not be called; the agent uses `hcp360_metrics`. 4. Input `00481276` (missing prefix): returns `INVALID_HCP_ID`. |
| Service levels | p95 latency under 2 seconds; available 06:00 to 22:00 ET on business days at 99.5 percent; rate limit 60 calls per minute per agent; data no more than one vendor-schedule week behind (SLA-HCP360-001) |
| Audit and logging | Every call sets a query tag such as `agent=field_insights;tool=get_hcp_profile;v=1.3.0`; calls are reviewed from `ACCOUNT_USAGE.QUERY_HISTORY` monthly and archived to the governance schema for 2 years |
| Deprecation policy | Minor and patch versions replace the previous version in place with 5 business days' notice. A major version is published beside the old one (for example `get_hcp_profile_v2`) with 30 days' notice, runs in parallel for one reporting cycle, and the old version is retired only after the agent evaluation suite passes on the new one. Approved by the HCP 360 data owner. |
| Change log | 2026-06-02, 1.0.0: first release. 2026-08-11, 1.2.0: added `vendor_data_through_date`. 2026-10-20, 1.3.0: added optional `last_call_channel`. |
| Open questions | Whether delegated (on behalf of the user) authentication is available for the mobile CRM client (owner: platform architect, due 2026-11-30) |
