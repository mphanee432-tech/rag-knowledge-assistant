AI PRODUCT REQUIREMENTS DOCUMENT · V3.2 FINAL 

# RAG Knowledge Assistant 

This document establishes the finalized architectural baseline and product requirements for the internal RAG Knowledge Assistant. Built specifically for software engineers and site reliability engineers, the system provides instantaneous, cited retrieval of technical payloads (RFCs, error logs, and JSON schemas). By locking into a Stateless Edge Monolith architecture, we drastically reduce operational overhead for small teams while strictly protecting our cost and latency service level agreements (SLAs). 

### Core Architecture: The Edge Monolith 

The system operates exclusively within a Next.js / TypeScript environment deployed on the Vercel Edge Runtime. It discards complex distributed microservices—such as Inngest background workers or OpenRouter classifier layers—in favor of a single, highly capable model executing both retrieval routing and synthesis in one pass. This guarantees 100% architectural simplicity. 



<!-- Start of picture text -->
Client UI Edge API Route Supabase DB<br>(Next.js / SSE) (gemini-3.8-flash) (Exact k-NN / RRF)<br>Fig 1: Synchronous Edge Execution Flow (No Background Queues)<br><!-- End of picture text -->

### System Scope & Boundaries 

- Single Model Inference: 100% of generation and RAG operations are executed by gemini-3.8flash. We explicitly forfeit heavy frontier reasoning models (Pro/Opus) to secure TTFT latency and maintain economic viability without routing classifiers. 

- Vector Indexing: We abandon deferred IVFFlat indexing. The PostgreSQL schema utilizes exact k- Nearest Neighbor (k-NN) sequential scans against 1536-dimensional vectors, ensuring perfect mathematical recall for our strictly constrained project scale (max 10 documents). 

- Input / Output Envelope: The system accommodates raw pasted error logs up to 2,500 characters. Responses are strictly capped via API parameters at 3,000 characters to prevent runaway token costs and enforce conciseness. 

RAG Knowledge Assistant — PRD v3.2 

Page 1 

### The 5-Bucket Query Taxonomy 

The system evaluates production readiness against a 50-row Golden Eval dataset mathematically distributed to reflect real-world software engineering queries. This exact allocation prevents simple "happy-path" queries from masking catastrophic failures in security or layout extraction. 

|Category|Volume|User Intent & Expected System Behavior|
|---|---|---|
|Fact-Based<br>Lookups|45%|Retrieval of exact parameters, return codes, CLI flags, or schema<br>definitions. Relies heavily on the sparse BM25 exact-match layer.|
|Edge Cases &<br>Ambiguity|20%|Dense tabular extractions, ambiguous software acronyms (e.g., "K8s",<br>"IAM"), and conflicting version specs. Comparative tasks are explicitly<br>folded here.|
|Multi-Hop<br>Synthesis|15%|Synthesizing architectural flows, token validation chains, or race conditions<br>across multiple distinct uploaded technical documents.|
|Adversarial &<br>Refusals|15%|System prompt injection attempts inside code blocks, or queries probing<br>out-of-scope boundaries. Triggers deterministic abstention (safe refusal).|
|Regression<br>Testing|5%|Historically failing queries captured via inline user telemetry (thumbs-down).<br>Monitored under a slightly relaxed ≥ 90% threshold for deployment.|



#### ARCHITECTURAL NOTE: SINGLE-MODEL ROUTING 

Unlike earlier iterations that utilized a fast intake classifier to route multi-hop queries to an expensive frontier model, this v3.2 architecture handles the entire 5-bucket distribution synchronously through gemini-3.8-flash. The loss in deep, multi-document logical synthesis is strategically traded for guaranteed sub-second query initialization, zero routing complexity, and absolute protection of our unit economic ceilings. 

RAG Knowledge Assistant — PRD v3.2 

Page 2 

### Performance SLAs & Target Limits 

The system is strictly bound by the following performance constraints. Violating any of these metrics in the staging environment acts as a hard block on production deployment. 

TIME-TO-FIRST-TOKEN (P95) 

## ≤ 2.0s 

Achieved via Server-Sent Events (SSE) token streaming to mask actual inference delays. 

END-TO-END LATENCY (P95) 

## ≤ 8.0s 

Standard SLA constraint protecting heavy Hybrid Reciprocal Rank Fusion executions. 

PER-GENERATION UNIT COST 

## ≤ ₹0.50 

Mathematically protected by Edge monolith consolidation and 3,000 char output caps. 

VECTOR RECALL PRECISION 

## 100% 

Ensured via exact k-NN sequential scans across 1536dimensional embedded chunks. 

### Launch Gates & Acceptance Criteria 

Evaluations are scored programmatically utilizing both deterministic code logic and LLM-as-a-judge pipelines. To ship, the system must clear: 

- Cross-Tenant Leakage (15% Weight): Deterministic Row-Level Security (RLS) test. Pass bar is exactly 0 violations. A single leaked UUID or chunk from an unauthorized project fails the build. 

- Format Conformance (10% Weight): Code-based JSON schema validation and character boundary assertions. Must achieve a ≥ 99% pass rate. 

- Citation Precision (10% Weight): Regex checks ensuring every inline citation strictly maps to an active database chunk ID payload. Must achieve ≥ 95% precision. 

- Faithfulness & Relevance (40% Weight): LLM-judge verification ensuring claims are fully supported by context and answers are not overly verbose. Target score ≥ 2.5/3.0. 

#### FAILURE MODE: DETERMINISTIC ABSTENTION 

If Reciprocal Rank Fusion (RRF) scores fall below the required similarity threshold, the model is physically prevented from generating a response, yielding a hardcoded fallback message: "I couldn't find evidence in this project's documents to answer that." 

RAG Knowledge Assistant — PRD v3.2 

Page 3 

### Document Storage & Isolation Boundaries 

To prevent compute starvation and uncontrolled egress costs, tenant environments operate under strict physical database quotas enforced via PostgreSQL BEFORE INSERT triggers. 

|Constraint Category|System Enforcement Mechanism|
|---|---|
|File Thresholds|Max 10 active documents per project. Files are strictly capped at 25MB each<br>to protect Edge runtime memory during raw text extraction.|
|Supported Formats|.pdf, .txt, and .html (Parsed via dual-format DOM pathing internally for precise<br>structural tracking, returning Markdown to the UI).|
|Data Purge & Retention|Foreign keys utilizeON DELETE CASCADE. Deleting a user project instantly<br>purges all dependent documents, vectors, and feedback rows.|
|Access Control|Supabase Row-Level Security (RLS). Vector chunks are inaccessible unless<br>projects.user_id = auth.uid().|



### Stateless Webhook Ingestion Pipeline 

The system entirely decouples file uploads from serverless execution states. Clients request signed URLs and push binary payloads directly to a private Supabase Storage bucket. This allows the Vercel frontend to respond instantly. Once the file commits to storage, Supabase triggers an internal webhook (storage.objects.insert) which pings our Edge API to perform layout-aware semantic chunking and embedding generation asynchronously without dropping the connection. 



<!-- Start of picture text -->
Supabase Bucket Edge Extract API<br>Signed Upload<br>(Triggers Webhook) (Chunks & Embeds)<br><!-- End of picture text -->

Fig 2: Stateless Ingestion bypassing Edge application timeouts. 

RAG Knowledge Assistant — PRD v3.2 

Page 4 

