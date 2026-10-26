# Book 2: Data System Design for AI

Data architecture end to end, grounded in Snowflake and in commercial pharma data. Written for a
Manager, Data Specialist who translates business needs into data engineering work and must
understand data architectures as a whole: how data is modeled, stored, moved, transformed, governed,
served, and made ready for analytics, ML, and generative AI.

## Table of contents

### Part I: Foundations of data architecture
| # | File | Chapter |
|---|------|---------|
| 1 | `chapters/01-data-architecture-and-the-data-value-chain.md` | Data Architecture and the Data Value Chain: what an architecture is, the layers of a modern data platform, roles (and where the Data Specialist sits), data as a product, reference architectures |
| 2 | `chapters/02-data-modeling.md` | Data Modeling: conceptual/logical/physical; normalization; dimensional modeling (facts, dimensions, star schemas, slowly changing dimensions); Data Vault; wide tables for ML; choosing a style |
| 3 | `chapters/03-storage-and-compute-warehouses-lakes-lakehouses.md` | Storage and Compute: OLTP vs OLAP, row vs columnar, warehouses vs lakes vs lakehouses; Snowflake architecture deep dive (storage/compute separation, micro-partitions, clustering, virtual warehouses, Time Travel, zero-copy clone, Iceberg tables) |
| 4 | `chapters/04-ingestion-and-integration.md` | Ingestion and Integration: batch, CDC, streaming; ETL vs ELT; files and APIs; Snowpipe and Snowpipe Streaming; managed connectors; Snowflake Data Sharing and Marketplace; receiving vendor data (IQVIA, Symphony, Veeva) |
| 5 | `chapters/05-transformation-and-orchestration.md` | Transformation and Orchestration: medallion layers, dbt, Snowflake Streams, Tasks and Dynamic Tables, Airflow/Dagster, incremental models, idempotency, backfills, environments and CI/CD |
| 6 | `chapters/06-data-quality-and-observability.md` | Data Quality and Observability: quality dimensions, rule design, data contracts, tests in dbt, Snowflake Data Metric Functions, anomaly detection, freshness SLAs, incident handling |
| 7 | `chapters/07-governance-security-privacy.md` | Governance, Security, and Privacy: catalogs, lineage, ownership and stewardship, RBAC in Snowflake, masking and row access policies, tags, PII/PHI, HIPAA, GDPR, vendor license restrictions, data sharing agreements |
| 8 | `chapters/08-data-products-and-the-semantic-layer.md` | Data Products and the Semantic Layer: what makes a data product, the spec (source-to-target mapping, business rules, data dictionary, DQ rules, SLAs), metrics layers, Snowflake semantic views, serving BI and AI from one definition |

### Part II: Data foundations for AI
| # | File | Chapter |
|---|------|---------|
| 9 | `chapters/09-data-for-machine-learning.md` | Data for Machine Learning: feature engineering, feature stores (incl. Snowflake Feature Store), point-in-time correctness, labels, training datasets, train/serve skew, leakage |
| 10 | `chapters/10-data-for-generative-ai.md` | Data for Generative AI: unstructured data pipelines, document parsing, embeddings and vector search in Snowflake (Cortex), RAG over governed data, metadata and documentation as AI inputs, text-to-SQL readiness |
| 11 | `chapters/11-mlops-and-ai-operations-in-the-warehouse.md` | MLOps and AI Operations in the Warehouse: Snowpark, model registry, batch and near-real-time inference, Cortex functions, monitoring predictions, closing the loop back into the data model |
| 12 | `chapters/12-commercial-pharma-data-domain.md` | The Commercial Pharma Data Domain: HCP/HCO master data and MDM, IQVIA (APLD, NPA, NSP, Xponent), Symphony Health, claims (open vs closed), Veeva CRM, affiliations, alignments and territories, market access data, consent and privacy, vendor licensing |

### Part III: Practice
| # | File | Chapter |
|---|------|---------|
| 13 | `chapters/13-requirements-translation-playbook.md` | Requirements Translation Playbook: elicitation, decomposition into epics/stories/tasks, acceptance criteria, UAT, backlog hygiene, communicating status; templates |
| 14 | `chapters/14-architecture-patterns-anti-patterns-and-cost.md` | Architecture Patterns, Anti-Patterns, and Cost: data mesh vs centralized, hub-and-spoke, reverse ETL, Snowflake cost management (warehouse sizing, credits, query tuning), migration strategies |
| 15 | `chapters/15-case-studies.md` | Case Studies: HCP 360 data product; NBA feature pipeline; Market Access analytics mart; GenAI content sourcing for MLR; Conversational analytics over the commercial mart |

### Part IV: Agent-ready data platforms
| # | File | Chapter |
|---|------|---------|
| 16 | `chapters/16-exposing-governed-data-to-agents-on-snowflake.md` | Exposing Governed Data to Agents on Snowflake: Cortex Agents, Snowflake's managed MCP server, semantic views and search as tools, agent service identities, external access, Snowpark Container Services, infrastructure as code, and versioning data-product interfaces |

### Appendices
| File | Contents |
|------|----------|
| `appendix-a-glossary.md` | Glossary of data architecture, Snowflake, and pharma data terms |
| `appendix-b-templates.md` | Templates: data product spec, source-to-target mapping, data dictionary, DQ rule register, SLA sheet, user story and acceptance criteria |
| `appendix-c-snowflake-sql-cheat-sheet.md` | Snowflake SQL and feature cheat sheet for specification writing and validation |

## Reading paths
- **Ship data products now:** 1, 2, 8, 13, 6, then 12 and Appendix B.
- **Understand the platform:** 3, 4, 5, 7, 14.
- **Support AI/ML teams:** 9, 10, 11, 15.
- **Make data available to agents safely:** 7, 8, 10, 16.
