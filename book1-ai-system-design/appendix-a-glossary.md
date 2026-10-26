# Appendix A: Glossary

> This glossary defines the system design, data engineering, and AI terms used across Book 1. Entries are alphabetical. Where a term has a pharma-commercial flavor, the example uses invented but realistic numbers and sources such as IQVIA prescription data, Veeva CRM, claims feeds, and MLR review. Where a Snowflake feature is named, check current Snowflake documentation for version-specific behavior and availability, since these features change often.

## A

**A2A (Agent2Agent protocol)**: An open protocol, first published by Google in 2025 and since moved to open governance under the Linux Foundation, that lets agents built by different teams or vendors discover each other and exchange tasks and messages. Discovery uses an agent card, and messages are exchanged as JSON-RPC over HTTP. MCP connects an agent to tools; A2A connects an agent to other agents. Example: a Sales Ops pre-call agent asks a Medical Information agent, owned by another team, for the approved response to an HCP's question. The specification is still evolving, so check the current version. See Chapter 18.

**ABAC (attribute-based access control)**: An access model that decides who can see or do something based on attributes of the user, the data, and the context, such as region, role, or data sensitivity tag. Example: a Market Access analyst sees payer contract terms only for the therapeutic areas assigned to them, and the rule is enforced by the attributes rather than a hand-maintained list of users.

**ACID**: The four guarantees a transactional database makes: Atomicity (all or nothing), Consistency (rules are never broken), Isolation (concurrent transactions do not see each other's half-finished work), and Durability (committed work survives a crash). Example: a claim reversal and its offsetting ledger entry either both commit or neither does.

**Act claim**: A field (`act`, for "actor") in a security token, defined by OAuth token exchange (RFC 8693), that names the party acting on behalf of the token's subject. Example: a token whose subject is rep `jsmith` and whose `act` claim names `precall-agent` tells the MCP gateway and the audit log that the agent acted for the rep, so the action is attributed to both. See Chapter 18.


**Active learning**: A training approach in which the model selects the examples it is least certain about and asks a human to label them, which is cheaper than labeling data at random. Example: an MLR reviewer labels only the AI-flagged claims in draft promotional copy where the model was unsure.

**Adapter**: A small set of extra trainable weights added to a frozen base model so it can learn a specialized behavior without retraining the whole model. See LoRA.

**Agent**: A program that uses a language model to decide which tool to call next, reads the result, and repeats until a goal is met or a stop condition is hit. Example: an agent that pulls an HCP's last six months of prescribing, checks recent call notes in Veeva CRM, and drafts a briefing for the rep.

**Agent card**: A small JSON document that an A2A agent publishes, typically at a well-known URL, describing its name, skills, endpoint, and the authentication it requires, so other agents can discover and call it. Example: the Medical Information agent's card lists a skill "answer_standard_response" and requires an OAuth token with a specific audience. See Chapter 18 and Appendix C, Example C4.

**Agent identity**: A distinct, managed identity for an agent in the identity provider, separate from both human users and shared service accounts, so the agent's actions can be attributed, scoped, monitored, and revoked on their own. Example: `precall-agent-prod` has its own identity and can only request downscoped tokens on behalf of signed-in reps, so disabling it does not affect any other integration. See Chapter 18.

**Agentic workflow**: A pipeline in which some steps are decided by a model at run time rather than fixed in code. These are easier to govern when the model chooses from a fixed menu of approved tools with typed inputs.

**Alerting**: Automatic notification to a person or channel when a metric crosses a defined threshold. Example: the data team is paged when the weekly Xponent load row count falls more than 20 percent below its trailing four-week average.

**Anonymization**: Removing identifiers in a way that cannot be reversed, so no individual can be re-identified. It is stronger than pseudonymization. Patient-level data rarely meets this bar unless it satisfies HIPAA Safe Harbor or Expert Determination, so check with privacy before assuming a dataset is anonymized.

**API (application programming interface)**: A documented contract that lets one program request data or actions from another. Example: a next-best-action service calls a Veeva CRM API to read the rep's upcoming call plan and write back recommendations.

**API gateway**: The front door for API traffic. It handles authentication, rate limiting, routing, logging, and sometimes request transformation before traffic reaches the backend services.

**Attention**: The mechanism inside a transformer model that lets each token weigh every other token in the input when building its representation. Because attention compares every pair of tokens, cost grows faster than input length, which is one reason long prompts are slower and more expensive.

**Audience (token)**: The claim in a security token (`aud`) that names the service the token is meant for. A service must reject tokens whose audience is not itself. Example: a token issued for the Veeva CRM MCP server is refused by the Snowflake data products server, so a leaked or misused token cannot be replayed elsewhere.

**Audit trail**: A tamper-evident record of who did what, when, and to which data, including before and after values where relevant. For GxP systems, 21 CFR Part 11 requires secure, computer-generated, time-stamped audit trails that cannot be altered by users.

**Authentication (authn)**: Proving that a user or system is who it claims to be. Example: a rep logs in through single sign-on with multi-factor authentication before the NBA app opens.

**Authorization (authz)**: Deciding what an already-authenticated identity is allowed to do or see. Authentication answers "who are you," authorization answers "what may you touch."

**Autoscaling**: Automatically adding or removing compute capacity in response to load, usually based on CPU, queue depth, or request rate. Useful for spiky workloads such as a campaign launch, but it needs a warm-up plan for models that take minutes to load.

**Availability**: The share of time a system is usable. A 99.9 percent target allows about 8.8 hours of downtime per year, while 99.99 percent allows about 53 minutes. Availability targets should be tied to what the business actually loses when the system is down.

**Availability zone**: One of several physically separate data centers within a cloud region, with independent power and networking. Spreading a service across zones protects it from a single facility failure.

## B

**Back-of-the-envelope estimation**: A rough calculation of volume, storage, throughput, or cost using round numbers, done to decide whether a design is in the right order of magnitude. Example: 40,000 reps' call notes at 2 KB per note is about 80 MB per day, so storage is not the hard problem and retrieval quality is.

**Backfill**: Reprocessing historical data through a new or corrected pipeline so the output is consistent over time. Example: rebuilding 36 months of territory alignment history after a realignment changes how accounts are assigned.

**Backpressure**: A signal from a slow consumer telling a fast producer to slow down, so queues do not grow without limit and memory does not run out. Without it, a surge of inference requests can overwhelm a model server and make every request time out.

**Baseline**: The simplest reasonable approach you must beat before a complex one is justified. Example: a rules-based HCP targeting list based on prescribing thresholds is the baseline a machine learning targeting model has to outperform on uplift.

**Batch inference**: Running a model over a large set of records on a schedule, writing the predictions to a table, and reading them later. Example: scoring all 1.2 million active HCPs every Sunday night for the Monday territory planning run.

**Batch processing**: Processing data in scheduled chunks, such as nightly loads, rather than record by record as it arrives. Most commercial pharma reporting is batch, with predictable windows and rerun capability.

**Bias**: A systematic error in model output that favors or disadvantages a group, often caused by unrepresentative training data. Example: a targeting model trained mostly on academic centers may under-recommend community oncology practices that prescribe the same product for different patient mixes.

**Blue-green deployment**: Running two identical production environments and switching traffic from the old one (blue) to the new one (green) at once. Rollback is a traffic switch rather than a rebuild.

**Bulkhead**: A design pattern that isolates resources such as threads, connections, or compute pools per workload, so one misbehaving workload cannot exhaust capacity for everything else. Example: batch scoring jobs run on a separate Snowflake virtual warehouse from the dashboards that Sales Ops uses in the morning.

**BI (business intelligence)**: The practice and tooling of turning data into reports and dashboards for decision makers. Examples include weekly brand performance dashboards and territory scorecards.


## C

**Cache**: A fast, temporary store that keeps the results of expensive operations so repeated requests are served quickly. Example: caching the answer to "what is the approved indication statement for product X" so every rep's tool does not re-query the content repository.

**Cache hit ratio**: The fraction of requests served from the cache rather than the slower source. A low ratio means the cache costs money and adds complexity without saving much.

**Cache invalidation**: Removing or refreshing cached entries when the underlying data changes. It is famously hard, and stale cached content is a real risk when approved promotional wording changes after MLR review.

**Caller's rights**: An execution model in which code runs with the privileges of the user who calls it, rather than those of the code's owner (owner's rights). Snowflake stored procedures can be defined either way. For agents, caller's rights means a tool returns only what the end user could see directly. Example: a `get_hcp_profile` tool running with the rep's rights is filtered by the rep's territory row access policy.

**Canary release**: Sending a small share of traffic, often 1 to 5 percent, to a new version and watching error and quality metrics before increasing the share. Useful for model updates where offline tests may miss real-world behavior.

**CAP theorem**: A result stating that when a distributed system is split by a network partition, it must choose between consistency (every read sees the latest write) and availability (every request gets a response). Real systems make this choice per operation, and the PACELC extension covers the trade-off when there is no partition.

**CDC (change data capture)**: Reading the database's internal change log to capture inserts, updates, and deletes as they happen, instead of re-reading whole tables. Example: capturing changes from a CRM account table so the data mart reflects account edits within minutes.

**CDN (content delivery network)**: A geographically distributed set of caches that serves static content, such as images and documents, from a location near the user.

**Chunking**: Splitting a document into smaller passages before creating embeddings for retrieval. Chunk size and boundaries strongly affect answer quality. Example: splitting a 60-page prescribing information document by section headings rather than fixed character counts, so a dosing answer is not cut in half.

**Circuit breaker**: A pattern that stops calling a failing dependency for a period after repeated errors, then probes it again. It prevents a slow or broken service from dragging down its callers.

**Citation**: A reference from a generated answer back to the source passage it was based on, such as a document ID and page. Citations make answers checkable, which matters for medical and regulatory content.

**Clickstream**: A time-ordered log of user interactions with a digital product, such as page views, clicks, and form submissions. Used for digital engagement analytics on HCP portals and brand websites.

**Cloud data warehouse**: A managed analytical database in the cloud that separates storage from compute and scales each independently. Snowflake is the warehouse used in this series.

**Cluster**: A group of machines that work together as one system. In data platforms, a cluster is the unit of compute that runs queries or training jobs.

**Cold start**: The delay the first request experiences while a service, container, or model is loaded into memory. Large language models and GPU-backed endpoints can take minutes to start, so cold starts must be planned for.

**Columnar storage**: Storing data by column rather than by row, so analytical queries that read a few columns from billions of rows scan far less data. Parquet files and Snowflake's internal storage both use this idea.

**Compliance**: Conformance with laws, regulations, and internal policies that apply to a system. In pharma this includes HIPAA, GDPR where EU data is involved, 21 CFR Part 11, the Sunshine Act, and industry codes of practice.

**Concept drift**: A change over time in the relationship between a model's inputs and the outcome it predicts, even if the inputs look the same. Example: a model that predicts script uptake stops working after a new competitor launches, even though the input fields are unchanged.

**Confused deputy**: A security flaw in which a program with broad privileges is tricked into using them for a party that should not have them. Agents are prone to it when they run under a powerful service account. Example: a rep asks an agent that runs as a national-access service account for "notes on Dr. Chen," and the agent returns notes from another territory the rep is not entitled to see. Delegated, downscoped tokens prevent it.

**Consistency**: How quickly and uniformly writes become visible to readers. Strong consistency means every read sees the latest write. Eventual consistency means replicas converge over time, which is cheaper and faster but can show stale data briefly.

**Container**: A packaged unit of software with its code, libraries, and configuration, run in an isolated environment on a shared host. Containers make a model service portable from a laptop to production.

**Context window**: The maximum number of tokens a language model can consider in one call, covering the prompt, retrieved content, conversation history, and the output. Exceeding it means content is dropped or the request fails.

**Control plane**: The part of a system that configures, deploys, and monitors the resources that do the real work. The data plane is the part that actually moves or processes data. Keeping them separate limits the blast radius of a configuration error.

**CI/CD (continuous integration and continuous delivery)**: Automated building, testing, and deployment of code and configuration on every change. For models and prompts, the pipeline also runs evaluation suites before promotion.

**Cosine similarity**: A measure of how closely two embedding vectors point in the same direction, ranging from -1 to 1. Retrieval systems use it to rank passages by semantic closeness to a question.

**CPU (central processing unit)**: The general-purpose processor that runs most software. Contrast with GPU.

**CRM (customer relationship management)**: A system that records interactions with customers. In pharma, Veeva CRM is the common system of record for field activity, call notes, and sample requests.

**Cross-validation**: Splitting training data into several folds and rotating which fold is held out for testing, to estimate how well a model generalizes. Helpful when data is limited, such as a rare-disease patient cohort.

## D

**Data catalog**: A searchable inventory of datasets, with owners, descriptions, schemas, tags, and usage. It answers "what data do we have and can I trust it" for analysts and engineers.

**Data contract**: A written agreement between a data producer and its consumers that specifies schema, freshness, quality rules, and ownership of a dataset. Example: the IQVIA-derived weekly prescription table guarantees delivery by 6 a.m. Eastern and no null NPI values in the prescriber key.

**Data dictionary**: A reference that defines each field in a dataset, including its meaning, type, allowed values, source, and business owner. It is a core deliverable for data product specifications.

**Data drift**: A change in the statistical distribution of a model's input data over time, such as a shift in the share of records from a new channel. It is detectable without knowing the outcome, unlike concept drift.

**Data lake**: A large repository that stores raw data in its original format, often files in object storage, with schema applied when the data is read. Flexible, but without governance it becomes a swamp of undocumented files.

**Data lakehouse**: An architecture that adds table management, transactions, and schema enforcement on top of data lake files, so one storage layer can serve both analytics and machine learning. Apache Iceberg and Delta Lake are common table formats.

**Data lineage**: A record of where a piece of data came from and what transformations produced it. Lineage answers "why does this number look like this" and is essential for audit and regulatory questions.

**Data mart**: A subset of a warehouse built for one business domain or team, such as a Market Access data mart with payer and formulary tables. Data marts make self-service analytics faster and easier to govern.

**Data mesh**: An organizational approach in which domain teams own and publish their own data products, with shared standards for discovery, quality, and access. It shifts ownership, not just technology.

**Data product**: A dataset or set of tables packaged for a defined consumer, with an owner, documented definitions, quality rules, a freshness commitment, and an access process. Example: the "HCP Universe" data product, owned by the commercial data team and consumed by Sales Ops and Brand.

**Data quality rule**: An explicit, testable condition that data must meet, such as "every active HCP has exactly one valid NPI" or "weekly unit sales are never negative." Rules should record severity and what happens when they fail.

**Data residency**: The requirement that data be stored and processed within specific geographic boundaries. Relevant for EU patient or HCP data under GDPR and for some national health regulators.

**Data steward**: The business person accountable for the meaning, quality, and access rules of a data domain. In pharma commercial data, a steward is often a Sales Ops or Market Access lead, not an engineer.

**Data warehouse**: A database designed for analytical queries across large, historical, integrated data, usually loaded through scheduled pipelines and modeled into facts and dimensions.

**Dead letter queue**: A holding area for messages that could not be processed after repeated attempts. It stops poison messages from blocking the queue and gives engineers a place to inspect and replay them.

**Deduplication**: Removing duplicate records so each real-world entity appears once. Example: the same physician appears under three slightly different name spellings across Xponent, CRM, and a claims feed, and deduplication merges them into one HCP record.

**Dimension table**: A table in a star schema that describes the who, what, where, and when of business events, such as HCP, product, geography, and date. Facts reference dimensions by key.

**Distributed system**: A system whose components run on multiple machines and communicate over a network. Distribution adds scale and resilience, and also partial failures, latency, and consistency problems.

**DNS (Domain Name System)**: The internet's directory that translates names such as an app's hostname into IP addresses. DNS changes can take time to propagate, which matters during failovers.

**Downscoped token**: A token with narrower permissions, a narrower audience, or a shorter lifetime than the credential it was derived from. Example: from the rep's sign-in token, the identity provider issues a 5-minute token that allows only read-only HCP 360 tools on the Snowflake data products server, for the rep's own territory. See Chapter 18 and Appendix C, Example C3.


**Dual write**: Writing the same change to two systems in separate steps, such as a database and a message queue. It is fragile because one write can succeed while the other fails, so the outbox pattern is usually safer.

**Durability**: The guarantee that data, once acknowledged as saved, survives crashes and hardware failures. Achieved through replication and persisted logs.

**Dynamic table (Snowflake)**: A Snowflake table defined by a query that Snowflake refreshes automatically to meet a target freshness lag. It can replace some hand-built task chains for transformations that are declarative. Check current docs for supported query features.

## E

**Embedding**: A list of numbers that represents the meaning of a piece of text, image, or other content, so that similar items sit close together in that numeric space. Retrieval systems use embeddings to find passages relevant to a question even when they share no keywords.

**Embedding model**: The model that turns text into embeddings. Choosing it affects retrieval quality, cost, language coverage, and how often you must re-embed the corpus when you change it.

**Encryption at rest**: Encrypting data while it is stored on disk or in object storage, so a stolen disk is unreadable without keys. Snowflake encrypts data at rest by default.

**Encryption in transit**: Encrypting data while it moves across a network, typically with TLS. Required for any PHI or proprietary data leaving a trusted boundary.

**Entity resolution**: The process of deciding which records across sources refer to the same real-world entity, using matching rules, identifiers, and sometimes probabilistic models. In pharma it is how HCP and HCO records from several vendors are linked to one master.

**Environment promotion**: Moving a versioned artifact (code, configuration, prompt, tool definition, model, or agent) from a development environment to test and then to production through defined checks, deploying the same artifact at each stage rather than rebuilding it. Example: RepAssist prompt version 2.4.1 is promoted from test to production only after its eval gate passes and, for a high-tier system, a governance approval ID is attached. See Chapter 19.

**Eval (evaluation)**: A repeatable test that scores a model or AI system against a labeled set of inputs and expected outputs, using metrics such as accuracy, groundedness, or refusal correctness. Evals are the regression tests of AI systems.

**Eval gate**: An automated step in a promotion workflow that runs evaluation suites against a candidate version and blocks promotion if any hard threshold fails. Example: a prompt edit that drops a fair-balance sentence fails the "zero unsubstantiated claims" threshold, and the CI workflow refuses to promote it to production. See Chapter 12, Chapter 19, and Appendix C, Example C7.


**Event sourcing**: Storing every state change as an immutable event and deriving the current state by replaying events. Gives a complete history for audit, at the cost of more complex queries and schema evolution.

**Event streaming**: Continuously publishing and consuming ordered streams of events, such as prescription transactions or rep check-ins, so downstream systems react in near real time. Apache Kafka and Snowflake's Snowpipe Streaming are examples of different approaches.

**Exactly-once processing**: The goal that each event affects the result exactly one time despite retries and failures. In practice it is usually achieved as at-least-once delivery plus idempotent processing.

**Experiment (A/B test)**: A controlled comparison in which users or territories are randomly assigned to a control and a treatment, and the difference in an outcome is measured. Example: half of the territories receive AI-generated call briefings for eight weeks to measure the effect on call quality and prescribing.

**Explainability**: The ability to give a human-understandable reason for a model's output. For regulated decisions such as targeting or patient-facing content, the explanation level needed depends on the risk and the governance policy.

**Exponential backoff**: A retry strategy that waits progressively longer between attempts, such as 1, 2, 4, and 8 seconds, often with random jitter. It prevents a recovering service from being flooded by synchronized retries.

**ELT (extract, load, transform)**: Loading raw data into the warehouse first and transforming it there with SQL. Common on Snowflake because compute is elastic and transformations are easy to rerun. Contrast with ETL.

**ETL (extract, transform, load)**: Extracting data from sources, transforming it in a separate processing layer, and then loading the cleaned result into the target. Older tools and some regulated pipelines still use this pattern.

## F

**Fact table**: A table in a star schema that records measurable business events, such as prescriptions dispensed or calls completed, with numeric measures and keys to dimension tables. Fact tables are usually the largest tables in a warehouse.

**Failover**: Switching work from a failed component to a standby component. Automatic failover is fast but must be tested, because a bad failover can cause split-brain or data loss.

**Fail-safe (Snowflake)**: A period after Time Travel expires during which Snowflake can recover data for disaster recovery purposes, accessible only through Snowflake support. Check current docs for the retention length on your edition.

**Fan-out**: The pattern where one request or event triggers many downstream calls or messages. Useful for broadcasting a content update to many channels, but it multiplies load and failure surfaces.

**Feature store**: A system that stores and serves the input variables (features) used by machine learning models, computing them once and reusing them consistently for training and for live predictions. It prevents training-serving skew.

**Few-shot prompting**: Including a small number of worked examples in a prompt so a language model learns the expected format or judgment without retraining. Example: three examples of approved versus rejected claim wording included in the MLR pre-check prompt.

**Fine-tuning**: Continuing the training of a pre-trained model on a smaller, specialized dataset so it behaves differently. It changes behavior and style more reliably than facts, so retrieval is often the better way to add knowledge.

**Foundation model**: A large model trained on broad data that can be adapted to many tasks, such as a general-purpose language or vision model. Most generative AI systems in pharma are built on foundation models from vendors.

**Freshness**: How current a dataset is relative to the real world, usually measured as the time since the last successful load or the age of the newest record. Freshness is a contract term, not just a property.

**Function calling**: A model capability in which the model returns a structured request to call a named function with arguments, rather than free text. Your code executes the function and returns the result. Also called tool use.

## G

**GDPR (General Data Protection Regulation)**: The European Union's data protection law. It governs processing of personal data, including for HCPs in the EU, and gives individuals rights such as access and erasure.

**Governance**: The set of decisions, roles, and processes that determine how data and models are owned, accessed, changed, and retired. Governance is what makes controls repeatable rather than heroic.

**GPU (graphics processing unit)**: A processor with thousands of small cores that performs the matrix arithmetic behind neural networks efficiently. Model training and high-throughput inference typically need GPUs.

**Grounding**: Constraining a model's answer to information supplied in the prompt or retrieved from trusted sources, and checking the answer against them. Grounding reduces hallucination but does not eliminate it.

**Guardrail**: A check or control placed around a model that blocks, rewrites, or flags unsafe inputs or outputs. Examples include blocking requests for off-label promotion language, detecting PII in output, and enforcing a topic scope.

**GxP**: A family of good practice quality guidelines in life sciences, including GMP (manufacturing), GCP (clinical), and GLP (laboratory). Systems that support regulated activities must be validated and controlled under these guidelines.

## H

**Hallucination**: A model output that is fluent and confident but not supported by its input or by fact. In a commercial setting, an invented trial result or an incorrect dosing sentence is a serious error even when the rest of the answer is correct.

**HCP (healthcare professional)**: A licensed clinician who prescribes, recommends, or administers medicines, such as a physician, nurse practitioner, or pharmacist. HCPs are identified in data by identifiers such as the National Provider Identifier (NPI).

**HCO (healthcare organization)**: A hospital, clinic, health system, pharmacy chain, or other facility where HCPs practice. HCOs are linked to HCPs through affiliations, which change often.


**HIPAA (Health Insurance Portability and Accountability Act)**: The United States law that governs the privacy and security of protected health information held by covered entities and their business associates. Commercial data that is properly de-identified falls outside its core rules.

**HNSW (hierarchical navigable small world)**: A graph-based index structure for approximate nearest-neighbor search over vectors. It is fast and accurate, and it trades memory and build time for query speed.

**Horizontal scaling**: Adding more machines or instances to handle more load. Contrast with vertical scaling.

**Hybrid search**: Combining keyword search (such as BM25) with vector similarity search and merging the results. Useful when users type product codes or exact trial names that embeddings can miss.

**Human-in-the-loop**: A design in which a person reviews, approves, or corrects a model's output before it has effect. Standard for patient-facing and promotional content, and for any action that changes a record of truth.


## I

**Idempotency**: The property that performing the same operation more than once has the same effect as performing it once. Idempotent writes make retries safe. Example: a sample-request API that uses a request ID so a retried submission does not ship two boxes of product.

**IaC (infrastructure as code)**: Defining infrastructure such as warehouses, roles, and networks in version-controlled configuration files so environments are reproducible and changes are reviewed. Tools include Terraform and Snowflake's own provider for Terraform.

**Immutable data**: Data that is written once and never changed, with corrections recorded as new records. Immutability simplifies audit and makes replay safe.

**Inference**: Running a trained model on new input to get a prediction or generated output. Contrast with training, which adjusts the model's weights.

**Ingestion**: Bringing data from sources into a platform. It covers connectivity, file arrival, schema capture, and the first landing of raw data.

**Instruction tuning**: Training a model on examples of instructions and good responses so it follows user requests more reliably. Most chat-style models are instruction tuned.

**IQVIA NPA (National Prescription Audit)**: A widely used IQVIA dataset reporting monthly prescription volume for pharmaceutical products. Exact definitions and refresh cadence depend on your license, so confirm with the vendor before writing a data dictionary.

**IQVIA Xponent**: IQVIA prescriber-level prescription data, showing prescriptions written by individual prescribers and linked to a prescriber identifier. Used for targeting, call planning, and sales force effectiveness analysis.

**IQVIA NSP (National Sales Perspectives)**: IQVIA sales data reflecting manufacturer and wholesaler sales. Often reconciled against prescription data to explain the gap between shipments and dispensing.

**IQVIA APLD (anonymous patient-level data)**: An IQVIA product family providing anonymized patient-level longitudinal records for analysis. Use is governed by strict license and privacy terms, so check contract scope before combining it with other sources.

## J

**JSON (JavaScript Object Notation)**: A text format for nested key-value and list data, widely used by APIs and by model inputs and outputs. Flexible, but its lack of enforced schema makes it easy to break downstream pipelines.


## K

**Kafka (Apache Kafka)**: A distributed event streaming platform that stores ordered, replayable logs of events, organized in topics. Widely used when many systems need the same event stream.

**Key-value store**: A database that stores values addressed by a unique key, offering very fast lookups by key but limited querying. Used for caches, sessions, and feature lookups.

**Kill switch**: A control that immediately disables a feature, model route, agent, tool, or MCP server without a code deployment, usually a flag checked on every request. Example: when a third-party content server starts returning unexpected instructions, the platform team flips its kill switch in the MCP gateway and every agent loses access to it within seconds. See Chapter 18 and Appendix C, Example C2.

**KPI (key performance indicator)**: A measure tied directly to a business goal, such as weekly TRx growth or the percentage of calls with a documented objective.

**Kubernetes**: A platform that schedules, scales, and restarts containers across a cluster of machines. Powerful but operationally demanding, so it is often used by platform teams rather than data teams directly.

**KV cache (key-value cache)**: In a transformer model, the stored intermediate attention data for tokens already processed, so the model does not recompute it for each new output token. It consumes GPU memory that grows with context length.

## L

**Label**: The correct answer attached to a training example, such as "this HCP switched to the brand within 90 days." Labels are often the most expensive and error-prone part of supervised learning.

**Latency**: The time between sending a request and receiving the response. Measured in milliseconds or seconds, and usually reported as percentiles rather than averages.

**Latency percentile (p50, p95, p99)**: The value below which that percentage of requests fall. p95 latency of 2 seconds means 95 percent of requests finish within 2 seconds. Averages hide the slow tail that users notice.

**LLM (large language model)**: A transformer-based model trained on very large text corpora to predict and generate language. Accessed via vendor APIs or self-hosted on GPUs.

**LLM-as-judge**: Using one language model to score the outputs of another against a rubric, such as groundedness or tone. It scales evaluation, but the judge must itself be validated against human ratings.

**Load balancer**: A component that spreads incoming requests across multiple servers so no single server is overloaded and failed servers are skipped.

**LoRA (low-rank adaptation)**: A fine-tuning technique that trains small low-rank matrices added to a frozen model. It is much cheaper in compute and storage than full fine-tuning and is often used to create task-specific adapters.


**Logs**: Time-stamped records of discrete events a system produces, such as a request received or an error raised. Logs are essential for debugging and audit, and they must be scrubbed of PHI before storage in shared tools.

## M

**Master data management (MDM)**: The discipline and tooling for maintaining one authoritative, governed record of core entities such as HCPs, HCOs, products, and payers, shared across systems.

**Materialized view**: A stored, precomputed query result that is refreshed on a schedule or when sources change, trading storage and refresh cost for fast reads. Dynamic tables in Snowflake serve a similar role.

**MCP (Model Context Protocol)**: An open protocol for connecting AI applications to external tools and data sources through a standard interface. It lets one tool server serve many AI clients, but it also widens the set of systems an agent can reach, so access control matters.

**MCP client**: The component inside an MCP host that holds a connection to one MCP server, sends it requests (such as listing or calling tools), and returns the results to the host. A host that uses three servers runs three clients.

**MCP gateway**: A proxy between MCP clients and many MCP servers that enforces enterprise controls in one place: authentication, per-role tool allow-lists, rate limits, redaction of sensitive data in tool results, an audit log of every call, a kill switch, and a check that each server and tool description matches an approved registry entry. Example: every agent in the company reaches the Snowflake, Veeva CRM, and content servers only through the gateway. See Chapter 18 and Appendix C, Example C2.

**MCP host**: The AI application a user interacts with (a desktop assistant, an IDE, or an agent service) that runs the model, creates MCP clients, and decides how tool results are used. The host is where user consent for tool calls is usually shown.

**MCP registry**: A catalog of MCP servers with their owners, endpoints, versions, approval status, and (in an enterprise registry) pinned hashes of approved tool descriptions. A public registry for openly available servers exists, but enterprises typically keep a private registry of approved servers. Example: the registry lists the Snowflake data products server version 1.4.0 as approved for production with a hash for each tool description. See Chapter 18.

**MCP resource**: Read-only content that an MCP server exposes by URI for the host to read and place in the model's context, chosen by the application rather than invoked by the model. Example: the data dictionary for the HCP 360 data product, exposed as a resource so the assistant can explain what each field means.

**MCP server**: A program that exposes tools, resources, and prompt templates over the Model Context Protocol. Example: a Snowflake data products server offering `get_hcp_profile` and `get_product_metrics`, enforcing entitlements on every call. See Chapter 10 and Appendix C, Example C1.

**MCP tool**: A function exposed by an MCP server that the model can choose to call, defined by a name, a description, an input schema, and optional annotations. The description is what the model reads to decide when to use the tool, so it deserves the same review as a data dictionary entry. See Chapter 10.

**Metadata**: Data about data, such as table owners, column types, refresh times, tags, and lineage. Good metadata is what makes a catalog useful.

**Metric**: A numeric measurement of a system or business process over time, such as request count, error rate, or weekly prescriptions. Metrics need clear definitions and a single owner.

**MFA (multi-factor authentication)**: Requiring two or more independent proofs of identity, such as a password and a one-time code. Expected for access to any system holding PHI.

**MLOps**: The practices for running machine learning in production, covering data pipelines, training, deployment, monitoring, retraining, and governance. It is to ML what DevOps is to software.

**MLR (medical, legal, regulatory) review**: The formal review process in which content for promotional or medical use is checked for accuracy, fair balance, and compliance before release. AI-generated content still passes through MLR, and the workflow must record each approval.

**Model card**: A standard document describing a model's intended use, training data, evaluation results, known limitations, and risks. It supports governance and handoffs between teams.

**Model drift**: A general term for model performance degrading over time, caused by data drift, concept drift, or changes in upstream systems.

**Model registry**: A catalog of trained models with versions, metadata, evaluation results, lineage, and approval status. It is the place where promotion from development to production is recorded.

**Model risk management (MRM)**: The governance discipline that classifies models by risk, validates them independently, and monitors them. Common in banking and increasingly applied to high-impact pharma analytics.

**Model routing (tiering)**: Sending each request to the cheapest model that can meet its quality requirement, such as a small model for classification and a large model for complex drafting. A major cost lever for generative AI.

**Monitoring**: Continuous collection and review of metrics and logs to detect problems. Monitoring tells you that something is wrong, and debugging tells you why.

**Multi-agent system**: An architecture where several agents with different roles, tools, or permissions collaborate or check each other's work. Often more complex than needed, so start with a single agent and add agents only when a clear boundary justifies it.

**Multi-tenancy**: Serving multiple customers or business units from shared infrastructure while keeping their data and configuration isolated. A shared commercial data platform serving several brands needs multi-tenant access controls.

## N

**NBA (next-best-action)**: A recommendation, often produced by a model and delivered at the point of interaction, that suggests the most useful action for a rep or customer. Example: suggesting that a rep share a specific clinical data slide with an HCP who recently prescribed a competitor's second-line product.

**Non-human identity**: An identity used by software rather than a person, such as a service account, API key, pipeline credential, or agent identity. Non-human identities often outnumber people and are easy to over-privilege and forget. Snowflake distinguishes service users from person users; check current docs for the options. Example: a quarterly review finds 14 service accounts with read access to the HCP 360 data product, 5 of them owned by projects that have ended.

**NoSQL**: A family of databases that do not use the relational table model, such as document, key-value, and wide-column stores. Chosen for flexible schema or specific access patterns.


**NPI (National Provider Identifier)**: A unique 10-digit identifier issued in the United States to healthcare providers and organizations. It is the most common key for matching HCP records, though not every source populates it reliably.

## O

**Object storage**: Storage that holds files as objects in a flat namespace, with each object addressed by a key and accessed over an API. Amazon S3, Azure Blob Storage, and Google Cloud Storage are examples, and Snowflake stages often sit on top of them.

**Observability**: The ability to understand a system's internal state from its external outputs, usually through metrics, logs, and traces. It goes beyond monitoring by supporting questions you did not anticipate.

**OLAP (online analytical processing)**: Database workloads that run large, read-heavy analytical queries across many rows, typical of warehouses and BI tools.

**OLTP (online transaction processing)**: Database workloads with many small reads and writes from applications, such as recording a call activity or updating an order. Typically handled by relational databases.

**Open Payments (Sunshine Act)**: The US federal reporting system that publishes payments and transfers of value from manufacturers to physicians and teaching hospitals. Data from it is often joined to HCP records in commercial analytics, subject to compliance review.

**OpenTelemetry**: An open-source, vendor-neutral standard and toolkit, hosted by the Cloud Native Computing Foundation, for producing and exporting traces, metrics, and logs. It includes semantic conventions for generative AI calls (model, token counts, and similar attributes), which are still evolving. Example: the pre-call agent emits one OpenTelemetry trace per task, viewable in whichever tracing backend the platform team chooses. See Chapter 19 and Appendix C, Example C6.

**Orchestration**: Coordinating multiple steps, dependencies, retries, and schedules across systems so that a workflow completes correctly. Tools include Airflow, Dagster, Prefect, and Snowflake Tasks for in-platform scheduling.

**Outbox pattern**: Writing a business change and a message describing it to the same database in one transaction, then publishing the message from a separate process. It avoids the inconsistency of dual writes.

**Overfitting**: When a model learns the noise and quirks of its training data rather than the general pattern, so it performs well in training and poorly on new data. Detected by comparing training and held-out performance.

## P

**PACELC**: An extension of CAP stating that when a system is partitioned, it trades availability against consistency, and otherwise it trades latency against consistency. It describes trade-offs that apply during normal operation as well as failures.

**Parquet**: An open columnar file format widely used for analytical data in data lakes. Compresses well and supports efficient column reads.

**Partitioning**: Dividing a large table or dataset into segments, usually by date or a key, so queries and maintenance touch only the relevant segments. Snowflake manages micro-partitions automatically, but clustering keys can still help on large tables.

**Pipeline**: A sequence of data processing steps that moves and transforms data from source to target, usually with scheduling, monitoring, and error handling.

**PHI (protected health information)**: Individually identifiable health information held by covered entities or their business associates under HIPAA. Patient names, dates of service tied to individuals, and member IDs are common PHI elements.

**PII (personally identifiable information)**: Information that can identify a person, such as name, email, phone number, or address. Covers HCPs as well as patients, and the definition varies by jurisdiction.

**Point-in-time correctness**: Ensuring that training data for a model uses only the information that was known at the time of each prediction, not later data. Violations cause leakage and inflated offline accuracy.

**Policy as code**: Writing access, security, and compliance rules as machine-readable, version-controlled files that are evaluated automatically, rather than as documents people must remember to apply. Open Policy Agent is a common engine. Example: a policy file states that the `field_rep` role may call only tools annotated read-only, and the MCP gateway evaluates it on every call. See Chapter 19.

**Precision and recall**: Precision is the share of positive predictions that are correct. Recall is the share of actual positives that were found. Targeting models trade one against the other, and the right balance depends on the cost of a wasted call versus a missed opportunity.

**Prompt**: The text input, including instructions, context, and the user's request, sent to a language model. Prompts are configuration that should be version-controlled and tested like code.

**Prompt caching**: A vendor or platform feature that reuses the processed form of a repeated prompt prefix, reducing latency and cost for long, stable system prompts. Check current vendor docs for pricing and eligibility.

**Prompt injection**: An attack in which untrusted content, such as a web page or a document, contains instructions that the model follows instead of the developer's intent. Retrieved content in a RAG system is a common entry point.

**Pseudonymization**: Replacing direct identifiers with a token or key, which can be reversed by someone holding the key. Still personal data under GDPR, but reduces exposure.

**Pub/sub (publish and subscribe)**: A messaging pattern in which publishers send messages to topics and any number of subscribers receive them, without the publisher knowing who they are.

## Q

**Quantization**: Reducing the numeric precision of model weights, for example from 16-bit to 8-bit or 4-bit, to cut memory and speed up inference, at some cost to quality. Test quality on your own evaluation set before adopting it.


**Query plan**: The steps a database chooses to execute a query, such as which indexes to use and how to join tables. Reading a query plan is the first step in diagnosing a slow report.

## R

**RAG (retrieval-augmented generation)**: A pattern in which the system retrieves relevant passages from a trusted corpus and includes them in the prompt so the model answers from them. It is the standard way to ground answers in current internal documents.

**Rate limit**: A cap on how many requests a client may make in a time window. Protects shared services and controls cost. Exceeding it returns an error that the client should handle with backoff.

**RBAC (role-based access control)**: An access model that grants permissions to roles and assigns roles to users. Simple and auditable, but it can become unwieldy without good role design.

**Read replica**: A copy of a database that serves read queries, reducing load on the primary. Reads from a replica may be slightly behind the primary.


**Recovery point objective (RPO)**: The maximum amount of data loss, measured in time, that the business will accept. An RPO of 1 hour means backups or replication must capture data at least hourly.

**Recovery time objective (RTO)**: The maximum time a system may be down before service must be restored. An RTO of 4 hours means the recovery procedure must complete within 4 hours.

**Redundancy**: Having extra components so that the failure of one does not stop the system. Redundancy only helps if the components do not share the same failure cause.

**Regression test**: A test that checks previously working behavior still works after a change. For AI systems, a regression eval set of past questions with expected answers plays this role.

**Reranking**: A second scoring step that reorders retrieved passages using a more accurate, slower model, such as a cross-encoder. It improves the top results without scoring the whole corpus with the expensive model.

**Replication**: Keeping copies of data on multiple nodes. Synchronous replication waits for copies before confirming a write, while asynchronous replication confirms first and copies later.

**REST (representational state transfer)**: A common style for web APIs that uses HTTP methods and resource URLs. Most vendor APIs you will meet are REST or REST-like.

**Retention**: How long data is kept before deletion or archival. Retention is driven by regulation, contracts, and business need, and must be enforced automatically.

**Retry**: Attempting an operation again after a transient failure. Only safe for idempotent operations, and should use backoff and a maximum attempt count.

**Rollback**: Reverting a system to its previous working version or state after a bad release. Requires that the previous version and its data compatibility are preserved.

**Row-level security**: A database feature that filters which rows a user can see based on rules, such as limiting a rep to their own territory. In Snowflake this is implemented with row access policies.

**Rug pull (MCP)**: An MCP server that changes its tool descriptions or behavior after it has been reviewed and approved, for example adding hidden instructions in a later version. The defense is to pin approved tool descriptions (for example by hash) in a registry and block or re-review any server whose descriptions change. See Chapter 12, Chapter 18, and Appendix C, Example C2.

## S

**SaaS (software as a service)**: Software delivered over the internet by a vendor who runs and updates it. CRM systems and many analytics tools are SaaS.

**Saga**: A way to manage a multi-step business transaction across services by performing each step and, if a later step fails, running compensating actions to undo earlier ones. Example: a sample shipment that reserves inventory, creates an order, and notifies the rep, with reversals if the order fails.

**Sampling (in LLMs)**: The process of choosing the next token from the model's probability distribution, controlled by settings such as temperature, top-k, and top-p. Lower randomness gives more consistent answers.

**Schema**: The formal structure of a dataset or message, including field names, types, keys, and constraints. A schema change is a breaking change if consumers depend on the old structure.

**Schema drift**: Unplanned changes to the structure of incoming data, such as a new column or a renamed field from a vendor. Detect it at ingestion rather than letting it silently break downstream reports.

**Secrets management**: Storing and rotating credentials, API keys, and certificates in a dedicated vault rather than in code or configuration files. Snowflake, cloud key vaults, and dedicated secrets managers all support this pattern.

**Semantic cache**: A cache that matches requests by meaning rather than exact text, so that a paraphrased question can reuse a previous answer. Useful for repeated questions, but a wrong match can return the wrong answer, so set a similarity threshold carefully.

**Semantic layer**: A business-friendly layer that defines metrics, dimensions, and relationships once, such as "net revenue" or "active HCP," and exposes them consistently to BI tools and AI assistants. It keeps numbers from being redefined in every dashboard.

**Semantic search**: Search that matches by meaning using embeddings, rather than by exact keywords. See embedding and hybrid search.

**Semantic versioning**: A version numbering scheme, MAJOR.MINOR.PATCH, in which a major increment signals a breaking change, a minor increment adds backward-compatible features, and a patch fixes bugs. Example: adding an optional `as_of_date` argument to `get_hcp_profile` moves it from 1.3.0 to 1.4.0, while renaming `hcp_id` to `npi` is a breaking change and requires 2.0.0. See Chapter 19 and Appendix C, Example C7.

**Serverless**: A model in which the provider manages servers and scaling, and you pay per use or per invocation. Good for spiky, event-driven work, with trade-offs in cold starts and execution time limits.

**Service level agreement (SLA)**: A commitment, often contractual, about the level of service a provider or internal team will deliver, with consequences if missed. Example: the data team commits to loading the weekly prescription feed by 7 a.m. on Monday 95 percent of weeks.

**Service level indicator (SLI)**: A measured quantity that reflects service quality, such as the percentage of successful requests or the share of reports loaded on time.

**Service level objective (SLO)**: An internal target for an SLI, usually set tighter than the SLA so there is a buffer before the commitment is broken. Example: 99.5 percent of NBA API calls return within 800 ms.

**Sharding**: Splitting a dataset across multiple databases or nodes by a key, such as region, so each node holds a subset. Adds scale, but makes cross-shard queries and transactions harder.

**Shadow deployment**: Running a new version alongside the current one on live traffic without showing its outputs to users, so its behavior can be compared before release. Useful for testing a new model against production inputs.

**Snowflake Cortex**: Snowflake's suite of AI capabilities, including SQL functions that call language models and managed services for search and natural language analytics. Model availability and region support change, so check current Snowflake docs.

**Snowpark**: Snowflake's developer framework that lets you write data processing and machine learning code in Python, Java, or Scala, executed inside Snowflake compute. Check current docs for supported libraries and runtime options.

**Snowflake stream**: An object that records changes (inserts, updates, deletes) made to a table so downstream processes can consume only what changed. Often paired with tasks to build incremental pipelines.

**Snowflake task**: A scheduled or event-triggered execution of a SQL statement or stored procedure inside Snowflake. Used to orchestrate simple pipelines natively.

**Snowflake virtual warehouse**: The compute cluster that runs queries and transformations in Snowflake. Separate warehouses for loading, transformation, and BI prevent workloads from competing for resources and make cost attribution easier.

**Source-to-target mapping (STTM)**: A specification that lists each target field, its source field or logic, transformation rules, and data quality checks. The primary handoff document between business data specialists and engineers.

**Span**: One timed operation within a trace, such as a single model call or tool call, with a start and end time, a parent span, and attributes (for example tool name, token counts, or cost). Example: a pre-call plan trace contains spans for `search_hcp`, `get_hcp_profile`, three model calls, and the output guardrail. See trace and Chapter 19.

**SQL (Structured Query Language)**: The standard language for querying and managing relational databases. Snowflake uses an SQL dialect with extensions for semi-structured data and procedural logic.

**Stdio transport**: The MCP transport in which the host launches the MCP server as a local process and exchanges messages with it over standard input and output. Suited to single-user desktop and IDE tools, not to shared enterprise servers. Contrast with Streamable HTTP.


**Stored procedure**: A named, server-side program that bundles SQL and control logic, stored in the database and callable by name. Snowflake supports stored procedures in several languages.

**Streamable HTTP**: The MCP transport for remote servers, in which the client sends messages to a single HTTP endpoint and the server can reply with a single response or stream several messages back. It replaced an earlier HTTP-plus-server-sent-events transport in a 2025 revision of the specification. It is the transport where authentication, gateways, and network controls apply. Check the current MCP specification for details.

**Streaming responses**: Returning a model's output token by token as it is generated, rather than waiting for the complete answer. Improves perceived speed for chat interfaces.

**Structured output**: A model response constrained to a defined format, such as JSON matching a schema. Makes model output safe to pass to downstream code, though the content still needs validation.

**Supervised learning**: Training a model on examples that include the correct answer, so it learns to predict that answer for new inputs. Targeting and churn models are typically supervised.

**Synthetic data**: Artificially generated data that mimics the statistical properties of real data without containing real records. Useful for testing pipelines and sharing data with vendors, but it must be validated for realism and privacy.

**System prompt**: Instructions given to a language model that set its role, rules, and constraints for the whole conversation. Usually hidden from end users and version-controlled like code.

## T

**Temperature**: A setting that controls the randomness of a language model's output. Low values give more predictable answers, which is usually preferred for extraction and compliance tasks.

**Terraform**: A widely used infrastructure-as-code tool, originally from HashiCorp, in which infrastructure is declared in configuration files, a "plan" shows the changes before they are made, and "apply" makes them. Providers extend it to specific platforms, including Snowflake. OpenTofu is an open-source fork with a compatible configuration language. Example: the dev, test, and prod Snowflake environments for an agent platform, including roles, warehouses, and grants, are created from the same Terraform modules with different variables. See Chapter 19 and Book 2, Appendix D, Example D6.

**Test set**: Data held back from training and used once to estimate how a model will perform on new data. Using it repeatedly during development leaks information into the model choice.

**Throughput**: The amount of work a system completes per unit time, such as requests per second or tokens per minute. Throughput and latency often trade against each other.

**Time to first token (TTFT)**: For streaming language models, the time until the first output token appears. It determines how responsive a chat interface feels, even if the full answer takes longer.

**Time Travel (Snowflake)**: A Snowflake feature that lets you query or restore data as it existed at an earlier point within a retention period. Useful for recovering from a bad load or verifying a change. Check current docs for retention limits on your edition.

**Token**: The unit of text that a language model reads and writes, roughly three-quarters of an English word on average. Pricing, context limits, and latency are all measured in tokens.

**Token exchange (RFC 8693)**: An OAuth 2.0 extension that defines how a client exchanges one security token for another at the authorization server, typically to obtain a narrower token for a specific downstream service or to act on behalf of a user. The resulting token can carry an act claim naming the acting party. Example: the pre-call agent exchanges the rep's sign-in token for a short-lived, downscoped token whose audience is the Snowflake data products MCP server. See Chapter 18 and Appendix C, Example C3.

**Tool annotation**: Optional metadata on an MCP tool that describes its behavior, such as whether it only reads data, may destroy data, is safe to repeat, or reaches systems outside the organization. Hosts may use annotations to decide when to ask the user for confirmation. Annotations are hints, not controls, so the underlying permissions must still enforce them. Example: `get_hcp_profile` is annotated read-only, and its server's Snowflake role has SELECT grants only.

**Tool poisoning**: An attack that hides malicious instructions in a tool's description or other metadata, which the model reads but users rarely see. Example: a third-party congress-calendar tool whose description tells the model to copy every HCP in the territory into a free-text argument. Defenses include reviewing and pinning tool descriptions, narrow allow-lists, and inspecting tool arguments. See Chapter 12 and Chapter 18.


**Trace**: A record of one request's path through many services, with timing for each hop. Traces show where latency is spent in a multi-step AI workflow.

**Training set**: The data used to fit a model's parameters. The model sees it repeatedly during training.

**Transformer**: The neural network architecture behind most modern language models. It uses attention to process sequences in parallel, which made large-scale training practical.

**Two-phase commit (2PC)**: A protocol for making a change across several databases atomic. A coordinator asks all participants to prepare, then to commit. It is correct but slow and fragile when participants fail, so it is used sparingly.

## U

**Unstructured data**: Data without a predefined tabular schema, such as PDFs, emails, slide decks, call transcripts, and images. A large share of pharma knowledge lives here, which is why RAG pipelines are needed.

**Unsupervised learning**: Learning patterns from data without labeled outcomes, such as clustering HCPs by prescribing behavior. Results need business interpretation before use.

## V

**Validation set**: Data held out during training to tune settings and choose between models, separate from the final test set. Protects the test set from being used to make development decisions.

**Vector database**: A database optimized to store embeddings and find the nearest vectors to a query quickly, usually with an approximate index such as HNSW. Some general databases, including Snowflake, now offer vector search as a feature. Check current docs for index types and limits.

**Vertical scaling**: Increasing the size of a single machine, such as more memory or faster CPUs. Simple, but limited by the largest available machine and it often requires downtime.

**Versioning**: Recording each change to code, data, models, and prompts so that any past state can be identified, reproduced, and rolled back. Data versioning often uses table snapshots or time travel.


## W

**Webhook**: An HTTP callback in which one system sends a message to a URL you provide when an event occurs, instead of you polling for changes. Common in CRM and workflow tools.

**Workflow orchestrator**: A system that defines, schedules, runs, and monitors multi-step workflows with dependencies, retries, and alerts. See orchestration.

**Write-ahead log (WAL)**: A sequential log where a database records changes before applying them to its data files. It allows recovery after a crash and underpins replication in many databases.

## Z

**Zero-copy clone (Snowflake)**: A copy of a database, schema, or table that shares the underlying storage with the original until either side changes. Creates test or validation environments quickly without doubling storage.

**Zero trust**: A security model that assumes no user, device, or network is trusted by default, and verifies identity and authorization for every request. Modern pharma architectures increasingly assume zero trust even inside corporate networks.
