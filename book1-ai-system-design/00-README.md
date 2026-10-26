# Book 1: System Design for AI Systems

How modern software systems are put together, and how AI components (models, retrieval, agents,
ML pipelines) change the design. Written for a data leader in commercial pharma who needs to hold
their own in architecture conversations, not for a software engineer preparing for interviews.

## Table of contents

### Part I: Foundations of system design
| # | File | Chapter |
|---|------|---------|
| 1 | `chapters/01-how-to-think-about-system-design.md` | How to Think About System Design: requirements, constraints, back-of-the-envelope estimation, trade-offs, and a repeatable design method |
| 2 | `chapters/02-compute-and-networking-building-blocks.md` | Compute and Networking Building Blocks: clients, DNS, load balancers, API gateways, CDNs, VMs, containers, Kubernetes, serverless, GPUs |
| 3 | `chapters/03-storage-and-data-building-blocks.md` | Storage and Data Building Blocks: relational, key-value, document, wide-column, object stores, caches, search indexes, vector databases; replication, partitioning, consistency, CAP and PACELC |
| 4 | `chapters/04-messaging-events-and-workflows.md` | Messaging, Events, and Workflows: queues, pub/sub, event streaming (Kafka), exactly-once myths, workflow orchestrators, sagas |
| 5 | `chapters/05-reliability-scalability-observability.md` | Reliability, Scalability, and Observability: SLOs, redundancy, retries, timeouts, backpressure, circuit breakers, idempotency, metrics/logs/traces, incident practice |
| 6 | `chapters/06-security-privacy-and-compliance-by-design.md` | Security, Privacy, and Compliance by Design: identity, authn/authz, secrets, encryption, network boundaries, audit, regulated-industry constraints (HIPAA, GDPR, 21 CFR Part 11, pharma promotional rules) |

### Part II: AI-specific building blocks
| # | File | Chapter |
|---|------|---------|
| 7 | `chapters/07-anatomy-of-an-ai-system.md` | Anatomy of an AI System: models as components, training vs inference, predictive ML vs generative AI, API models vs self-hosted, the latency/cost/quality triangle |
| 8 | `chapters/08-model-serving-and-inference-infrastructure.md` | Model Serving and Inference Infrastructure: GPUs, batching, KV cache, quantization, autoscaling, LLM gateways, routing, rate limits, prompt and semantic caching, streaming |
| 9 | `chapters/09-retrieval-augmented-generation-systems.md` | Retrieval-Augmented Generation (RAG) Systems: document pipelines, chunking, embeddings, vector and hybrid search, reranking, freshness, citations, evaluation |
| 10 | `chapters/10-agents-tools-and-orchestration.md` | Agents, Tools, and Orchestration: tool calling, planning loops, state and memory, Model Context Protocol (MCP), guardrails, human-in-the-loop, multi-agent patterns and when not to use them |
| 11 | `chapters/11-ml-platforms-and-mlops.md` | ML Platforms and MLOps: feature stores, training pipelines, experiment tracking, model registries, CI/CD for models, batch vs online inference, drift and retraining |
| 12 | `chapters/12-evaluation-safety-and-ai-governance.md` | Evaluation, Safety, and AI Governance: offline evals, LLM-as-judge, online experiments, guardrails, prompt injection, PII handling, audit trails, model risk management in regulated industries |
| 13 | `chapters/13-cost-and-capacity-planning-for-ai.md` | Cost and Capacity Planning for AI Systems: token economics, GPU economics, caching, model tiering, budgets, unit economics and FinOps |

### Part III: Design walkthroughs (case studies)
| # | File | Chapter |
|---|------|---------|
| 14 | `chapters/14-case-study-enterprise-knowledge-assistant.md` | Case Study: An Enterprise Knowledge Assistant (RAG over internal commercial and medical documents) |
| 15 | `chapters/15-case-study-next-best-action-system.md` | Case Study: A Next-Best-Action System for the Field Force (real-time recommendations for reps, with Veeva CRM integration) |
| 16 | `chapters/16-case-study-genai-content-generation-and-mlr-review.md` | Case Study: GenAI Content Generation with Medical-Legal-Regulatory (MLR) Review |
| 17 | `chapters/17-case-study-conversational-analytics-text-to-sql.md` | Case Study: Conversational Analytics (text-to-SQL over a Snowflake commercial data mart) |

### Part IV: Running AI at enterprise scale
| # | File | Chapter |
|---|------|---------|
| 18 | `chapters/18-enterprise-agent-infrastructure.md` | Enterprise Agent Infrastructure: MCP in depth, MCP gateways and registries, agent identity and delegated access, agent-to-agent (A2A) protocols |
| 19 | `chapters/19-operating-ai-platforms.md` | Operating AI Platforms: tracing and AI observability, infrastructure as code, environment promotion, and versioning tools, prompts, and agents |

### Appendices
| File | Contents |
|------|----------|
| `appendix-a-glossary.md` | Glossary of system design and AI terms |
| `appendix-b-design-review-template.md` | A one-page architecture review template and question bank |

## Reading paths
- **Fast path (one weekend):** Chapters 1, 3, 5, 7, 9, 12, then Case Study 14.
- **Full path:** cover to cover; Part III assumes Parts I and II.
- **If you only care about GenAI:** 7, 8, 9, 10, 12, 13, 14, 16, 17.
- **Enterprise agent platforms (MCP, gateways, identity):** 6, 8, 10, 18, 19.
