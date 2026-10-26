# Appendix A: Glossary

> This glossary defines the terms you will meet across Book 2: data architecture, Snowflake, data for machine learning and generative AI, and commercial pharma data. Terms are alphabetical. Where a term is developed in a chapter, the entry points you there. Vendor and product names belong to their owners, and product behavior changes between releases, so check current Snowflake and vendor documentation before you put a feature detail into a contract or a specification.

## A

- **Acceptance criteria**: Testable conditions a user story must meet before the business accepts it. "The weekly TRx file contains one row per prescriber per product per week and totals match the IQVIA control report within 0.5 percent" is an acceptance criterion; "the data looks right" is not.
- **Access history**: A Snowflake account usage view that records which objects each query read and which it wrote, used for audit and for lineage. Check current docs for retention and availability by edition.
- **Account (Snowflake)**: The top-level container in Snowflake that holds databases, virtual warehouses, users, and roles. An organization can run several accounts, for example one per region or per business unit.
- **ACCOUNT_USAGE**: A Snowflake shared schema with historical metadata and credit consumption for the whole account. It lags real time by up to a few hours, so do not use it for live monitoring.
- **Accuracy**: A data quality dimension measuring how closely a stored value matches the real-world fact it describes. A prescriber's specialty recorded as "Oncology" when the physician practices cardiology is an accuracy failure, even if the value is complete and valid.
- **ACID**: Atomicity, Consistency, Isolation, Durability, the transaction guarantees that make a multi-step change either fully happen or not happen at all. Snowflake supports transactions, but analytical pipelines usually rely on idempotent batch loads rather than row-level transactional updates (see Chapter 3).
- **Adjudication**: The payer's process of approving, rejecting, pricing, and paying a claim. Adjudication status and rejection reason codes matter when you measure access, abandonment, or patient out-of-pocket cost.
- **Affiliation**: A dated relationship record linking an HCP to a hospital, practice, or health system, with a type (employed, privileged, owner) and a primary flag. Affiliations drive account rollups and must be versioned (see Chapter 12).
- **Agent tool spec (agent tool specification)**: The written contract for one tool an AI agent may call, such as `get_hcp_profile`: its name, a description written for the model (including when not to use it), typed inputs and outputs, the identity and entitlements it runs under, example calls, SLAs, owner, version, and deprecation policy. It is part of a data product's interface (see Chapter 8, Chapter 16, and Appendix B).
- **Aggregate table**: A precomputed summary, such as weekly TRx by territory, stored so that dashboards do not scan the full fact table on every query. Aggregates must be rebuilt or incrementally maintained when their source changes.
- **Airflow (Apache Airflow)**: An open-source workflow orchestrator in which pipelines are defined as Python directed acyclic graphs (DAGs) that schedule and monitor tasks. It schedules work; it does not transform data itself (see Chapter 5).
- **Alignment**: The assignment of accounts to territories, and territories to districts, regions, and sales teams, as it existed on a given date. Historical reporting must use the alignment in effect on the fact date, not today's alignment (see Chapter 12).
- **Anomaly detection**: Statistical or machine learning methods that flag values or volumes outside expected ranges, such as a weekly row count that drops 40 percent with no holiday explanation. It complements rule-based checks rather than replacing them (see Chapter 6).
- **Anonymization**: Removing or transforming identifiers so that a person cannot reasonably be identified, even with other data. True anonymization is hard to prove, and many datasets labeled "anonymized" are really pseudonymized (see Chapter 7).
- **Apache Iceberg**: An open table format that stores table metadata and data files so that multiple engines (Snowflake, Spark, and others) can read the same tables. Snowflake supports Iceberg tables, which keep data in your cloud storage while Snowflake manages the table (see Chapter 3).
- **Apache Parquet**: An open columnar file format widely used for analytical files in cloud storage. Parquet files carry their own schema and compress well, which is why they are preferred over CSV for large extracts.
- **Apache Spark**: A distributed processing engine for large-scale transformation and machine learning on clusters. Many organizations run Spark alongside Snowflake for workloads that are awkward to express in SQL.
- **API (application programming interface)**: A defined set of endpoints or functions through which one system requests data or actions from another. Veeva, vendor portals, and many SaaS sources expose APIs that your ingestion must respect for rate limits and paging.
- **APLD (Anonymized Patient Level Data)**: An IQVIA longitudinal asset of de-identified patient-level claims, with one row per transaction per anonymous patient token. It is a sample of patients, not a national census, so you cannot project it the way you project Xponent (see Chapter 12).
- **Approval status (content)**: The current regulatory and medical review state of a piece of promotional or medical content, with an effective date and expiry date. Pipelines that feed content generation must filter to content that was approved as of the date being used.
- **Archive**: Moving data that is no longer actively queried to cheaper storage, while keeping it retrievable for audit or legal needs. In Snowflake this often means tiering old data out of hot tables.
- **Asset (data asset)**: Any dataset, table, view, dashboard, model, or document the organization treats as valuable and manages. Catalogs exist to make assets findable and owned.
- **Attribute**: A descriptive column on a dimension, such as specialty, practice state, or account tier. Attributes describe the entity; measures describe events.
- **Audit log**: A record of who accessed or changed what, and when. Snowflake's query history and access history support audit, and regulated pharma work often requires you to produce that log for a given period.
- **Authentication**: Proving who a user or system is, typically through single sign-on, passwords with multi-factor authentication, or key pairs for service accounts. Authentication answers "who are you?"
- **Authorization**: Deciding what an authenticated identity may read, write, or administer. In Snowflake, authorization is granted through roles and privileges (see RBAC).
- **Auto-clustering**: A Snowflake background service that reorganizes micro-partitions according to a clustering key as data changes. It consumes credits, so enable it only on tables where pruning gains justify the cost (see Chapter 3).
- **Auto-resume**: The Snowflake setting that starts a suspended virtual warehouse automatically when a query arrives. Paired with auto-suspend, it keeps idle compute from billing.
- **Auto-suspend**: The Snowflake setting that stops a virtual warehouse after a configured period with no queries. Setting it too high wastes credits; setting it too low adds a cold-start delay for analysts.
- **Availability**: The share of time a system is up and usable for its intended purpose, usually expressed as a percentage over a month. An availability target belongs in the SLO sheet, measured from the consumer's point of view.

## B

- **Backfill**: Reprocessing historical data through a pipeline, usually because logic changed, a source sent corrections, or a new table needs history. Backfills must be idempotent so that rerunning them does not double-count (see Chapter 5).
- **Batch inference**: Running a trained model over a full set of records on a schedule and writing the predictions to a table, such as a weekly next-best-action score for every active HCP. It is cheaper and easier to govern than real-time serving when the decision cycle is weekly (see Chapter 11).
- **Batch processing**: Moving or transforming data in scheduled groups, such as nightly loads or weekly vendor files. Most pharma syndicated data arrives in batches, which is why batch pipelines dominate commercial data platforms.
- **Bitemporal modeling**: Recording two time dimensions for each fact: when the event happened in the real world (valid time) and when the system learned about it (transaction time). It answers questions like "what did we believe on March 1 about February sales?"
- **Blob storage**: Object storage, such as Amazon S3, Azure Blob Storage, or Google Cloud Storage, where files are stored as objects addressed by path. Snowflake external stages point to blob storage locations.
- **Bronze layer**: In the medallion pattern, the layer that holds raw data as received from sources, with minimal change and full history. Bronze is the audit trail; nothing downstream should be the only copy of a source fact (see Chapter 5).
- **Business key**: A key that identifies an entity in the business's own terms, such as an NPI for a US individual prescriber. Business keys are not always unique or stable, which is why warehouses often add surrogate keys.
- **Business rule**: A logic statement that defines a business meaning, such as "an active HCP is one with at least one claim or Rx in the trailing 12 months." Business rules belong in the data product spec and the semantic layer, not buried in SQL nobody else can read.

## C

- **Caller's rights**: A mode in which a Snowflake stored procedure (or a tool built on one) runs with the privileges and context of the role that calls it, so the caller's row access and masking policies apply. It is usually the safer choice for agent tools that answer on behalf of a user. Contrast with owner's rights; check current Snowflake docs for the exact behavior of context functions in each mode (see Chapter 7 and Chapter 16).
- **Cardinality**: The number of distinct values in a column, or the number of related records on each side of a relationship (one-to-one, one-to-many, many-to-many). Checking cardinality is a fast way to catch an unexpected join explosion.
- **CDC (change data capture)**: A technique that captures only the inserts, updates, and deletes made to a source table since the last load, instead of reloading everything. CDC is how you keep a CRM table current without a full nightly extract.
- **Claims (medical and pharmacy)**: Records of services or dispensed drugs submitted to payers for reimbursement. Pharmacy claims record the NDC, quantity, days supply, prescriber, and payer decision; medical claims record procedures and diagnoses.
- **Clean room (Snowflake Data Clean Rooms)**: A controlled environment where two or more parties can analyze combined data under agreed rules without either side seeing the other's row-level records. Clean rooms are used for media measurement and matching in pharma, subject to contract and privacy review.
- **Clone (Snowflake zero-copy clone)**: A command that creates a new table, schema, or database that initially points to the same micro-partitions as the source. Storage is charged only when the copies diverge, which makes clones cheap for testing and point-in-time snapshots.
- **Closed claims**: Claims sourced directly from payers for a defined population of enrolled members, so every claim for the enrolled period is visible. Closed claims support true persistence and line-of-therapy measurement but cover fewer lives than open claims (see Chapter 12).
- **Clustering key**: One or more columns chosen so that Snowflake co-locates similar values in the same micro-partitions, which improves pruning for filters on those columns. A poor clustering key adds cost without speeding queries.
- **Cohort**: A defined group of patients or HCPs that meets specified criteria over a specified window, such as "adults with a first fill in Q1 and 12 months of continuous enrollment." Cohort definitions are business rules and should be versioned.
- **Column-level security**: Controls that restrict who can see specific columns, usually implemented in Snowflake with masking policies. It protects sensitive attributes such as patient identifiers without forcing a separate table for each audience.
- **Columnar storage**: A physical layout that stores each column's values together. Analytical queries that read a few columns from many rows run much faster on columnar storage than on row storage (see Chapter 3).
- **Compute (Snowflake)**: The virtual warehouses that execute queries, billed in credits per second while running. Compute is separate from storage, so you can scale or pause one without touching the other.
- **Compute pool**: A Snowflake object that provides the set of virtual machine nodes on which Snowpark Container Services runs containers. It has an instance family, a minimum and maximum node count, and its own credit consumption, so it needs auto-suspend and a resource monitor like a warehouse. Check current docs for instance families and pricing (see Chapter 16).
- **Conceptual data model**: The highest-level model, showing the main business entities (HCP, HCO, territory, product, activity) and how they relate, without attributes or technical detail. It is the model you review with business stakeholders (see Chapter 2).
- **Consent (data consent)**: A recorded agreement by an individual to a specific use of their data, such as marketing communications or sharing with a partner. Consent records must be linked to the purpose they cover and must be honored by downstream filters.
- **Contract (data contract)**: A formal agreement between a data producer and its consumers that states schema, semantics, quality expectations, freshness, and change notice rules for a dataset. Contracts turn an informal feed into something both teams can test against (see Chapter 6).
- **Cortex (Snowflake Cortex)**: Snowflake's family of AI features that runs large language model functions, vector search, and analyst services inside the Snowflake governance boundary. Check current Snowflake docs for available models and regions.
- **Cortex Agent**: A Snowflake service that plans and carries out multi-step answers by choosing among configured tools, such as Cortex Analyst over a semantic view for metrics and Cortex Search for documents, and then composing a response. It runs inside Snowflake's governance boundary, and the queries it issues are subject to the calling identity's roles and policies. Features and configuration change frequently, so check current Snowflake docs (see Chapter 16).
- **Cortex Analyst**: A Snowflake service that answers natural-language questions by generating SQL against a semantic model you define, typically in YAML. Its accuracy depends heavily on the quality of the semantic definitions beneath it (see Chapter 8).
- **Cortex Search**: A Snowflake service that builds a managed search index over text so that retrieval for retrieval-augmented generation (RAG) can run inside Snowflake. It is one way to implement retrieval over governed documents (see Chapter 10).
- **Credit (Snowflake)**: The billing unit for Snowflake compute and some services. Warehouse credit consumption roughly doubles with each size step, so a 2X-Large warehouse uses about twice the credits of a Large for the same running time.
- **CRM (customer relationship management)**: The system field teams use to record accounts, contacts, calls, and plans. In pharma, Veeva CRM is the dominant example (see Chapter 12).
- **CSV (comma-separated values)**: A plain text file format where each line is a row and commas separate fields. CSV has no types and breaks on embedded commas and quotes, so it should be declared precisely in a file format definition.
- **Customer 360**: A unified view of one customer, usually an HCP or HCO, combining master data, prescriptions, claims, interactions, and content engagement. It is a data product goal that succeeds only if identity resolution is solid (see Chapter 15).

## D

- **Data catalog**: A searchable inventory of data assets with descriptions, owners, classifications, and lineage. Snowflake Horizon and third-party catalogs serve this role (see Chapter 7).
- **Data dictionary**: A structured description of every table and column, with business definition, data type, allowed values, source, owner, and sensitivity. It is one of the core elements of a data product specification (see Appendix B).
- **Data domain**: A business area that owns a set of related data, such as customer, product, or market access. Domains are the unit of ownership in data mesh and in federated governance.
- **Data engineer**: The role that builds and operates pipelines, models, and platform components. The Data Specialist writes the specifications and acceptance criteria that data engineers implement.
- **Data lake**: A storage repository that holds raw files in their native formats, usually in object storage, with schema applied when read. Lakes are flexible but can degrade into swamps without catalogs and ownership.
- **Data lakehouse**: An architecture that combines lake-style open storage with warehouse-style tables, transactions, and governance. Iceberg tables in Snowflake are one implementation of this idea (see Chapter 3).
- **Data lineage**: The recorded path that data takes from source through transformations to the reports and models that consume it. Lineage answers "where did this number come from?" and "what breaks if I change this column?"
- **Data mart**: A subject-specific subset of the warehouse designed for one group of users, such as a field sales mart or a market access mart. Marts are usually built from the same enterprise models and differ mainly in grain and scope.
- **Data mesh**: An organizational approach in which domain teams own and publish their data as products, governed by shared standards. It is a design choice about ownership, not a technology (see Chapter 14).
- **Data Metric Function (DMF)**: A Snowflake function that computes a data quality metric, such as null count or freshness, on a table and can be scheduled and alerted on. Check current Snowflake docs for supported built-in functions and custom function support (see Chapter 6).
- **Data minimization**: The principle that you collect, retain, and expose only the data needed for a stated purpose. In pharma it shapes which patient fields are allowed into commercial marts at all.
- **Data product**: A data asset packaged for a defined audience, with an owner, a documented specification, quality rules, service levels, and a versioned interface. A table alone is not a data product; a table with an owner, contract, and SLA can be (see Chapter 8).
- **Data residency**: The requirement that data be stored and processed in specific geographic regions. It affects where you create Snowflake accounts and which regions your AI features can use.
- **Data sharing (Snowflake)**: Granting another Snowflake account read access to your data without copying files. The consumer queries live data, and you control what is shared through secure views and shares.
- **Data steward**: A person accountable for the quality, definitions, and access rules of a data domain on a day-to-day basis. Stewards resolve definition disputes and approve changes to the data dictionary.
- **Data vault**: A modeling method built around hubs (business keys), links (relationships), and satellites (time-stamped attributes) that favors auditability and parallel loading. It is useful for integrating many sources in a regulated setting (see Chapter 2).
- **Data warehouse**: A central analytical database that stores integrated, historical, subject-oriented data for reporting and analysis. Snowflake is a cloud data warehouse, though it also supports lake and lakehouse patterns.
- **Database replication and failover**: Copying a Snowflake database to another account or region, and switching the primary role if the original fails. Replication is part of a disaster recovery plan and must be priced separately.
- **dbt (data build tool)**: An open-source tool that compiles SQL select statements into tables and views in the warehouse, with dependency management, tests, and documentation. Most modern transformation layers in Snowflake use dbt (see Chapter 5).
- **Deduplication**: The process of identifying and removing or merging records that refer to the same real-world entity or event. Duplicate Rx rows from a re-sent vendor file are a common example.
- **Deterministic matching**: Linking records only when a rule matches exactly, such as the same NPI. Deterministic matching is precise and explainable, and it is the first step in any identity resolution design.
- **Dimension table**: A table holding descriptive context for facts, such as prescriber, product, geography, or date. Dimensions are usually wide and change slowly (see Chapter 2).
- **Dimensional modeling**: A method, popularized by Ralph Kimball, that organizes data into fact tables and dimension tables arranged as stars or snowflakes. It makes analytical queries simple to write and fast to run.
- **Direct share**: A Snowflake sharing mechanism that exposes objects from a provider account to a consumer account directly. Check current docs for the differences between direct shares and listings in the Marketplace.
- **Dynamic data masking**: A Snowflake policy that returns masked or partial values to users who lack the privilege to see the real value, based on their role. The stored data is unchanged; only what the query returns differs.
- **Dynamic table**: A Snowflake table defined by a query and a target lag, which Snowflake keeps refreshed automatically within that lag. It replaces some hand-built pipelines of tasks and streams (see Chapter 5).

## E

- **Effective dating**: Storing the start and end dates for which a record is valid, such as a territory assignment from January 1 to March 31. Effective dating is what makes historical reporting reproducible.
- **ELT (extract, load, transform)**: A pattern that loads raw data into the warehouse first and transforms it there with the warehouse's compute. ELT is the default in Snowflake-centered designs (see Chapter 4).
- **Embedding**: A list of numbers that represents the meaning of a piece of text, image, or other content so that similar items sit close together in vector space. Embeddings are the basis of semantic search and RAG (see Chapter 10).
- **Enrollment table**: In closed claims, a table of the periods during which each member was covered by a plan. It lets you require continuous enrollment before a cohort index date.
- **Entity resolution**: The process of deciding which records in one or more sources refer to the same real-world entity. It combines deterministic rules, probabilistic scoring, and manual review (see Chapter 12).
- **Epic**: A large body of work that delivers a business outcome and is broken into stories. An epic such as "HCP 360 for field teams" might contain a dozen stories across ingestion, modeling, and reporting (see Chapter 13).
- **Error budget**: The amount of unreliability an SLO allows before work shifts from new features to stability. It turns reliability into a trade-off the business can see.
- **ETL (extract, transform, load)**: A pattern that transforms data in a separate process before loading it into the target. ETL remains common when sources need heavy cleansing or masking before they reach the warehouse.
- **Event**: A timestamped occurrence, such as a call, a sample drop, a content view, or a prescription fill. Event tables are usually large and append-only.
- **Expert determination**: A HIPAA de-identification method in which a qualified expert certifies that the risk of re-identifying an individual from the dataset is very small. It is an alternative to the Safe Harbor method (see Chapter 7).
- **Explainability**: The ability to describe why a model produced a given output, using techniques such as feature importance or SHAP values. Regulated and commercial stakeholders often require it before they act on model scores.
- **External access integration**: A Snowflake object that allows user-defined functions and stored procedures to call specific hosts outside Snowflake, by bundling one or more network rules and, optionally, secrets that hold credentials. It is the governed way for Snowflake code or an agent tool to call an outside API, such as the NPPES NPI Registry. Check current docs for supported languages and syntax (see Chapter 4 and Chapter 16).
- **External stage**: A Snowflake named pointer to files in external cloud storage, used with COPY INTO or Snowpipe to load data without moving the files first (see Chapter 4).
- **External table**: A Snowflake table whose data stays in external storage and is read in place, with metadata defined in Snowflake. It is useful for exploration, but it is usually slower than loading into native or Iceberg tables.
- **Extract**: The step in a pipeline that pulls data from a source, such as a vendor file, an API response, or a database query result.

## F

- **Fact table**: A table of measurable events or measurements at a defined grain, such as one row per prescriber per product per week. Facts hold numeric measures and foreign keys to dimensions (see Chapter 2).
- **Fail-safe**: A Snowflake period of additional data recovery for permanent tables, after Time Travel ends, which is available only to Snowflake for disaster recovery. You cannot query or configure it directly; check current docs for duration.
- **Feature**: An input variable to a machine learning model, such as "number of new prescriptions in the last 90 days" for an HCP. Features are engineered from raw data and must be computed the same way in training and in production (see Chapter 9).
- **Feature drift**: A change over time in the statistical distribution of a feature's values, such as a shift in the share of claims from a new payer. Drift often signals a source change before it shows up as lower model accuracy.
- **Feature store**: A system that stores, versions, and serves features for training and inference, with point-in-time correct retrieval for training. Snowflake Feature Store is one option (see Chapter 9).
- **Federated governance**: A model in which central standards are set once and enforced by platform controls, while domain teams make local decisions within those standards. It balances consistency with speed.
- **FHIR (Fast Healthcare Interoperability Resources)**: An HL7 standard for exchanging health records as structured resources such as Patient, Practitioner, and Observation. Clinical and health-system data increasingly arrives in FHIR format.
- **Fit for purpose**: The test that a dataset is accurate, complete, timely, and permitted enough for a specific decision or use. The same data can be fit for one purpose and unfit for another.
- **Foreign key**: A column that references the primary key of another table, used to express relationships. Snowflake lets you declare foreign keys but does not enforce them, so pipeline tests must check referential integrity.
- **Formulary**: A payer's list of covered drugs, usually with tiers and utilization rules such as prior authorization. Formulary status is a central input to market access analytics.
- **Freshness**: How recently a dataset was updated relative to the real-world event it describes, measured as the lag between the latest record and the current time. Freshness is one of the first items in a data product SLA.
- **Full refresh**: Rebuilding a table entirely from its source on each run. It is simple and correct but expensive for large tables, which is why incremental loading is preferred where possible.
- **Function (UDF)**: A user-defined function, written in SQL, JavaScript, Python, Java, or Scala in Snowflake, that returns a scalar value or a table for use in queries. Secure functions hide their definitions from consumers.

## G

- **GDPR (General Data Protection Regulation)**: The European Union regulation governing the processing of personal data of people in the EU, including rules on lawful basis, consent, data subject rights, and transfers. Global pharma programs must apply it to European HCP and patient data.
- **GenAI (generative AI)**: AI models that produce new text, images, code, or other content from a prompt. In commercial pharma, GenAI is used for content drafting, summarization, and conversational analytics, each with specific data and review requirements (see Chapter 10).
- **Gold layer**: In the medallion pattern, the layer of business-ready, consumption-oriented tables such as marts and data products. Gold tables should have owners, SLAs, and documented definitions (see Chapter 5).
- **Golden record**: The single agreed best version of an entity, such as an HCP, produced by master data management. Other systems should key to the golden record rather than rebuilding their own (see Chapter 12).
- **Governance**: The set of decisions, roles, policies, and controls that determine how data is owned, defined, accessed, protected, and retired. Governance is what lets different teams trust the same number (see Chapter 7).
- **Grain**: The level of detail a table represents, expressed as what one row means, such as "one prescriber, one product, one week." Declaring grain is the first step in any table specification, and mixing grains is a common source of double counting.
- **Guardrail**: A check or constraint placed around an AI system, such as a filter that blocks unapproved claims or a rule that restricts SQL generation to approved tables. Guardrails reduce risk but do not remove it.
- **GxP**: A family of good practice regulations in life sciences, such as good clinical practice (GCP), good manufacturing practice (GMP), and good pharmacovigilance practice (GVP). Systems that support regulated activities may need validation and audit trails to meet GxP expectations.

## H

- **HCO (health care organization)**: A hospital, clinic, health system, pharmacy, or other organization that delivers or pays for care. HCOs are a core master data entity alongside HCPs (see Chapter 12).
- **HCP (health care professional)**: An individual who prescribes, administers, or recommends medicines, such as a physician, nurse practitioner, or pharmacist. HCPs are the primary targets and identities in commercial pharma data.
- **HIPAA (Health Insurance Portability and Accountability Act)**: The US law that governs the privacy and security of protected health information held by covered entities and their business associates. It defines de-identification methods and the rules for handling PHI (see Chapter 7).
- **Horizon (Snowflake Horizon)**: Snowflake's governance capabilities, which include a catalog, tagging, access and lineage views, and data quality monitoring. Check current docs for the features available in your edition.
- **Hub-and-spoke**: A structure in which a central team provides platform, standards, and shared assets while spoke teams build their own products. It is a common middle ground between fully centralized and fully federated delivery (see Chapter 14).
- **Hybrid table**: A Snowflake table designed for low-latency row-level reads and writes alongside analytics, which suits operational lookups. Check current docs for supported patterns and limits.

## I

- **Iceberg table**: A table in the Apache Iceberg format, which Snowflake can create and manage with data stored in your cloud storage. Iceberg tables let other engines read the same data without a copy (see Chapter 3).
- **Idempotency**: The property that running an operation more than once has the same effect as running it once. Idempotent pipelines can be retried safely after a failure (see Chapter 5).
- **Identity resolution**: The matching and merging of records that refer to the same person or organization across sources. It is a prerequisite for any HCP 360 or cross-source measure (see Chapter 12).
- **Incremental model**: A transformation that processes only new or changed rows since its last run, instead of rebuilding the whole table. It saves compute but needs careful handling of late-arriving and updated records.
- **Inference**: Using a trained model to produce predictions on new data. Inference can be batch or real time, and its cost and latency drive the serving design (see Chapter 11).
- **Information schema**: A set of views in each Snowflake database that describe its objects, columns, and privileges. It is the built-in way to query metadata within a database.
- **Infrastructure as code (IaC)**: Declaring platform objects, such as Snowflake roles, warehouses, databases, grants, and service users, in version-controlled files that a tool applies, instead of creating them by hand. It makes environments reproducible and every change reviewable (see Chapter 5 and Chapter 16).
- **Ingestion**: The process of bringing data from sources into the platform, through batch files, APIs, CDC, or streams (see Chapter 4).
- **Integration**: Combining data from multiple sources into consistent, conformed structures so that they can be analyzed together.
- **Interface versioning**: Giving each consumer-facing interface of a data product (published tables, semantic views, APIs, and agent tools) a version number and a written rule for which changes are breaking. Removing a field or changing its meaning is breaking; adding an optional field is not (see Chapter 8 and Chapter 16).
- **IQVIA**: A global provider of healthcare data, analytics, and technology, whose products (Xponent, NPA, NSP, APLD, and OneKey) are common inputs to pharma commercial analytics (see Chapter 12).
- **IQVIA ID**: The proprietary identifier IQVIA assigns to HCPs and HCOs in its products. It is licensed, must be crosswalked to your master ID, and can change when IQVIA re-masters its universe.

## J

- **Join key**: The column or set of columns used to link two tables. A join key that is not unique on one side creates duplicate rows, which is the most common reason totals inflate.
- **JSON (JavaScript Object Notation)**: A text format for nested key-value data, common in APIs and event messages. Snowflake loads JSON into VARIANT columns and lets you query nested fields directly.

## K

- **KOL (key opinion leader)**: A clinician or researcher whose views influence peers, usually tracked by Medical Affairs. KOL data is typically firewalled from sales targeting by policy and by contract (see Chapter 12).
- **KPI (key performance indicator)**: A measure chosen to track progress toward a business goal, such as weekly TRx growth or NBRx share. Each KPI needs a written definition with grain, filters, source, and time basis.

## L

- **Label**: The outcome a supervised machine learning model is trained to predict, such as "prescribed in the next 90 days." Labels must be defined as of a time, so that information from after that time cannot leak into features (see Chapter 9).
- **Lag (data lag)**: The time between an event and the date the vendor or source delivers it. Vendor lag caps how fresh your reporting can ever be, regardless of how fast your pipeline runs (see Chapter 12).
- **Late-arriving data**: Records that arrive after the period they belong to has already been reported, such as a pharmacy claim submitted two weeks late. Designs must decide whether to restate history or to hold the record in a separate adjustment.
- **Latency**: The delay between an event happening and its effect being visible in a system. Latency targets belong in the SLA, and they should be stated as numbers, not as "near real time."
- **Leakage (data leakage)**: Information in a model's training features that would not be available at prediction time, which inflates measured accuracy and then fails in production. Point-in-time joins are the main defense (see Chapter 9).
- **Line of therapy**: The sequence of treatments a patient receives for a condition, such as first line, second line, and so on. It is derived from claims or medical records and depends on washout rules and gap definitions.
- **Lives (covered lives)**: The number of people covered by a payer or plan. Coverage counts are a standard denominator in market access and closed claims analysis.
- **LLM (large language model)**: A neural network trained on large text corpora to predict and generate language, used for summarization, extraction, classification, and conversation. LLM outputs are probabilistic and must be evaluated against known answers (see Chapter 10).
- **Logic (business logic)**: The rules and calculations that turn source data into business meaning. Business logic should be documented in the specification and the semantic layer, and tested.

## M

- **Managed connector**: A pre-built ingestion component, often offered by a vendor or marketplace, that moves data from a source system into Snowflake with minimal custom code. Connectors reduce build effort but still need monitoring and a contract on schema changes (see Chapter 4).
- **Market access**: The function that works with payers, pharmacy benefit managers, and health systems to secure coverage and favorable formulary position for a product. Market access analytics measure coverage, prior authorization, and patient access (see Chapter 12).
- **Master data management (MDM)**: The discipline and tooling that resolve many source records about the same entity into one governed golden record. MDM is the owner of HCP and HCO identity in a well-run pharma platform (see Chapter 12).
- **Materialized view**: A stored, precomputed result of a query that Snowflake keeps up to date for a single base table, trading storage and maintenance cost for faster reads. Check current docs for restrictions.
- **MCP (Model Context Protocol)**: An open protocol, introduced by Anthropic, that standardizes how AI applications discover and call tools and read resources from external servers. A data product exposed through an MCP server can be used by any MCP-compatible agent, which makes tool descriptions and entitlements part of the product interface (see Chapter 16).
- **MCP server (Snowflake managed)**: A Snowflake-hosted MCP server that exposes selected Snowflake objects, such as Cortex Analyst over semantic views and Cortex Search services, as tools to MCP-compatible agents, with requests running under Snowflake authentication, roles, and policies. Supported tool types and setup change, so check current Snowflake docs (see Chapter 16).
- **Medallion architecture**: A layered design, usually bronze, silver, and gold, in which data is progressively cleaned, conformed, and made business-ready (see Chapter 5).
- **Medical claims**: Claims for services delivered by providers, such as office visits, procedures, and hospital stays. They carry diagnosis and procedure codes that define patient populations.
- **Metadata**: Data about data, such as table names, column types, owners, freshness, lineage, and tags. Metadata is also an input to AI systems, which use descriptions to decide which tables to query (see Chapter 10).
- **Metric layer**: A central, reusable definition of business metrics, such as TRx or share, that every tool queries the same way. A metric layer prevents each dashboard from computing TRx differently (see Chapter 8).
- **Micro-partition**: The unit of physical storage in Snowflake, a compressed, immutable columnar file of roughly 50 to 500 MB of uncompressed data, with metadata on each column's range. Pruning skips micro-partitions that cannot match a query filter (see Chapter 3).
- **Migration**: Moving data, pipelines, or workloads from one platform to another, including validation that results match. Migrations fail most often on undocumented logic, not on data volume (see Chapter 14).
- **MLOps**: The practices and tooling for building, deploying, monitoring, and retraining machine learning models reliably. It extends DevOps to data and models (see Chapter 11).
- **MLR review (medical, legal, regulatory)**: The internal review process that approves promotional and medical content for accuracy, balance, and compliance before use. Content data pipelines must reflect MLR status accurately (see Chapter 12).
- **Model card**: A short document describing a model's purpose, training data, performance, limitations, and intended use. It is a governance artifact for AI models.
- **Model drift**: A decline in model performance over time caused by changes in the data or in the relationship between inputs and outcomes. Monitoring must compare predictions with later outcomes (see Chapter 11).
- **Model registry**: A catalog of trained model versions, with metadata, metrics, lineage, and deployment status. Snowflake Model Registry supports versioned models inside the platform (see Chapter 11).
- **Model-ready dataset**: A dataset shaped for a specific model, with one row per entity and time point, the right label, point-in-time features, and documented exclusions. See Appendix B for the request template.
- **Multi-cluster warehouse**: A Snowflake virtual warehouse that can add clusters automatically to handle many concurrent queries, then remove them when demand falls.

## N

- **NBA (next best action)**: A recommendation of the most valuable action to take with a customer, such as which message to send or which HCP to call next. NBA models combine propensity, content, and channel rules (see Chapter 15).
- **NBRx (new-to-brand prescriptions)**: Prescriptions for patients starting the brand for the first time, not switching from another product or continuing an existing therapy. NBRx is a leading indicator of brand growth and needs a clear patient history rule to compute.
- **NCPDP (National Council for Prescription Drug Programs)**: The standards body whose transaction formats underpin most pharmacy claims. NCPDP field names appear in many pharmacy claim feeds.
- **NDC (National Drug Code)**: The FDA's product identifier for a drug, composed of labeler, product, and package codes. Pharmacy and dispensing data are usually keyed by NDC, often in an 11-digit normalized form.
- **Network rule**: A Snowflake schema-level object that lists network identifiers, such as host names and ports, and the direction of traffic they apply to. Egress network rules name the outside hosts that an external access integration may reach; ingress rules can restrict where connections come from. Check current docs for modes and types (see Chapter 4).
- **Normalization**: Organizing tables to reduce redundancy by storing each fact once, typically to third normal form. Transactional systems favor normalization; analytical models usually denormalize for speed.
- **Not null**: A constraint or test requiring that a column always has a value. Not-null is a basic completeness check in DQ rule registers.
- **NPA (National Prescription Audit)**: An IQVIA product reporting national and sub-national prescription volumes by product and channel, without prescriber-level detail. It is the usual source for market size and share (see Chapter 12).
- **NPI (National Provider Identifier)**: A 10-digit identifier issued by CMS to US health care providers and organizations, public and stable. It is the best natural key for US HCPs, though not every HCP has one.
- **NPPES (National Plan and Provider Enumeration System)**: The CMS registry where NPIs are issued and updated. It is a public reference for checking provider names, specialties, and addresses.
- **NRx (new prescriptions)**: Prescriptions with a refill number of zero, meaning the first fill of a new prescription. A new prescription is not always a new patient, so NRx and NBRx are different measures.
- **NSP (National Sales Perspectives)**: An IQVIA product measuring sales into channels such as retail, hospital, and mail order at the wholesale level. It answers where product moved, not who prescribed it (see Chapter 12).
- **Null**: A marker for a missing or unknown value in SQL. Nulls behave unexpectedly in comparisons and aggregations, so specifications should state how null is treated.

## O

- **Object tag**: A key-value label attached to a Snowflake object or column, used for classification, cost allocation, and policy assignment. Tags let one masking policy apply to every column tagged as PHI (see Chapter 7).
- **ODS (operational data store)**: A database holding current or recent operational data integrated from sources, used for operational reporting rather than long-term history.
- **OLAP (online analytical processing)**: Workloads that read large volumes of data to answer analytical questions, usually with aggregations over many rows. Warehouses are built for OLAP.
- **OLTP (online transaction processing)**: Workloads that handle many small reads and writes, such as order entry or a CRM record update. Operational databases are built for OLTP.
- **Onboarding (data source)**: The process of adding a new source, including contract review, access setup, sample delivery, profiling, and sign-off on the specification. Onboarding time is often the biggest hidden cost of a new data product.
- **OneKey**: IQVIA's master reference of HCPs and HCOs, used to resolve identities across IQVIA products. Whether you may use it outside IQVIA sources depends on your license.
- **Open claims**: Claims captured from clearinghouses, switches, and pharmacies, covering many patients but seeing only transactions that flow through those pipes. Open claims give broad reach and incomplete journeys (see Chapter 12).
- **Operational data store**: See ODS.
- **Orchestration**: Scheduling, sequencing, retrying, and monitoring pipeline tasks across systems. Orchestrators such as Airflow, Dagster, and Snowflake Tasks handle it (see Chapter 5).
- **Owner (data owner)**: The person accountable for a dataset's definition, quality, access approvals, and change decisions. Every data product needs a named owner, not a team alias alone.
- **Owner's rights**: The default mode for Snowflake stored procedures, in which the procedure runs with the privileges of its owning role rather than the caller's. An agent tool built as an owner's rights procedure can return data the caller could not query directly, so it must filter by entitlement itself and be reviewed. Check current Snowflake docs for restrictions in this mode (see Chapter 7 and Chapter 16).

## P

- **Partition**: A division of a table's data by the value of a column, such as date, used to limit how much data a query reads. Snowflake partitions automatically through micro-partitions and does not expose manual partitions the way some engines do.
- **Persistence (therapy)**: The length of time a patient stays on therapy without a gap beyond a defined threshold. Persistence depends on the source type and its definition of a gap, so it must be named precisely.
- **Pharmacovigilance (PV)**: The science and activities relating to detecting, assessing, and preventing adverse effects of medicines. PV systems have their own regulatory data standards, and commercial data must not be silently used for safety purposes.
- **PHAST (Symphony Health)**: Symphony's family of prescription and sales tracking products, including prescriber-level prescription data comparable to Xponent (see Chapter 12).
- **PHI (protected health information)**: Individually identifiable health information held or transmitted by a covered entity or business associate under HIPAA. PHI requires controls on access, transmission, and audit (see Chapter 7).
- **PII (personally identifiable information)**: Information that can identify an individual, such as name, email, phone, or address. PII handling rules apply in many jurisdictions, and HCP data is itself personal data in many contexts.
- **Pipeline**: A sequence of steps that moves and transforms data from sources to targets, scheduled or triggered, with monitoring and failure handling.
- **PlanTrak**: An IQVIA Xponent variant that adds payer and plan dimensions to prescriber-level prescription data, showing which plans a prescriber's scripts are written under (see Chapter 12).
- **Point-in-time correctness**: Ensuring that every feature or fact used for a historical example reflects only what was known at that time. It is the core requirement for training data and historical reporting alike (see Chapter 9).
- **Policy (Snowflake)**: A Snowflake object, such as a masking policy, row access policy, or projection policy, that controls how data is returned to a query based on the querying role or other context. Policies attach to columns or tables and enforce rules centrally.
- **Primary key**: A column or set of columns that uniquely identifies a row in a table. Snowflake lets you declare primary keys but does not enforce uniqueness, so a test must verify them.
- **Profiling**: Analyzing a dataset to describe its values, null rates, distributions, cardinality, and patterns. Profiling is the first step of onboarding and the input to DQ rule design.
- **Projection (projected Rx)**: An estimate of national totals derived from a sample of pharmacies or prescribers, used to scale raw counts to market level. Projected and raw values answer different questions and must not be summed together (see Chapter 12).
- **Promotion (content)**: Content approved for use in promotional activity with customers, such as a detail aid or email. Promotion status and claim references are required metadata for any content asset.
- **Provenance**: The record of where a piece of data came from, including source, version, and transformation history. Provenance is necessary for audit and for explaining a number to a regulator or executive.
- **Pseudonymization**: Replacing direct identifiers with tokens or codes that can be re-linked only with a separately held key. Pseudonymized data is still personal data under GDPR, unlike properly anonymized data.
- **Pushdown**: Executing parts of a query in the source system or engine instead of moving all the data to the caller. Snowflake pushes filters and joins down to storage automatically in many cases.

## Q

- **Quality gate**: A check that must pass before data or a model is promoted to the next environment or to consumers. Gates are where DQ rules become enforcement, not just reporting (see Chapter 6).
- **Query profile**: A Snowflake tool that shows the execution plan and time spent per step for a query, used to find expensive joins, scans, and spills. It is the first place to look when a query is slow.
- **Query tag**: A label set on a session or query so that it can be grouped in cost and usage reports, such as by pipeline or by application. Query tags make chargeback possible.

## R

- **RAG (retrieval-augmented generation)**: A pattern in which a system retrieves relevant documents or records for a question and passes them to an LLM to ground its answer. RAG quality depends mostly on the retrieval data, not on the model (see Chapter 10).
- **RBAC (role-based access control)**: An access model in which privileges are granted to roles and roles are granted to users. Snowflake's role hierarchy, with roles such as SYSADMIN and SECURITYADMIN, is built on RBAC (see Chapter 7).
- **Re-identification risk**: The likelihood that an individual in a de-identified dataset can be identified by linking it with other data. It is the central risk assessed under HIPAA expert determination and GDPR.
- **Re-master (vendor)**: A vendor's periodic rebuild of its entity universe, which can change its internal IDs and merge or split entities. Re-masters break any fact table that keys directly on vendor IDs (see Chapter 12).
- **Reach**: The number or share of unique target customers who received or were exposed to a message or activity in a period. Reach must name its source and its unique-count basis, since reach and frequency are easy to confuse.
- **Reference data**: Relatively stable lists of codes and values, such as country codes, NDC directories, specialty taxonomies, and product hierarchies. Reference data should be versioned and loaded through the same controls as other data.
- **Regulatory**: Requirements set by government agencies that govern how data and content may be created, used, and retained. In pharma, these include FDA promotional rules, HIPAA, GDPR, and the Sunshine Act.
- **Reject table**: A table that holds rows failing validation rules, along with the reason, so they can be reviewed and reprocessed instead of being silently dropped. Reject handling is part of every serious ingestion design.
- **Reliability**: The consistency with which a system performs as specified over time. For data products, reliability is measured through freshness, completeness, and incident frequency against SLOs.
- **Resource monitor**: A Snowflake object that tracks credit usage for warehouses or an account and can notify or suspend compute when a threshold is reached. It is the main guardrail against runaway costs.
- **Reverse ETL**: Syncing curated data from the warehouse back into operational tools, such as a CRM or marketing platform. It delivers insights to frontline users but adds a second place where data can drift (see Chapter 14).
- **Roster**: A record of which person holds which position at which time, such as which representative covers which territory. Rosters change independently of alignments and must be effective-dated.
- **Row access policy**: A Snowflake policy that filters rows returned to a query based on the querying role or user, such as limiting a regional manager to their region. It lets one table serve many audiences without duplicates.
- **Row-level security**: Restricting which rows a user may see. In Snowflake, row access policies implement this without creating separate tables per audience.
- **Rx (prescription)**: A prescription, or a count of prescriptions. Rx counts are the basic unit of prescription volume in commercial analytics, always qualified by TRx, NRx, or NBRx.

## S

- **Safe Harbor**: The HIPAA de-identification method that removes 18 specified identifiers, such as names, dates more specific than the year, and geographic units smaller than a state, subject to exceptions. It is simpler than expert determination but can strip analytically useful detail.
- **Sales Ops (Sales Operations)**: The team that manages territories, alignments, incentive plans, targeting, and field reporting for the sales force. Sales Ops is often the main business partner for commercial data products.
- **Schema (database)**: The structure of a database, including its tables, columns, data types, and relationships. The term also names a namespace inside a Snowflake database.
- **Schema drift**: An unannounced change in a source's structure, such as a new column, a renamed field, or a changed data type. Drift breaks pipelines silently unless schema checks run on ingestion (see Chapter 6).
- **Schema evolution**: The controlled change of a table's schema over time, such as adding a column, with compatibility managed for downstream consumers. Schema changes should go through the data contract change process.
- **Schema-on-read**: The practice of applying structure only when data is queried, typical of data lakes. It speeds ingestion but moves quality problems to the reader.
- **Search optimization service**: A Snowflake service that builds additional access paths to speed up highly selective lookups on large tables. It consumes storage and credits and suits point lookups rather than broad scans.
- **Semantic layer**: A governed set of business definitions, metrics, dimensions, and relationships that sits between raw tables and consuming tools, so that everyone computes TRx the same way (see Chapter 8).
- **Semantic model**: A specific file or definition that describes tables, measures, dimensions, and relationships for a tool such as Cortex Analyst. It is one concrete form of a semantic layer.
- **Semantic versioning**: A version numbering convention, MAJOR.MINOR.PATCH, in which a major increase signals a breaking change, a minor increase an additive change, and a patch a fix that changes no meaning. For `get_hcp_profile`, moving from 1.2.0 to 1.3.0 adds an optional field, while 2.0.0 renames or redefines one (see Chapter 8).
- **Semantic view**: A Snowflake schema-level object that stores business semantics, such as metrics, dimensions, and relationships, for BI and AI tools to use. Check current docs for syntax and supported features (see Chapter 8).
- **Semi-structured data**: Data with tags or keys but no fixed schema, such as JSON, XML, or Avro. Snowflake stores it in VARIANT columns and lets you query its fields with path notation.
- **Sensitivity classification**: Labeling data by how sensitive it is, such as public, internal, confidential, or restricted (PHI). Classification drives which masking, access, and sharing controls apply.
- **Serverless task**: A Snowflake task that runs on Snowflake-managed compute without a named warehouse, billed by the compute it uses. Check current docs for pricing and limits.
- **Service level agreement (SLA)**: A commitment between a provider and consumers about service, such as "the weekly Xponent mart is available by 9 a.m. Monday on 98 percent of weeks." SLAs carry consequences and should be backed by SLOs.
- **Service level indicator (SLI)**: The measured quantity behind an SLO, such as the percentage of weeks the mart was ready on time. An SLI must be measured the same way every time.
- **Service level objective (SLO)**: An internal target for an SLI, usually stricter than the SLA it supports, such as 99 percent on-time delivery against an SLA of 98 percent. It gives the team an early warning before the SLA is at risk.
- **Service user**: A Snowflake user for a non-human identity, such as a pipeline, BI tool, or AI agent, created with `TYPE = SERVICE` so that it cannot sign in with a password and authenticates with a key pair, OAuth, or a programmatic access token. Each agent should have its own service user and a dedicated least-privilege role. Check current docs for supported authentication methods (see Chapter 7).
- **Share of voice (SOV)**: A measure of a brand's promotional activity relative to competitors, such as its share of calls or ad impressions in a class. SOV is a common input to share and call planning.
- **Shared database (Snowflake)**: A database created from a Snowflake share, read-only in the consumer account, whose data stays with the provider. Consumers query it without copying it.
- **Silver layer**: In the medallion pattern, the layer of cleansed, conformed, and deduplicated data, still close to source grain. Silver is where most data quality rules are enforced (see Chapter 5).
- **Slowly changing dimension (SCD)**: A dimension whose attributes change over time, handled by overwriting (Type 1), adding a versioned row (Type 2), or keeping prior values in extra columns (Type 3). Type 2 is the usual choice for alignments and affiliations (see Chapter 2).
- **Snapshot table**: A table that stores the state of a source at a specific time, such as a daily copy of the account table. Snapshots make point-in-time reporting possible when the source only keeps current values.
- **Snowflake**: A cloud data platform with separated storage and compute, support for structured and semi-structured data, data sharing, and built-in governance and AI features. It is the platform assumed in Book 2 (see Chapter 3).
- **Snowpark**: A Snowflake developer framework for writing data transformations and machine learning code in Python, Java, or Scala that runs inside Snowflake compute (see Chapter 11).
- **Snowpark Container Services (SPCS)**: A Snowflake service that runs containerized applications, such as an MCP gateway, a custom model, or an internal web app, on compute pools inside the Snowflake account, so the workload stays within Snowflake's network and access controls. Outbound calls still require an external access integration. Check current docs for regions and pricing (see Chapter 16).
- **Snowpipe**: A Snowflake service that loads files automatically as they land in a stage, using event notifications or API calls. It is designed for continuous, small-file loads (see Chapter 4).
- **Snowpipe Streaming**: A Snowflake API for low-latency ingestion of rows directly from applications or streaming systems without writing files first. Check current docs for supported clients and throughput.
- **Source system**: The application or database where data is originally created, such as Veeva CRM, a claims adjudication system, or a vendor's delivery system. The source system defines the truth for its own records.
- **Source-to-target mapping (STTM)**: A document listing each target column, its source column, its transformation rule, and its validation, used to specify and test a pipeline. It is the most common artifact a Data Specialist writes (see Appendix B).
- **Stage (Snowflake)**: A location for files used by Snowflake loading and unloading, either internal to Snowflake or external in cloud storage. Stages are referenced by COPY INTO and Snowpipe (see Chapter 4).
- **Stakeholder**: A person or group affected by or interested in a data product, such as Brand, Sales Ops, Market Access, Medical, or Compliance. Each stakeholder's acceptance criteria should be captured explicitly.
- **Star schema**: A dimensional model with one fact table at the center and dimension tables joined directly to it, drawn as a star. It is easy to query and is the default model for marts (see Chapter 2).
- **Stewardship**: The ongoing responsibility for a dataset's definitions, quality, and access, typically carried out by a data steward. Stewardship is the operating side of governance.
- **Stored procedure**: A named, reusable block of procedural code in Snowflake that can execute multiple statements with control logic. Stored procedures are often used to orchestrate loads and to encapsulate complex logic.
- **Stream (Snowflake)**: A Snowflake object that records the inserts, updates, and deletes on a table since the last time it was read, providing CDC-like change tracking. Streams are read by tasks or dynamic table logic (see Chapter 5).
- **Structured data**: Data organized into fixed rows and typed columns, such as a relational table of prescriptions. Structured data is easiest to validate and query.
- **Sunshine Act (Open Payments)**: The US federal law requiring manufacturers to report payments and transfers of value to HCPs and teaching hospitals, published by CMS. It creates a public dataset and internal reporting obligations.
- **Surrogate key**: A system-generated identifier with no business meaning, used as the primary key of a dimension to insulate the warehouse from changes in business keys. Surrogate keys are standard in Type 2 dimensions.
- **Symphony Health**: A healthcare data and analytics company whose products include prescription, hospital, and sales tracking data and patient-level claims. Its coverage and projections differ from IQVIA's, so the two should not be expected to reconcile exactly (see Chapter 12).
- **Syndicated data**: Data a vendor collects once and licenses to many clients, such as prescription audits or patient-level claims. Syndicated data is the backbone of pharma market measurement (see Chapter 12).
- **Synthetic data**: Artificially generated data that mimics the statistical properties of real data without containing real individuals. It is useful for testing pipelines and for early model development, but it cannot replace validation on real data.

## T

- **Table format**: The specification that defines how a table's data files and metadata are organized, such as Iceberg, Delta, or Snowflake native format. The table format determines which engines can read the table.
- **Tagging**: Attaching object tags to data assets for classification, governance, cost tracking, or policy assignment. Consistent tagging is the basis of automated masking and of chargeback (see Chapter 7).
- **Target lag**: The maximum delay Snowflake's dynamic table must keep the output behind its source, which the platform uses to schedule refreshes. It is the freshness commitment of a dynamic table.
- **Task (Snowflake)**: A Snowflake object that runs a SQL statement or stored procedure on a schedule or after another task, forming a simple directed graph of work (see Chapter 5).
- **Taxonomy (provider)**: A standard classification of provider types and specialties, such as the NUCC taxonomy codes used on NPI records. Taxonomy codes are more granular than specialty labels and are often needed for targeting.
- **Terraform**: An infrastructure-as-code tool from HashiCorp that creates and changes cloud and platform resources from declarative configuration files, showing a plan of changes before applying them. Snowflake objects are managed through a Snowflake Terraform provider whose resource names change between versions, so check current provider docs (see Chapter 5 and Chapter 16).
- **Territory**: A geographic or account-based unit assigned to one representative or team for a defined selling responsibility. Territories are the unit of performance reporting and incentive compensation.
- **Time Travel (Snowflake)**: A Snowflake feature that lets you query, clone, or restore data as it was at a past point within a retention period. Retention depends on the object type and edition, so check current docs.
- **Timeliness**: A data quality dimension measuring whether data is available when it is needed, closely related to freshness. A correct file delivered three weeks late may be timely for an annual review but not for a weekly call plan.
- **Tokenization (data)**: Replacing sensitive values with tokens that can be linked across datasets without revealing the underlying identifier. In pharma, patient tokens allow linkage only under strict contracts and certification (see Chapter 7).
- **Tokens (LLM)**: The units of text that a language model reads and writes, usually word fragments. Token counts drive the cost and context window limits of LLM use (see Chapter 10).
- **Train/serve skew**: A mismatch between how features are computed for model training and how they are computed for serving, producing a model that performs differently in production. Shared feature definitions and a feature store reduce it (see Chapter 9).
- **Training dataset**: The set of labeled examples a model learns from, built with point-in-time correct features and a documented split between training, validation, and test periods (see Chapter 9).
- **Transformation**: A step that changes data from one form to another, such as cleansing, joining, aggregating, or deriving a new field. Transformations should be version-controlled, tested, and documented.
- **Trust Center (Snowflake)**: A Snowflake interface that surfaces security findings and recommended controls for an account. Check current docs for the checks available in your edition.
- **TRx (total prescriptions)**: The total number of prescriptions dispensed in a period, including new and refill prescriptions. TRx is the most common volume measure in pharma analytics and must be qualified by source and projection basis.

## U

- **UAT (user acceptance testing)**: The phase in which business users test a delivered data product against their acceptance criteria and sign off that it is fit for use. UAT is a business activity, not an engineering test (see Appendix B).
- **Uniqueness**: A data quality dimension measuring whether each real-world entity or event appears only once where it should. Duplicate HCP records inflate counts and fragment engagement history.
- **Unstructured data**: Data without a predefined tabular structure, such as PDFs, emails, slide decks, call notes, and images. Turning unstructured data into usable form is a central task of GenAI data work (see Chapter 10).
- **Upsert (merge)**: An operation that updates a row if its key exists and inserts it if not. The SQL MERGE statement is the usual implementation in Snowflake.
- **User story**: A short statement of a need from a user's perspective, in the form "As a [role], I want [capability] so that [benefit]." User stories are written with acceptance criteria attached (see Appendix B).

## V

- **Validity**: A data quality dimension measuring whether values conform to the allowed domain, format, and range, such as a valid NPI check digit or a date within the expected range. Validity is usually the easiest dimension to test automatically.
- **VARIANT (Snowflake)**: A Snowflake data type that stores semi-structured values such as JSON, Avro, or Parquet with their nested structure. It enables flexible ingestion without a fixed schema.
- **Vector search**: Finding the stored items whose embeddings are closest to a query embedding, usually by a similarity measure. It returns content by meaning rather than exact keyword match (see Chapter 10).
- **Veeva CRM**: The dominant customer relationship management platform in life sciences, used to manage accounts, contacts, calls, and call plans for field teams (see Chapter 12).
- **Veeva Vault**: Veeva's content and document platform, including PromoMats for promotional content and MedComms for medical content, whose approval metadata feeds content and GenAI data work (see Chapter 12).
- **Vendor license**: The contract that governs how a data vendor's data may be stored, combined, used, shared, and retained. License terms can restrict use to specific products, teams, or time periods, and they must be checked before a data product is designed (see Chapter 7).
- **Version (data product)**: A labeled state of a data product's interface and logic, so that consumers know which definition they relied on. Breaking changes require a new major version and a notice period.
- **Virtual warehouse (Snowflake)**: A named cluster of compute resources in Snowflake that executes queries and loads data. Warehouses have a size, an auto-suspend setting, and their own credit consumption.
- **VPC (virtual private cloud)**: An isolated network in a cloud provider, used to control how services connect privately. Private connectivity to Snowflake and to sources is set up at this layer.

## W

- **Watermark**: A stored marker, such as the latest timestamp or sequence number processed, that tells an incremental pipeline where to resume. A wrong watermark causes missed or duplicated rows.
- **Wide table**: A table with many columns, often one row per entity with dozens or hundreds of features or attributes. Wide tables are common in ML training and in some marts, at the cost of duplication and harder change management (see Chapter 2).
- **Window function**: A SQL function that computes a value across a set of rows related to the current row, such as a running total or a rank within a territory. Window functions are a common way to compute line of therapy or recent-activity measures.

## X

- **Xponent (IQVIA Xponent)**: IQVIA's prescriber-level prescription data product, with weekly or monthly TRx and NRx by prescriber and product, projected to national levels. It is the backbone of sales targeting and incentive compensation reporting (see Chapter 12).

## Y

- **YAML (YAML Ain't Markup Language)**: A human-readable text format for configuration, widely used for dbt project files, pipeline definitions, and Snowflake semantic models. Indentation is significant, so small formatting errors change meaning.

## Z

- **Zero-trust access**: A security approach that grants access based on verified identity, device, and context for each request, rather than trusting anything inside the network. It influences how data platforms authenticate users and services.
