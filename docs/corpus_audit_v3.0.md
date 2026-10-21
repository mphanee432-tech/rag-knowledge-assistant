10/17/26, 3:31 PM 

Comprehensive Architectural Decision Records List 

# **Comprehensive Architectural Decision Records List** 

https://gemini.google.com/app/eb2189e1a2f961e7 

_User prompt: list the Architecture Decisions record made till now give complete list from the begining to now_ 

Response: Based on the provided notebook sources, here is the comprehensive, chronologically organized list of Architectural Decision Records (ADRs) and choices locked in from the beginning of the project to the most recent updates: 

## **1. Product Scope & Persona Constraints** 

- **Target Persona:** Software engineering knowledge workers (developers, SREs, technical architects) debugging RFCs, APIs, and runtime errors. 

- **Interaction Paradigm:** The Hybrid Research Copilot—a stateless, single-turn primary chat interface with a bounded 5-turn sliding window memory. 

- **Cold Start UX:** Inferred Document-Driven Starts (the system uses an intake model to suggest a relevant first query based on the uploaded document). 

- **Input/Output Envelope (Developer UX Expansion):** User inputs are expanded up to 2,500 characters (to allow pasting raw error logs and stack traces). Generation outputs are strictly capped at 3,000 characters via API `max_tokens` to protect unit economics. 

- **Performance SLAs:** p95 Time-to-First-Token (TTFT) ≤ 2.0s via Server-Sent Events (SSE), p95 end-to-end latency ≤ 8.0s, and p95 unit cost ≤ ₹0.50. 

- **The Regression Gate:** Monitored Threshold requiring a ≥ 90% pass rate for the 5% regression query subset. 

## **2. Ingestion & Storage Architecture** 

- **Capacity Limits:** Strictly capped at a maximum of 10 active documents per isolated project workspace. Supported formats are `.pdf` , `.txt` , and `.html` , with a maximum file size of 25MB per file (totaling a 250MB storage footprint ceiling per project). 

- **Document Limit Enforcement:** A database-level PostgreSQL `BEFORE INSERT` trigger enforces the 10-document limit by counting non-failed rows, aborting the 11th insert with a custom exception `SQLSTATE P0001` . 

- **Upload Transfer Pattern:** Direct Client-to-Supabase Storage via signed URLs, bypassing Vercel's 4.5MB serverless payload limit. 

- **Ingestion State Workflow:** Evolved from a client-orchestrated Status Machine to **Supabase Storage Webhooks** ( `storage.objects.insert` ) to trigger processing and prevent clientside race conditions. 

https://gemini.google.com/app/eb2189e1a2f961e7 

1/3 

10/17/26, 3:31 PM 

Comprehensive Architectural Decision Records List 

- **Bucket Security & Pathing:** Signed URL Only Access (Fully Private Bucket) using a strict tenant directory structure: `{user_id}/{project_id}/{document_id}/{filename}` . 

- **Tenant Isolation & Purge:** Supabase Auth (Email/Password) with Direct Project-Level Join RLS. Deleting a project triggers a PostgreSQL `CASCADE DELETE` to instantly purge all child documents, chunks, and vector embeddings. 

## **3. Parsing & Compute Environment** 

- **Compute Pipeline (The Stateless Edge Monolith):** The architecture migrated to the Next.js **Edge Runtime** to bypass Vercel's strict 10-second Hobby tier Node.js timeouts, explicitly stripping out Inngest durable workers to reduce accidental complexity. 

- **Parsing Engine:** Gemini 3.8-Flash Multimodal Document Ingestion, eliminating third-party parsing dependencies (like LlamaParse). 

- **Document Update Model:** Immutable Documents (Append-Only with UI Deletion) to prevent index race conditions. 

- **Chunking Strategy:** Dual-Format DOM Pathing (HTML Backend / Markdown Frontend). The system stores HTML structurally during indexing to calculate exact DOM path coordinates but renders Markdown to the user. 

## **4. Database Schema & Vector Indexing (Supabase / pgvector)** 

- **Vector Dimensions:** Upgraded to **1536 dimensions** via Matryoshka Representation Learning (MRL), transitioning away from the legacy 768-dimension setup. 

- **Vector Indexing Engine:** Reverted from Deferred IVFFlat indexing to **Exact k-NN Sequential Scans** (since the hobby-scale 10-document limit maxes out around 3,000 chunks, making IVFFlat centroids unnecessary dead code). 

- **Metadata Schema:** Flexible `JSONB` metadata column on the `document_chunks` table to handle format-specific attributes and dual-format HTML scaffolding. 

- **Sparse Lexical Retrieval:** PostgreSQL full-text search ( `tsvector` ) configured with the standard **'english'** dictionary. 

- **Hybrid Search & RRF Layer:** A unified PostgreSQL Stored Procedure (Database RPC Function) executes dense vector similarity and sparse keyword matching concurrently, merging them via Reciprocal Rank Fusion ( _k_ = 60 ) in a single database round-trip. 

- **Telemetry Schema:** Unified `interactions` Table (Flat Architecture) logging queries, chunk UUIDs, responses, and micro-feedback (👍/👎) in a single row without relational joins. 

## **5. Query Taxonomy & Model Routing** 

- **Query Taxonomy Distribution (V3.1 - 5 Buckets):** 45% Fact-Based Lookups, 20% Edge Cases & Ambiguity, 15% Multi-Hop Synthesis, 15% Adversarial/Refusals, and 5% Regression Testing. 

https://gemini.google.com/app/eb2189e1a2f961e7 

2/3 

10/17/26, 3:31 PM 

Comprehensive Architectural Decision Records List 

**Inference Engine Standardization:** Standardized heavily on the Google ecosystem (Gemini 3.8-Flash & 3.1-Pro) to native multimodal capabilities without breaking the edge extraction pipeline. 

https://gemini.google.com/app/eb2189e1a2f961e7 

3/3 

