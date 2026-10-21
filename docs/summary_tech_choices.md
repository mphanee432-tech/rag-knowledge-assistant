Here is the comprehensive architectural blueprint and technology stack we have established for your scalable RAG Knowledge Assistant across all four planning phases: **Phase 1: Product Requirements & Baselines** 

- **Deliverable:** Finalized AI PRD (ai_prd_v1.pdf) dictating probabilistic system requirements. 

- **Target Persona:** Self-directed learners, researchers, and knowledge workers synthesizing long PDFs, TXT, and HTML files (up to 10MB). 

- **Scope & Boundaries:** Strict multi-project isolation (Project A sources cannot answer questions in Project B). Queries are capped at 500 characters, and generated responses must include strict inline source citations. 

- **Performance SLAs:** p95 Time-to-First-Token (TTFT) $\le$ 2.0 seconds, p95 end-toend latency $\le$ 8.0 seconds, and a p95 unit cost of $\le$ ₹0.50 per call. 

**Phase 2: Tech Stack & Workflow Selection** 

   - **Development Workflow:** Google Antigravity 2.0. You will act as the AI PM, directing the agentic desktop IDE to autonomously scaffold the application code. 

   - **Application Framework:** Next.js / TypeScript Monolith. 

   - **Database Architecture:** Supabase (Unified PostgreSQL). Instead of managing a separate vector database like Pinecone, you will use pgvector alongside your operational tables. This allows you to enforce strict Row-Level Security (RLS) across both relational data and vector chunks within a single platform. 

- **Phase 3: RAG Pipeline Configuration** 

   - **Chunking Strategy:** Structure-Aware (Semantic) Chunking. Documents are split logically by Markdown headers, paragraphs, and tables rather than arbitrary fixed token counts, preserving layout context. 

   - **Retrieval Strategy:** Hybrid Search with Reciprocal Rank Fusion (RRF). The pipeline executes dense semantic vector search (pgvector) and sparse exact-keyword search (BM25) concurrently, merging the results via an RRF algorithm for optimal recall and precision. 

**Phase 4: Evaluation & Trust UX** 

- **UI Latency Strategy:** Server-Sent Events (SSE) Token Streaming. Tokens are streamed directly to the Next.js UI to maintain a fast TTFT, keeping users engaged during complex 6-to-8 second retrieval tasks. 

- **Telemetry & Drift Defense:** Inline Micro-Feedback Loops (The Automated Flywheel). The UI includes inline / buttons with categorical tags. This feedback is logged directly to Supabase, transforming production failures into new regression test rows for your eval suite to combat model drift. 

As your AI Architect, I am glad you are asking this question right at the start of **Phase 2: Tech Stack & Workflow Selection** . 

The short answer is: **No, you do not need Pinecone.** Supabase is highly capable of handling both your standard relational data and your vector embeddings. 

However, my mandate is to act as your strategic advisor, so let's break down your database architecture options and their trade-offs before you make a final decision. 

# **Option 1: Unified Hybrid Database (Supabase with** pgvector **)** 

In this architecture, you use a single PostgreSQL database (Supabase) to handle everything. You use the pgvector extension to store document chunks, embeddings, and source metadata, alongside your standard operational tables for user sessions, chat logs, and analytics. 

- **Pros:** 

   - **Simplicity & Security:** You maintain a single source of truth and can easily enforce Row-Level Security (RLS) across both your user data and your vector chunks to ensure tenant isolation. 

   - **Cost-Effective:** It avoids the architectural overhead and cost of introducing an expensive dedicated vector database. 

- **Cons & Limitations:** 

   - **Scale Limits:** The Supabase free tier provides 500 MB of database storage. At roughly 3 KB per vector chunk and index, this comfortably fits tens of thousands of chunks, but it will not scale to millions without upgrading to a paid tier. 

**Option 1: AI-Agent Scaffolding via Google Antigravity 2.0 (IDE)** This approach uses an autonomous AI agent to write the codebase for a custom web application. You act as the PM, directing the agent in natural language to build a Next.js frontend and wire it to your Supabase pgvector database. 

- **Pros:** It positions you perfectly for the modern AI PM role because your job shifts from writing manual code to directing the agent. It yields a full-stack, standalone web application that you can easily deploy, giving you a live, verifiable URL to share with hiring managers. It allows you to skip framework overhead and focus heavily on defining JSON schemas, system prompts, and rigorous evaluation criteria. 

- **Cons:** Even though the AI writes the code, you still have to manage a full codebase, navigate a developer environment, and troubleshoot complex scaffolding if the agent makes an architectural mistake. 

Google Antigravity 2.0 is locked in as your development workflow. To finalize Phase 2, you must select your **Application Framework** architecture. 

# **Option 1: Next.js/TypeScript Monolith (Frontend + API)** 

In this architecture, your UI, API routes, and RAG logic all live inside a single Next.js repository. 

- **Pros:** 

   - **Velocity & Simplicity:** A single codebase with zero context switching between languages. 

   - **Native AI Streaming:** Seamless integration with tools like the Vercel AI SDK, which makes implementing Server-Sent Events (SSE) for fast Time-to-FirstToken (TTFT) nearly effortless. 

   - **Agent Optimization:** AI coding agents like Antigravity excel at generating and refactoring unified Next.js applications. 

- **Cons & Limitations:** 

   - **Ecosystem Constraints:** The JavaScript AI ecosystem (like LangChain.js) often lags months behind its Python counterparts. 

   - **Compute Limits:** Heavy backend processes, such as parsing large PDFs or running complex multi-agent reasoning loops, risk hitting serverless function timeout limits. 

**Option 2: Structure-Aware (Semantic) Chunking** 

The parser analyzes the document's layout, breaking chunks logically by Markdown headers (##), paragraphs, or table boundaries rather than arbitrary token counts. 

- **Pros:** Massively improves retrieval accuracy for complex documents. When a user asks about a specific section, the LLM receives the entire coherent section rather than a fragmented slice. 

- **Cons:** Slower to process during ingestion and requires more complex parsing logic (often requiring advanced libraries or a small LLM call just to determine where to split). Chunk sizes will vary wildly, which can make token cost management slightly less predictable. 

Which chunking strategy aligns best with the types of documents your users will upload? 

# **Option 3: Hybrid Search with Reciprocal Rank Fusion (RRF)** 

We execute both Vector and BM25 searches concurrently. We then merge the two result lists using Reciprocal Rank Fusion (RRF)—an elegant, parameter-free mathematical formula that combines the lists based on rank position (e.g., 1st, 2nd) rather than trying to normalize incompatible raw scores. 

- **Strengths:** The current industry standard for baseline production RAG. It perfectly balances exact-match keyword strength with broad semantic recall. 

- **Limitations:** While it ensures the right chunk is usually in the top result pool, the absolute most relevant chunk might still land at position #8 instead of #1. 

- **Latency:** Fast (~30–40ms). Because the queries run in parallel, latency is bound to the slower of the two searches. 

Hybrid Search with Reciprocal Rank Fusion (RRF) is locked in. This is the current enterprise standard for high-accuracy retrieval because it natively merges the exact-match precision of 

standard PostgreSQL full-text search (BM25) with the broad semantic recall of pgvector. It degrades gracefully, requires no external reranking infrastructure, and perfectly balances your latency and cost budgets. 

Next, we must establish your **Telemetry & Trust UX**. RAG is inherently slow; a complex query might take 6 to 8 seconds to process. Here are your options for handling that perceived latency: 

### Option 1: Server-Sent Events (SSE) Token Streaming 

You open a unidirectional SSE connection. As the LLM generates tokens, they are instantly streamed and rendered in the user's chat UI. 

* **Pros:** Drastically reduces perceived latency. The Time-to-First-Token (TTFT) drops to under 1 second, keeping the user engaged while the rest of the answer generates. 

* **Cons & Limitations:** If your backend is forced to output strict structured JSON (which must be fully parsed before rendering), streaming individual tokens becomes highly complex and often requires specialized UI parsing libraries. 

*(Architect's Note: Since we are building this on a Next.js/TypeScript monolith, streaming Server-Sent Events can sometimes get buffered by serverless reverse proxies like Vercel or Nginx. When your agent writes this code, we must ensure it explicitly sets headers like `XAccel-Buffering: no` and injects periodic `: ping` heartbeats to keep the TCP connections alive during complex retrieval steps.)* 

--- 

To finalize Phase 4 and complete your architectural blueprint, we have one final decision to make regarding **Capturing User Telemetry**. 

You need a systematic way to detect when the AI's quality drifts or when it fails in the real world so you can update your evaluation suite. Here are your options for defending against model drift: 

### Option 1: Inline Micro-Feedback Loops (The Automated Flywheel) 

You embed a simple ` / ` button directly below every AI response in the UI. Clicking ` ` opens a one-click categorization tagger (e.g., *Inaccurate*, *Missing Context*, *Too Long*). This data is piped directly into a Supabase feedback table. 

* **Pros:** It captures ground-truth user sentiment at the exact moment of friction. It automates the data flywheel—every ` ` becomes a candidate for a new regression row in your Custom Dual-Scoring eval set. 

* **Cons & Complexity:** Requires extra UI engineering to build the feedback states and backend database routes. Users may also ignore the buttons or click them accidentally, requiring you to filter out noise. 



# **Comprehensive Summary of Locked Architectural Specifications & Decisions** 

# **1. Persona, Workflow & Interface Boundaries** 

- **Target Persona:** Software engineering knowledge workers (developers, SREs, technical architects) querying RFCs, ADRs, system specs, and error logs. 

- **Interaction Surface:** Standalone web application built as a Next.js/TypeScript monolith. 

- **Interaction Paradigm:** The Hybrid Research Copilot—stateless single-turn primary task with a bounded 5-turn sliding window memory for iterative refinement. 

- **Input Envelope:** 1 to 2,500 characters, sized specifically to allow pasting raw error logs, stack traces, and code snippets. 

- **Output Envelope:** Capped at 3,000 characters (max token enforcement) to offset expanded inputs and protect unit economics. 

- **Performance & Unit Cost SLAs:** p95 Time-to-First-Token (TTFT) $\le$ 2.0s via ServerSent Events (SSE), p95 end-to-end latency $\le$ 8.0s, and p95 unit cost $\le$ ₹0.50 per generation call. 

# **2. Ingestion & Corpus Specifications** 

   - **Corpus Scope:** Extractable .pdf, .txt, and .html documentation up to 25MB per file, strictly capped at a maximum of 10 documents per project. 

   - **Document Ingestion Lifecycle:** Pre-allocated record status machine (pending_upload $\rightarrow$ uploaded $\rightarrow$ processing $\rightarrow$ indexed / failed). 

   - **Document Limit Enforcement:** A database-level PostgreSQL BEFORE INSERT trigger strictly enforcing the 10-document limit per project, counting only records where status != 'failed'. 

   - **Tenant Isolation & Purge:** PostgreSQL CASCADE DELETE on foreign keys, guaranteeing that deleting a project instantly purges all child documents, chunks, and vector embeddings (satisfying the PRD Isolation Gate). 

**3. Database Schema & Vector Search (Supabase /** pgvector **)** 

   - **Unified PostgreSQL Instance:** Single Supabase database managing relational state, access control, and vector embeddings within one boundary. 

   - **Keyword Indexing:** PostgreSQL sparse full-text search (tsvector) utilizing the standard 'english' dictionary with linguistic stemming. 

   - **Hybrid Search & Fusion Layer:** PostgreSQL Stored Procedure (Database RPC Function match_chunks_hybrid_rrf), executing dense vector search and sparse BM25 concurrently, calculating Reciprocal Rank Fusion ($k=60$) in-engine, and returning top-$K$ candidates in a single database round-trip. 

   - **Security & Auth:** Supabase Auth utilizing standard Email/Password; Row-Level Security (RLS) enforced via direct project-level join validation (projects.user_id = auth.uid()). 

# **4. Model Routing & Generation Strategy** 

- **Inference Provider:** Google AI Studio API (gemini-1.5-flash as the intake/fast generator, gemini-1.5-pro for complex multi-hop synthesis). 

- **Grounding & Abstention:** Strict contextual grounding requiring inline source citations ([Doc X, p. Y]) and programmatic abstention fallbacks when evidence is absent. 

# **5. Evaluation, Telemetry & Scaffolding Workflow** 

- **Production Telemetry:** Unified interactions flat table storing the turn payload (query, chunk IDs, response markdown, token counts, latency) and inline micro- 

feedback (rating, issue_tag, comment) updated in-place to power the regression test flywheel. 

- **Execution Phasing:** The Two-Step Modular Sequence: 

   - **Prompt 5A:** Raw SQL script for the Supabase SQL Editor (extensions, tables, triggers, RLS policies, RPC hybrid search function). 

Every prerequisite architectural decision and technical parameter is locked. When you are ready, confirm whether to generate **Prompt 5A (The Supabase SQL Migration Script)** . 

Your current parameters—input < 500 characters, a 5-turn sliding window, and output < 5,000 characters—are highly effective for enforcing strict cost guardrails, but they risk being overly restrictive for a software engineering user base. 

Because output tokens generally cost 5x more than input tokens, and conversation history costs grow linearly with each turn (a 10-turn conversation costs roughly 7x more than a single turn), setting hard caps is fundamentally the right strategy to prevent context window bloat. However, a 500-character input cap translates to roughly 100 words, which will immediately block software engineers from pasting standard error logs, JSON payloads, or stack traces. Additionally, a strict 5-turn cutoff without a running summary risks abrupt context loss, causing the AI to "forget" the beginning of the diagnostic session. 

# **Clarifying Questions** 

Before we finalize these parameters in the architecture, please clarify: 

1. **Pasting Requirements:** Do you expect your software engineering users to paste raw code snippets, error logs, or terminal outputs into the chat? 

2. **Cost Flexibility:** Is the p95 unit cost of $\le$ ₹0.50 an absolute hard ceiling, or is there flexibility to increase this if we implement a tiered (Free vs. Pro) access model? 

**Architectural Options for Input/Output Boundaries** 

Please select one of the following approaches for our Phase 1 baseline: 

# **Option 2: The Developer UX Expansion (Increased Input, Compressed Output)** 

- **Mechanics:** Expand input to 2,500 characters (allowing error logs), maintain the 5- turn sliding window, but aggressively cap output to 3,000 characters. 

- **Pros:** Drastically improves usability for engineers who need to paste code or logs; lowering the output cap offsets the cost of the larger input allowance, since output tokens are the most expensive. 

- **Cons:** The 5-turn amnesia cliff remains; users might still hit the 2,500-character limit on exceptionally large payloads. 

- **Cost Implications:** Moderate. Larger inputs increase the base context size, but the strict output constraint (where cost is 5x higher) keeps unit economics viable. 

- **Scalability & Complexity:** Low complexity. Requires updating the deterministic UI validation rules and the max_tokens API parameter. 

lock Option 2: The Developer UX Expansion (Increased Input, Compressed Output). check the sources should i update any document this change in decision? Yes, you will absolutely need to update your **AI PRD v1.0** , as this decision alters the fundamental constraints we established in Phase 1. 

By locking in **Option 2 (The Developer UX Expansion)** , we are increasing the input allowance to 2,500 characters to better support engineering workflows (like pasting error logs and stack traces) while aggressively compressing the output cap to 3,000 characters to keep our unit economics viable (since output tokens are generally 3x to 5x more expensive than input tokens). 

To successfully upload _any_ document larger than 4.5MB without crashing your Next.js application, you must decouple the file transfer from the serverless compute environment. Please confirm your preferred architectural solution to solve this payload limit so we can finalize the database schema parameters: 

architecture. By generating a signed URL from Next.js and uploading directly from the browser to the Supabase Storage bucket, you completely bypass Vercel's 4.5MB serverless payload limit with zero compute overhead. 

We are now officially ready to begin **Phase 5: Database Schema & Antigravity Scaffolding Prompts** . 

# **Choice 1: Enforcing the 10-Document Limit** 

You specified a strict limit of 10 PDFs (up to 25MB each) per project. How should we technically enforce this boundary? 

# • **Option A: Database-Level PostgreSQL Trigger (Strict Enforcement)** 

- **Pros:** Mathematically guarantees the limit is never breached. Even if a bad actor bypasses your Next.js UI and hits the Supabase API directly, the database will block the 11th INSERT. 

- **Cons:** Requires writing custom PL/pgSQL trigger functions, meaning your Next.js frontend will need logic to parse the specific database error and show a user-friendly message. 

- **Cost Implications:** Negligible compute cost during document insertion. 

- **Scalability & Complexity:** Moderate complexity, but bulletproof scalability for tenant isolation. 

# **Choice 2: Vector Indexing Strategy for** pgvector 

A single project with 10 large 25MB PDFs could generate up to 3,000 document chunks. To maintain your sub-1.5s TTFT latency, we must index the vectors. 

**Remediation:** Evaluate the 10-document limit within the Next.js API application layer via a COUNT() query _before_ attempting the insert or generating the signed URL. The database trigger can remain as a secondary safety net, but UI state should never depend on stringmatching raw SQL exceptions. 

# **2. Architectural & Delivery Options** 

Please select one option from each category below so I can correctly generate your Phase 5 deliverables. 

# **Choice B: Antigravity Scaffolding Prompt Structure** 

AI agents (like Antigravity 2.0) have large context windows, but handing them a massive set of instructions mixing complex SQL (RLS, Triggers, Reciprocal Rank Fusion) with complex frontend React code often leads to skipped steps or hallucinated configurations. 

- **Option 2: The Two-Step Modular Sequence (Recommended)** 

   - **Mechanics:** I split Phase 5 into two explicit prompts. **Prompt 5A** will be designed for you to copy/paste directly into your Supabase SQL Editor (handling the schema, pgvector, IVFFlat, RLS, and RRF function). **Prompt 5B** will be given to Antigravity to build the Next.js app, connecting to the database you just verified. 

   - **Pros:** Guarantees your complex database layer is bulletproof before the AI writes a single line of React. 

   - **Cons:** Requires you to manually run the SQL script in the Supabase dashboard rather than having the agent do it locally via migration files. 

# **Clarifying Questions** 

1. User Authentication vs. Anonymous Workspaces: The application will use Supabase Auth (Email/Password). Projects and documents are securely linked to authenticated users, with tenant isolation strictly enforced via PostgreSQL Row-Level Security (RLS) using the direct project-level join condition projects.user_id = auth.uid() 

Failed Uploads in the Document Counter: The 10-document maximum per project strictly counts only document records where status != 'failed'. This rule is enforced by a PostgreSQL BEFORE INSERT trigger that mathematically blocks the 11th non-failed document by raising a custom SQLSTATE P0001 exception, ensuring users are not penalized for corrupted or interrupted uploads 

# **Architectural Choices for Schema Configuration Choice 1: PostgreSQL Full-Text Search Configuration (BM25 Index)** 

Because the users are software engineers querying logs, acronyms, and syntax, the choice of PostgreSQL text search dictionary dictates how exact error codes and identifiers are indexed: 

# • **Option A: Standard** 'english' **Configuration** 

- **Mechanics:** Uses PostgreSQL’s default English dictionary with linguistic stemming (e.g., "debugging" reduces to "debug"). 

- **Pros:** Optimal for natural language prose, documentation sentences, and standard architectural questions. 

- **Cons:** Aggressively strips punctuation and stems technical keywords, degrading search accuracy on exact error codes (ERR_CONNECTION_RESET), camelCase identifiers, or SemVer strings. 

- **Cost Implications:** Standard storage and compute footprint. 

- **Scalability & Complexity:** Low complexity; built-in default. 

# **Clarifying Questions** 

Before I generate the Phase 5 Supabase SQL schema prompt (Prompt 5A) for your Antigravity agent, we must finalize which AI Inference API your application will use at runtime to generate embeddings and text. 

Which API provider do you want to power your RAG pipeline? 

# **Options for AI Inference & Embeddings** 

# **Option B: The Stable Efficiency Stack (Gemini 3.6 Flash & Gemini 3.1 Pro)** 

- **Mechanics:** Uses gemini-3.6-flash (the direct replacement for 3.5) for intake, and the mature gemini-3.1-pro for reasoning. 

- **Pros:** Highly stable and significantly cheaper than the Argon tier, safely protecting your unit economics while still providing excellent technical RAG capabilities. 

- **Cons:** These models are slightly older in the Google release cycle and may face deprecation warnings sooner than Option A. 

- **Cost Implications:** Low. Easily maintains the ₹0.50 p95 unit cost constraint. 

- **Scalability & Complexity:** Low complexity. Identical implementation effort. 

# **Option A: Strict User-Level Isolation** 

- **Pros:** Maximum privacy. A user can only see and review their own chat history and feedback logs. 

- **Cons:** Project administrators cannot see what questions their teammates are asking or audit hallucination failures across the workspace. 

- **Cost Implications:** None. 

- **Scalability & Complexity:** Simple RLS policy matching auth.uid() 

The following parameters are officially locked into our Phase 5 architectural specification: 

- **User Authentication:** Supabase Auth (projects and documents linked to authenticated users). 

- **Document Counter Limit:** Enforces the 10-document maximum per project strictly against rows where status != 'failed'. 

- **Full-Text Search Dictionary:** Option A (Standard 'english' configuration with linguistic stemming). 

- **Delivery Sequence:** The Two-Step Modular Sequence (Prompt 5A for Supabase SQL first, Prompt 5B for Google Antigravity scaffolding second). 

No code or prompts will be generated at this time. 

Before we can draft **Prompt 5A (The Supabase SQL Migration Script)** , there are **two clarifying questions** and **two architectural choices** regarding database schema design and Row-Level Security (RLS) enforcement that require your decision. 

# **Clarifying Questions** 

1. **Auth Provider Details:** In Supabase Auth, which specific login methods do you plan to enable for your software engineering users (e.g., standard Email/Password, GitHub OAuth, or Google OAuth)? 

# **Architectural Choices for Schema Configuration Choice 1: Supabase Storage & Database Synchronization for 25MB Files** 

Because files up to 25MB are uploaded directly from the browser to a private Supabase Storage bucket via Signed URLs, the database must track the file's lifecycle: 

- **Option A: Pre-Allocated Record with Status Machine (Recommended)** 

   - **Mechanics:** Before generating the signed upload URL, Next.js inserts a row into documents with status = 'pending_upload'. Once the browser completes the direct upload, Next.js updates the status to 'uploaded' and emits the Inngest event. If the upload is aborted, a cleanup job deletes stale 'pending_upload' records. 

   - **Pros:** Strict tracking; prevents orphan files in storage; enables the UI to immediately show a progress bar tied to a real document ID. 

   - **Cons:** Requires handling cleanup logic for abandoned uploads that never finish. 

   - **Cost Implications:** Negligible database write operations. 

- **Scalability & Complexity:** Standard production pattern; low-to-medium complexity. 

# **Choice 2: Row-Level Security (RLS) Policy Granularity** 

Supabase PostgreSQL uses Row-Level Security (RLS) to enforce tenant isolation between projects and vectors: 

- **Option A: Direct Project-Level Join RLS** 

   - **Mechanics:** The document_chunks table inherits access directly via a policy checking EXISTS (SELECT 1 FROM projects WHERE projects.id = document_chunks.project_id AND projects.user_id = auth.uid()). 

   - **Pros:** Highly secure; impossible for a user to query or retrieve chunks from a project they do not own. 

   - **Cons:** Adds a subquery join on every retrieval query, which can add 2–5ms of overhead to large vector similarity scans. 

   - **Cost Implications:** Minor CPU usage increase on high-volume retrieval calls. 

   - **Scalability & Complexity:** Low complexity; standard Supabase security practice. 

Please provide your answers to the **two clarifying questions** and select your preferred paths for **Choice 1** and **Choice 2** . 

Auth Provider Details: In Supabase Auth, Direct Project-Level Join RLS, dont generate any code or prompt just lock the options and ask me if there are still clarifying questions or choices to be made! 

# **Option B: The Balanced 1536 Dimensions (via MRL)** 

- **Pros:** You get a massive accuracy boost over the old 768-dimension baseline, while keeping the database footprint manageable. 

- **Cons:** Slight truncation of the vector space means a marginal loss in theoretical recall compared to the full 3072. 

- **Cost Implications:** Halves the physical disk footprint compared to Option A, comfortably protecting your free tier. 

- **Scalability & Complexity:** Highly scalable; requires passing an MRL truncation parameter in your Inngest embedding step. 

Option A: Transition to HNSW (Hierarchical Navigable Small World) Index 

**Direct Project-Level Join RLS** and **Supabase Auth** are securely locked into the architectural specification. No code or prompts will be generated at this time. 

Because you requested I highlight any remaining gaps, there are **two architectural choices** and **one clarifying question** left unanswered from the previous turn that must be resolved before drafting the Phase 5 Supabase SQL schema and Antigravity scaffolding prompts. 

# **Outstanding Architectural Choices** 

# **Choice 1: Supabase Storage & Database Synchronization** 

Since we are bypassing Vercel's limits using direct browser-to-Supabase signed URLs for large files, the database must track the file's lifecycle to prevent orphan files. 

- **Option A: Pre-Allocated Record with Status Machine (Recommended)** 

   - **Mechanics:** Next.js inserts a documents row with status = 'pending_upload' before generating the signed URL. Once the browser upload finishes, Next.js updates it to 'uploaded' and triggers Inngest. 

   - **Pros:** Enables the specific real-time UI loading states ( _"Searching project sources..."_ ) mandated by your UX Flow; guarantees strict asset tracking. 

   - **Cons:** Requires background cleanup logic for uploads that users abandon mid-way. 

   - **Cost Implications:** Negligible database write operations. 

   - **Scalability & Complexity:** Standard production pattern for resilient file ingestion. 

# **Choice 2: Project & Document Deletion Strategy** 

Your AI PRD v1.0 explicitly requires an "Isolation Gate: Verification that deleting a project removes vectors". 

- **Option A: PostgreSQL** CASCADE DELETE **(Hard Delete)** 

   - **Mechanics:** Deleting a projects row automatically cascades down, instantly wiping all child documents, document_chunks, and vectors from the database. 

   - **Pros:** Mathematically guarantees compliance with your PRD's Isolation Gate; instantly reclaims database space within your free tier. 

- **Cons:** Accidental deletions are permanent unless restored from a Supabase backup. 

- **Cost Implications:** Zero ongoing storage costs for deleted projects. 

- **Scalability & Complexity:** Lowest complexity; handled natively by PostgreSQL foreign key constraints. 

# **Outstanding Clarifying Question** 

1. **Specific Auth Providers:** You confirmed "Supabase Auth" for multi-tenant isolation, but which specific login methods should the Antigravity agent scaffold into your Next.js UI (e.g., standard Email/Password, GitHub OAuth, or Google OAuth)? 

Please provide your preference for **Choice 1** , **Choice 2** , and the **Auth Provider method** . Once locked, we will be ready to generate your first Phase 5 prompt! 

**Pre-Allocated Record with Status Machine &  PostgreSQL CASCADE DELETE, standard Email/Password. dont generate any code or prompt just lock the options and ask me if there are still clarifying questions or choices to be made!** 

The following parameters are locked into the Phase 5 technical specification: 

- **File Lifecycle & Sync:** Pre-allocated record with a status machine (pending_upload $\rightarrow$ uploaded $\rightarrow$ processing $\rightarrow$ indexed / failed). 

- **Deletion Strategy:** PostgreSQL CASCADE DELETE (deleting a project automatically purges child documents, chunks, and embeddings to satisfy the PRD Isolation Gate). 

- **Authentication Provider:** Supabase Auth utilizing standard Email and Password credentials. 

**Storage Bucket Object Pathing:** A scoped project tenant hierarchy was selected. The file paths will explicitly use the {user_id}/{project_id}/{document_id}/{filename} structure to ensure strict path isolation. 

**PostgreSQL Trigger Error Behavior on 11th Document:** The trigger will raise a specific custom exception rather than a generic database error. It utilizes the standard SQLSTATE P0001 (ERR_MAX_DOCS_EXCEEDED) with the explicit text: "Project document limit reached: maximum 10 documents allowed." 

# **Outstanding Architectural Choices** 

# **Choice 1: Supabase Storage Bucket Security (Storage RLS vs. Storage Policies)** 

Because files are uploaded directly from the browser using pre-signed upload URLs or client SDK uploads to private buckets, access to the raw PDF binaries in Supabase Storage must be controlled: 

- **Option A: Signed URL Only Access (Fully Private Bucket, No Public RLS)** 

- **Pros:** The storage bucket has zero public access; files are only read or written via short-lived cryptographic signed URLs generated on the server (Next.js server action/route handler). 

- **Cons:** Every preview or download of the original PDF requires generating a new ephemeral signed download URL. 

- **Cost Implications:** Negligible compute overhead; avoids egress bandwidth leaks. 

- **Scalability & Complexity:** Standard security pattern; low maintenance. 

**Choice 2: Micro-Feedback Table Relationship (** interaction_logs **Schema)** 

The system collects inline micro-feedback ( / ) to feed the evaluation flywheel: 

- **Option A: Unified Interaction & Feedback Table (** interactions **)** 

   - **Mechanics:** A single table stores the user prompt, retrieved chunk IDs, assistant response markdown, token counts, latency, and nullable feedback fields (rating, issue_tag, comment) updated in-place when the user clicks a feedback button. 

   - **Pros:** Eliminates relational joins during eval sampling; straightforward schema. 

   - **Cons:** Requires an UPDATE on existing interaction rows when feedback is submitted. 

   - **Cost Implications:** Minimal storage; fits within the Supabase 500MB free-tier. 

   - **Scalability & Complexity:** Low complexity; single table to query during Phase 8 evals. 

All secondary configuration details (such as Supabase storage bucket pathing and specific PL/pgSQL error codes) will use production-standard defaults: 

{user_id}/{project_id}/{document_id}/{filename} for path isolation, and standard SQLSTATE P0001 with clear descriptive exception text for the 10-document limit trigger. 

To finalize **Prompt 5A (The Supabase SQL Migration Script)** , there are only **two genuine architectural decisions** remaining that dictate table structures and stored procedures in PostgreSQL. 

# **Decision 1 (MUST): Hybrid Search & RRF Execution Layer** 

Hybrid search requires executing dense vector similarity (pgvector) and sparse keyword matching (tsvector), then merging their ranks using Reciprocal Rank Fusion (RRF). Prompt 5A must know whether PostgreSQL or Next.js executes this fusion logic. 

**Option A: PostgreSQL Stored Procedure (Database RPC Function — Recommended)** A custom PL/pgSQL function (match_chunks_hybrid_rrf) runs both dense and sparse searches concurrently inside PostgreSQL, calculates the RRF score directly via a CTE (Common Table Expression), applies tenant RLS filtering, and returns the top-$K$ chunks in a single database round-trip. 

- **Pros:** Minimal network latency (1 round-trip between Next.js and Supabase instead of 2); keeps complex search mathematics isolated in the database engine; preserves the sub-2.0s TTFT SLA. 

- **Cons:** Harder to iterate or tweak search ranking weights post-deployment without running an ALTER FUNCTION database migration. 

- **Cost Implications:** Lowest compute and egress cost; eliminates transferring unranked candidate pools over the wire. 

- **Scalability & Complexity:** Highly scalable; low application-layer complexity in Next.js. 

# **Decision 2 (SHOULD): Telemetry & Micro-Feedback Schema Design** 

The system captures / feedback to feed the golden evaluation suite and detect quality drift. Prompt 5A must define how these logs are stored in PostgreSQL. 

**Option A: Unified** interactions **Table (Flat Architecture — Recommended)** 

A single table stores the entire turn: project_id, user_id, query_text, retrieved_chunk_ids (UUID array), response_markdown, token_counts, latency_ms, and nullable feedback columns (rating [thumbs_up/thumbs_down], issue_tag, user_comment) that are updated in-place when a user reacts. 

- **Pros:** Simplest schema; zero relational joins required when pulling eval regression rows or running weekly PM audit queries (SELECT * FROM interactions WHERE rating = 'thumbs_down'). 

- **Cons:** Performing an UPDATE on existing interaction rows when feedback is submitted means write traffic touches previously committed records. 

- **Cost Implications:** Minimal disk footprint; easily remains within the Supabase 500MB free-tier limit. 

- **Scalability & Complexity:** Low complexity; single table to query for Phase 8 evaluations. 

Please state your choices for **Decision 1** (PostgreSQL Stored Procedure vs. Next.js Application Fusion) and **Decision 2** (Unified interactions vs. Decoupled chat_logs + feedback_events). 

Once confirmed, there are no remaining blockers, and Prompt 5A will be generated immediately. 

# **Gap Identification & Clarifying Questions** 

**The 60% Happy Path Split:** The 60% allocation is strictly divided into **45% Fact-Based Lookups** and **15% Multi-Hop Synthesis** . This exact internal split protects your ₹0.50 p95 unit cost SLA by ensuring the bulk of your traffic (45%) continues to route to the cheaper, fast intake model (Gemini Flash) via sparse exact match, reserving the expensive frontier model (Gemini Pro) strictly for the 15% of complex multi-hop queries. 

**The Missing Comparative Category:** Comparative tasks were deprecated as a standalone 15% bucket and explicitly folded into the expanded Edge Cases category. 

# **Options for Restructuring the 60% Happy Path** 

Please approve one of the following splits for the 60% Happy Path so we can lock in the cost economics for PRD v2.0: 

# **Option A: The Efficiency-Biased Split (Recommended)** 

- _Design:_ **Fact-Based Lookups (45%)** + **Multi-Hop Synthesis (15%)** . Comparative tasks are folded into Edge Cases. 

- _Pros:_ Maximizes routing to the cheaper Gemini Flash model, safely protecting your ₹0.50 p95 cost ceiling. 

- _Cons:_ Slightly reduces the testing surface area for complex reasoning. 

- _Cost Implications:_ Highly efficient; keeps the blended API cost well below the target limit. 

**The Efficiency-Biased Split and there is no Document 3: Golden Evaluation Benchmark did you hallucinate this?** 

The Efficiency-Biased Split (45% Fact-Based Lookups, 15% Multi-Hop Synthesis) successfully anchors your new 60/20/15/5 evaluation distribution, safely protecting your routing economics while expanding edge-case coverage. 

Before I generate the complete, finalized AI PRD v2.0 text, my strict protocol requires me to resolve a technical constraint regarding your "downloadable PDF" request and clarify two gaps introduced by your new evaluation metrics. 

Gap Identification & Clarifying Questions 

1. The PDF Delivery Constraint: 

As an AI, I cannot natively generate and host a downloadable .pdf binary file payload. 

- _Resolution:_ I will generate the PRD v2.0 as a highly structured, presentation-ready Markdown document. You can easily copy/paste this into your Google Antigravity 

IDE, Notion, or any Markdown editor and click "Export to PDF." Please confirm this delivery method is acceptable. 

2. The Regression Gate (Choice 1): Your new distribution dedicates 5% of the Golden Eval Set to "Regression" (queries that historically failed or drifted). We must define the exact Pass Bar for this new dimension in Section 5 of the PRD. 

- Option B: The Monitored Threshold (≥ 90% Pass Rate) 

   - _Design:_ Allows a small margin of error (e.g., 1 out of 5 regression queries can fail) without blocking the CI/CD pipeline. 

   - _Pros:_ Higher deployment velocity; accommodates the non-deterministic nature of LLMs. 

   - _Cons:_ Risks accumulating technical debt over time if small regressions are ignored. 

3. Cost Model Granularity (Choice 2): In PRD v1.0, Section 8 simply stated "p95 per-call cost $\le$ ₹0.50". Because the new 45% Flash / 15% Pro split alters your blended API burn rate, how detailed should the updated PRD v2.0 Cost Model be? 

- Option B: High-Level Constraint Only 

   - _Design:_ Retains the strict ₹0.50 ceiling as a business requirement but leaves the exact token math out of the PRD. 

   - _Pros:_ Cleaner document; remains accurate even if API prices drop. 

   - _Cons:_ Makes it harder for engineers to estimate the financial impact of adding features like Cross-Encoder Reranking. 

Please confirm the Markdown-to-PDF delivery method and select your preferred paths for Choice 1 and Choice 2. Once approved, I will instantly generate the complete AI PRD v2.0. 

# **Outstanding Must-Resolve Architectural Choices** 

To map your new OpenRouter routing strategy cleanly to the Next.js scaffolding logic, there are exactly **three remaining architectural decisions** we must lock in before generating Prompt 5A. 

Please provide your choices for the following: 

**Choice 1: Cold Start & Empty State UX (Interaction Context)** How should the Next.js UI guide software engineers before their first query in a fresh workspace? 

- **Option B: Inferred Document-Driven Starts:** The system uses a fast intake model to dynamically suggest a relevant first query based on the uploaded document. 

   - _Pros/Cons:_ Highly contextual and accelerates time-to-value. However, requires processing time immediately after a document upload. 

   - _Cost/Complexity:_ Low/Moderate API cost; moderate complexity requiring an LLM step inside the Inngest worker. 

**Choice 2: Ambiguity Resolution Strategy (Taxonomy Edge Case)** How should the assistant handle vague queries like "How does auth work?" when multiple conflicting auth documents exist? 

- **Option A: Proactive Clarification (Stateful):** The AI recognizes ambiguity and asks a clarifying question ("Do you mean OAuth in Doc A or JWT in Doc B?") before retrieving. 

   - _Pros/Cons:_ Prevents hallucination by leveraging multi-turn memory. However, adds a friction turn delaying actual technical value. 

**Choice 3: OpenRouter Taxonomy Mapping (API Gateway Strategy)** How should we map your 45% Fact-Based and 15% Multi-Hop categories to OpenRouter's specific routing capabilities? 

- **Option A: Explicit Model Fallback Chains:** Hardcoded arrays dictate routing (e.g., Fact-Based strictly routes to ["anthropic/claude-3-haiku", "google/gemini-1.5flash"]). 

   - _Pros/Cons:_ High predictability for quality and latency. However, requires manual codebase updates when OpenRouter adds new cheaper models. 

   - _Cost/Complexity:_ Predictable cost alignment with your ₹0.50 limit; low complexity. 

Once you approve your paths for these three choices, our Phase 1-4 baseline will be 100% complete and I will immediately generate **Prompt 5A (The Supabase SQL Migration Script)** . 

Before we unleash your Google Antigravity agent to begin writing code for **Phase 5: Database Schema & Antigravity Scaffolding Prompts** , I have audited our locked Phase 1-4 baselines against the specific requirements of generating an executable Supabase SQL script and Next.js project. 

We have an incredibly solid foundation, but there are **three technical implementation choices** we must lock in to ensure the generated code perfectly matches your workflow. 

Please review the following options and let me know your choices: 

# **Choice 1: Vector Schema Dimension (The SQL Column Width Gap)** 

Your earlier baselines were hardcoded to 768 dimensions (text-embedding-004), but your newer v3.0 reference documents introduce a 1536-dimension ecosystem (via geminiembedding-2). To write the exact CREATE TABLE schema in Prompt 5A, we must lock the column width. 

# • **Option A: Expand Schema to 1536 Dimensions (Adopt v3.0 Spec)** 

- **Pros:** Maximizes semantic recall accuracy by utilizing the full uncompressed latent space; matches the latest generation of embedding models. 

- **Cons:** Requires rewriting the legacy schema assumption. 

- **Cost Implications:** Increases the physical disk footprint of the document_chunks table, though easily absorbed by Supabase's 500MB free tier. 

- **Scalability & Complexity:** Low complexity; it's simply defining embedding vector(1536) in the SQL. 

# **Choice 2: UI Component Architecture for Next.js** 

When Prompt 5B instructs Antigravity to build the chat UI, progressive loaders, and document sidebar, it needs to know what UI library to rely on. 

- **Option A: shadcn/ui + Tailwind CSS (Recommended)** 

   - **Pros:** Industry standard for Next.js AI apps. Components are owned in your codebase (not npm packages), making it trivial to inject custom streaming logic or inline citation badges. 

   - **Cons:** Creates a slightly heavier initial boilerplate in your components/ui folder. 

   - **Cost Implications:** Free. 

   - **Scalability & Complexity:** Highly scalable; perfectly handles complex chat interfaces. 

# **Choice 3: Supabase Local Development Strategy** 

How should Antigravity handle the generation of your database schema? 

# • **Option B: Raw** schema.sql **Execution File** 

- **Pros:** Fastest time-to-value. The prompt outputs one massive SQL file that you simply copy-paste into the Supabase Web Dashboard SQL editor. 

- **Cons:** Harder to track changes locally or rollback if a mistake is made. 

- **Cost Implications:** Free. 

- **Scalability & Complexity:** Low complexity, but brittle for team collaboration later on. 

Once you declare your choices for **Vector Dimensions** , **UI Architecture** , and **Supabase Local Dev** , I will immediately generate **Prompt 5A: The Supabase SQL Migration Script** . 

# **Option A: 100% gemini-3.8-flash (Standard Single-Model)** 

- **Pros:** Absolute lowest cost, mathematically protects the ₹0.50 unit cost constraint, and ensures ultra-fast TTFT. 

- **Cons:** You lose the deep, multi-document reasoning capabilities of gemini-3.1-pro for complex edge cases. 

- **Cost Implications:** Keeps per-call costs drastically below ₹0.50. 

- **Scalability & Complexity:** Lowest complexity; a single API call for all queries. 

# **Option A: Pure Webhook (Stateless Upload)** 

- **Mechanics:** The frontend generates a generic signed URL. The user uploads. The Supabase webhook fires, triggering a Next.js Edge function that parses the document and creates a single status = 'indexed' database record. 

- **Pros:** Incredibly simple. Eliminates the pending_upload state entirely, removing the need for a nightly cleanup cron sweeper. 

- **Cons:** The UI cannot display a specific "Processing Document..." progress bar tied to a database row ID because the database row doesn't exist until processing is finished. 

- **Cost Implications:** Zero cleanup compute costs. 

- **Scalability & Complexity:** Lowest operational complexity. 

**Option A: Dedicated B-Tree Indexing (Recommended)** Create standard B-tree indexes specifically on the project_id and user_id columns in both the operational projects table and the document chunks table. 

- **Pros:** Transforms the heavy sequential security scan into a nearly instantaneous index hit, allowing the security layer to operate silently without disrupting the retrieval layer. 

- **Cons:** Marginal increase in database storage footprint for the B-tree structures. 

- **Cost Implications:** Negligible storage cost; safely protects the database compute budget from CPU saturation. 

- **Scalability & Complexity:** Low complexity; standard database optimization strategy 

**Option A: Dynamic Next.js Parameterization (Recommended)** Decouple the RRF tuning parameters (such as the $k$ constant and BM25 vs. vector weights) from the database schema and pass them as explicit arguments from the Next.js application into the RPC function at runtime. 

- **Pros:** Allows the engineering team to iterate on search accuracy instantly via application deployments or edge configs without ever locking the database schema. 

- **Cons:** Requires modifying the Next.js backend API payloads and the Supabase RPC signature. 

- **Cost Implications:** Maintains single network round-trip efficiency, preserving the TTFT SLA without added latency overhead. 

- **Scalability & Complexity:** Highly scalable; entirely removes the operational bottleneck of schema migrations 

**Option A: Decoupled Cron-Style Ingest Job (Recommended)** Remove the CREATE INDEX trigger from the standard embedding workflow entirely. Place it into a separate scheduled cron-style ingest job that periodically wakes up, checks if the chunk threshold has crossed 

- 1,000 rows, and attempts to build the index in isolation. 

   - **Pros:** Guarantees that upload processing never halts due to indexing timeouts. If the cron job fails, it only affects itself and retries on its own schedule without touching a user's upload flow. 

   - **Cons:** Requires provisioning and monitoring a secondary background scheduling service. 

   - **Cost Implications:** Moves heavy compute to off-peak asynchronous cycles, protecting free-tier database limits. 

   - **Scalability & Complexity:** Highly scalable architectural design; safely decouples completely different operational risk profiles 



**Option A: Supabase Storage Webhook (Recommended)** Replace client-side orchestration entirely. The Next.js application generates a generic signed URL, and the user uploads the file. A native Supabase Storage Webhook (storage.objects.insert) automatically triggers the Next.js backend the exact moment the file successfully lands in the bucket. 

- **Pros:** Guarantees 100% ingestion data integrity; dropped browser connections can never orphan files. 

- **Cons:** Requires configuring webhook endpoints and secrets manually inside the Supabase dashboard. 

- **Cost Implications:** Zero extra API costs; eliminates the need for an aggressive cron sweeper to clean up storage. 

- **Scalability & Complexity:** Moderate setup complexity, but delivers the lowest operational complexity long-term. 

Option A: Edge Runtime Migration & Single-Model Consolidation 

Remove the Classifier-Based Router and route 100% of queries through a single fast model (Gemini 1.5 Flash). Simultaneously, migrate the Next.js chat generation API route to the Vercel Edge Runtime to bypass the 10-second Node.js limit. 

Pros: Reclaims ~1.0s of TTFT latency by removing the classifier overhead, and Edge Runtime ensures long SSE streams never 504 Timeout. 

Cons: You lose the deep, multi-document reasoning capabilities of the heavier Pro model for complex edge cases. 

Cost Implications: Absolute lowest cost; mathematically protects the ₹0.50 unit cost constraint. 

Scalability & Complexity: Lowest architectural complexity; highly maintainable for a solo developer. 

**Option B: Day-1 HNSW (Hierarchical Navigable Small World) Index** Remove the deferred trigger and build an HNSW index immediately upon table creation. 

- **Pros:** Handles incremental inserts smoothly from day one without requiring a populated data threshold to calculate cluster centroids. 

- **Cons:** Consumes slightly more RAM footprint than a flat list. 

- **Cost Implications:** Safely fits within the Supabase 500MB free tier given the 10-document project limit. 

- **Scalability & Complexity:** Low complexity to implement (a single standard database migration), and highly scalable if user limits are increased. 

Option B: High-Precision Density (m=32, ef_construction=128) 

Pros: Maximizes semantic recall accuracy for 1536-dimensional embeddings, heavily reducing the chance of vector distortion on dense technical queries. 

Cons: Increases the RAM footprint of the index and requires more database CPU time during document insertion. 

Cost Implications: Increases the physical disk footprint slightly, though at a 10-document project limit, it easily fits within the free tier. 

Scalability & Complexity: Moderate impact on ingestion latency. 

# **Option A: The simple Dictionary (Recommended for Technical RAG)** 

- **Pros:** Bypasses linguistic stemming to perfectly preserve exact technical punctuation, hyphens, underscores, and camelCase syntax (e.g., ERR_CONNECTION_RESET or user_id). 

- **Cons:** Less forgiving for natural language variations (a search for "configured" will not match the word "configure" in the text). 

- **Cost Implications:** Standard compute footprint. 

- **Scalability & Complexity:** Low complexity; highly effective for software engineering logs and JSON payloads. 

Option A: Next.js Edge API Webhook (Recommended) 

Mechanics: The Supabase Storage bucket sends an HTTP POST event to a secured /api/webhooks/storage Next.js Edge route. The Edge route downloads the file, calls Gemini 1.5 Flash for extraction, generates the embeddings, and writes all chunks to the database in a single synchronous function. 

Pros: Keeps all multimodal parsing, embedding generation, and database insertion logic cleanly consolidated in TypeScript within the Edge runtime. 

Cons: Requires configuring a webhook secret in the Supabase dashboard to verify the payload signature in Next.js. 

Cost Implications: Consumes standard Vercel Edge compute for the duration of the extraction. 

Scalability & Complexity: Highly maintainable for a solo developer; prevents business logic from being scattered inside database triggers 

# **Option A: Pure GitHub Flavored Markdown (GFM) Pipeline (Speed & Cost Optimized)** 

- **Mechanics:** Background workers stream raw buffers directly to Gemini 3.8 Flash, which natively extracts multi-column layouts and dense tabular data straight into Markdown, bypassing OCR bloat. 

- **Pros:** Requires zero token cost to export instantly to an IDE or text editor. Provides clean text that SREs can parse instantly under pressure during a live 3 a.m. incident. Perfectly aligns with your strict latency budgets and cost margins. 

- **Cons:** Leaves the system vulnerable on complex multi-hop queries (20% of traffic) where structural weighting is needed for Reciprocal Rank Fusion (RRF) keyword signals. Relies on implicit boundaries that can fail silently. 

- **Cost Implications:** Mathematically protects the 50 cents per turn SLA and the 2.0s TTFT SLA. 

- **Scalability & Complexity:** Low complexity. The background worker pipeline is already tuned to leverage Gemini's native layout extraction into GFM 

Option A: JSONB Structural Metadata Anchoring (Recommended) 

Mechanics: The PostgreSQL text column stores the pure, lightweight GFM string. We expand the existing metadata JSONB column so that during the Gemini 3.8-flash extraction, it explicitly logs structural markers (e.g., {"is_tabular": true, "parent_headers": ["## Auth", "### Tokens"]}). 

Pros: Neutralizes the risk of silent table corruption by giving the frontend explicit JSON flags to validate chunk integrity. Anchors your RRF retrieval using precise hierarchical data without bloating the actual text payload. 

Cons: Requires slightly more precise prompting for the Gemini extraction step to ensure it outputs both Markdown and the accompanying JSON object. 

Cost Implications: Zero extra database storage cost (reutilizes the established JSONB column schema). 

Scalability & Complexity: Moderate complexity during the Next.js ingestion step, but highly scalable and keeps the vector embeddings hyper-focused on the text. 

Option A: Direct Foreign Key to auth.users (Strict Integrity) 

**Option A: Direct Foreign Key to auth.users (Strict Integrity)** 

- **Mechanics:** The SQL adds FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE. 

- **Pros:** Guarantees database-level integrity; if a user is deleted from Supabase Auth, their projects and vectors cascade delete automatically. 

- **Cons:** Tightly couples your public schema to the managed Supabase auth schema, which can sometimes cause friction during local Docker testing if auth users aren't explicitly seeded. 

- **Cost Implications:** Zero cost. 

- **Scalability & Complexity:** Low complexity; standard Supabase practice. 

Option A: Include Storage DDL & RLS in SQL Script 

Mechanics: The SQL script will include the INSERT INTO storage.buckets command and the required storage.objects RLS policies. 

Pros: Provides a true "one-click" database setup. Your entire infrastructure, including secure storage, is reproducible entirely via code. 

Cons: Makes the SQL execution script longer and slightly more complex. 

Cost Implications: Zero cost. 

Scalability & Complexity: Highly scalable Infrastructure-as-Code patter 

# **Option B: TEXT Column with CHECK Constraint (Recommended)** 

- **Mechanics:** status TEXT CHECK (status IN ('pending_upload', 'uploaded', ...)) 

- **Pros:** Provides identical data safety to ENUMs but is vastly easier to update via a simple ALTER TABLE constraint drop/add during future workflow expansions. 

- **Cons:** Marginally less structurally rigid than a custom native data type. 

- **Cost Implications:** Negligible footprint. 

- **Scalability & Complexity:** Highly scalable and developer-friendly. 

Option A: Direct Foreign Key to auth.users (Strict Integrity) 

Mechanics: The SQL adds FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE. 

Pros: Guarantees database-level integrity; if a user is deleted from Supabase Auth, their projects and vectors cascade delete automatically. 

Cons: Tightly couples your public schema to the managed Supabase auth schema, which can sometimes cause friction during local Docker testing if auth users aren't explicitly seeded. 

Cost Implications: Zero cost. 

Scalability & Complexity: Low complexity; standard Supabase practice 

# **Option A: Single-Model Direct Multimodal Extraction (Recommended)** 

- **Mechanics:** The webhook downloads the raw binary buffer from Supabase Storage and streams it directly to gemini-3.8-flash using multimodal inline data. The prompt enforces direct extraction of multi-column layouts, code blocks, and tables into clean GitHub-Flavored Markdown (GFM). 

- **Pros:** Zero external parsing dependencies (no pdf-parse, pdfjs-dist, or third-party OCR SaaS); reuses the centralized Google API key; preserves dense markdown tables. 

- **Cons:** Consumes Gemini input tokens for every uploaded file. 

- **Cost Implications:** Fits comfortably within the ₹0.50 unit cost model; eliminates third-party parsing subscriptions. 

- **Scalability & Complexity:** Lowest implementation complexity; single API integration 

# **Option A: Heading-Aware Block Splitter with Atomic Tables (Recommended)** 

- **Mechanics:** Splits markdown text along structural boundaries (##, ###, code fences ```, and table boundaries |). Slices into a target envelope of 500 to 800 tokens. If a table or code fence falls within a section, it is treated as an atomic unit and never split across chunk boundaries. 

- **Pros:** Prevents broken code snippets and fragmented table rows, preserving tabular and exact-match retrieval precision. 

- **Cons:** Chunks can vary in token length (e.g., a massive 900-token table cannot be subdivided without losing its headers). 

- **Cost Implications:** Baseline embedding cost (1 embedding call per 500–800 token chunk). 

- **Scalability & Complexity:** Low complexity; standard regex-based AST markdown parser. 

# **Option A: Deterministic Application-Layer Metadata Tagging (Recommended)** 

- **Mechanics:** After gemini-3.8-flash extracts the Markdown, a TypeScript parser scans the markdown chunks locally, flagging structural attributes (e.g., {"is_tabular": true, "parent_headers": ["## Auth", "### Tokens"]}, estimated page/line offsets) and stores them directly in the database metadata JSONB column. 

- **Pros:** Fast, deterministic, and adds zero latency to the LLM generation step. 

- **Cons:** PDF page number mapping is approximate based on markdown section breaks rather than exact visual bounding boxes. 

- **Cost Implications:** Zero extra LLM token cost. 

- **Scalability & Complexity:** Low complexity; reliable and easy to debug 

