import { GoogleGenAI } from "@google/genai"
import { PDFDocument } from "pdf-lib"
import { createAdminClient } from "@/lib/supabase/admin"
import { splitMarkdown } from "@/lib/chunking/splitter"

export const runtime = "edge"

declare module "@google/genai" {
  interface Models {
    batchEmbedContents(params: {
      model: string
      requests: Array<{
        content: { parts: Array<{ text: string }> } | string
        outputDimensionality?: number
      }>
      config?: { abortSignal?: AbortSignal }
    }): Promise<{ embeddings: Array<{ values: number[] }> }>
  }
}

interface StorageWebhookPayload {
  type?: string
  table?: string
  schema?: string
  record?: {
    name?: string
    bucket_id?: string
    id?: string
    owner?: string
    [key: string]: unknown
  }
  old_record?: unknown
  name?: string
  storagePath?: string
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64")
  }
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function resolveMimeType(filename: string, blobType?: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "pdf") return "application/pdf"
  if (ext === "txt") return "text/plain"
  if (ext === "html" || ext === "htm") return "text/html"
  return blobType || "application/octet-stream"
}

export async function POST(req: Request) {
  const startTime = Date.now()

  // 1. Edge Runtime 10-Minute Timeout Guard
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 600000)

  let documentId: string | null = null
  const adminClient = createAdminClient()

  try {
    // 2. Payload Parsing & Secret Verification
    const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET
    if (webhookSecret) {
      const secretHeader = req.headers.get("x-webhook-secret")
      const authHeader = req.headers.get("authorization")
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null

      const isAuthorized =
        secretHeader === webhookSecret ||
        authHeader === webhookSecret ||
        bearerToken === webhookSecret

      if (!isAuthorized) {
        clearTimeout(timeoutId)
        return new Response(
          JSON.stringify({ error: "Unauthorized webhook caller" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        )
      }
    }

    let body: StorageWebhookPayload
    try {
      body = await req.json()
    } catch {
      clearTimeout(timeoutId)
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Parse storage path: ${userId}/${projectId}/${documentId}/${filename}
    const rawPath = body.record?.name || body.name || body.storagePath
    if (!rawPath || typeof rawPath !== "string") {
      clearTimeout(timeoutId)
      return new Response(
        JSON.stringify({ error: "Storage path ('name') missing from payload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const segments = rawPath.split("/")
    if (segments.length < 4) {
      clearTimeout(timeoutId)
      return new Response(
        JSON.stringify({
          error: `Invalid storage path structure: '${rawPath}'. Expected: userId/projectId/documentId/filename`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const [userId, projectId, parsedDocId, ...filenameParts] = segments
    documentId = parsedDocId
    const filename = filenameParts.join("/")
    const storagePath = rawPath

    // Verify target project exists and belongs to the user
    const { data: project, error: projErr } = await adminClient
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single()

    if (projErr || !project) {
      clearTimeout(timeoutId)
      return new Response(
        JSON.stringify({
          error: `Project '${projectId}' not found or database query failed`,
          details: projErr?.message,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    }

    if (project.user_id !== userId) {
      clearTimeout(timeoutId)
      return new Response(
        JSON.stringify({
          error: `Unauthorized: User '${userId}' does not own project '${projectId}'`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    }

    // 3. Stage 1 Update (Pre-Flag Status to 'processing')
    await adminClient.from("documents").upsert({
      id: documentId,
      project_id: projectId,
      storage_path: storagePath,
      status: "processing",
    })

    // 4. Binary Download & Multimodal Markdown Extraction
    const { data: blob, error: downloadError } = await adminClient.storage
      .from("documents")
      .download(storagePath)

    if (downloadError || !blob) {
      throw new Error(
        `Failed to download '${storagePath}': ${downloadError?.message}`
      )
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable")
    }

    const ai = new GoogleGenAI({ apiKey })

    if (!("batchEmbedContents" in ai.models)) {
      Object.defineProperty(ai.models, "batchEmbedContents", {
        value: async (params: {
          model: string
          requests: Array<{
            content: { parts: Array<{ text: string }> } | string
            outputDimensionality?: number
          }>
          config?: { abortSignal?: AbortSignal }
        }) => {
          const contents = params.requests.map((r) =>
            typeof r.content === "string" ? r.content : r.content.parts?.[0]?.text || ""
          )
          const res = await ai.models.embedContent({
            model: params.model,
            contents,
            config: {
              outputDimensionality: params.requests[0]?.outputDimensionality || 1536,
              abortSignal: controller.signal,
            },
          })
          return {
            embeddings: (res.embeddings || []).map((e) => ({
              values: e.values || [],
            })),
          }
        },
        configurable: true,
        writable: true,
      })
    }

    // --- START SURGICAL PATCH: WINDOWED MULTIMODAL EXTRACTION ---
    let extractedMarkdown = ""

    if (filename.toLowerCase().endsWith(".pdf")) {
      const pdfBytes = await blob.arrayBuffer()
      const srcDoc = await PDFDocument.load(pdfBytes)
      const totalPages = srcDoc.getPageCount()
      const PAGE_WINDOW = 25

      if (totalPages <= PAGE_WINDOW) {
        // Single pass for short documents (<= 25 pages)
        const base64Data = Buffer.from(pdfBytes).toString("base64")
        const extractionResult = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: base64Data,
                  },
                },
                {
                  text: `You are a specialized document parser. Convert this technical PDF into clean GitHub-Flavored Markdown (GFM).

1. Preserve all headings hierarchy (##, ###).
2. Format tables with pipe syntax (| Col 1 | Col 2 |).
3. Enclose code blocks in triple backticks with language tags.
4. Return ONLY raw Markdown text. Do NOT wrap in conversational intro or outro.`,
                },
              ],
            },
          ],
          config: {
            abortSignal: controller.signal,
          },
        })
        extractedMarkdown = extractionResult.text || ""
      } else {
        // Windowed slicing for large documents (> 25 pages)
        const markdownSlices: string[] = []

        for (let startPage = 0; startPage < totalPages; startPage += PAGE_WINDOW) {
          const endPage = Math.min(startPage + PAGE_WINDOW, totalPages)
          const subDoc = await PDFDocument.create()
          const pageIndices = Array.from(
            { length: endPage - startPage },
            (_, idx) => startPage + idx
          )

          const copiedPages = await subDoc.copyPages(srcDoc, pageIndices)
          copiedPages.forEach((p) => subDoc.addPage(p))

          const subDocBytes = await subDoc.save()
          const subBase64 = Buffer.from(subDocBytes).toString("base64")

          const sliceResult = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: "application/pdf",
                      data: subBase64,
                    },
                  },
                  {
                    text: `You are a specialized document parser. Convert this PDF section (pages ${startPage + 1} to ${endPage} of ${totalPages}) into clean GitHub-Flavored Markdown (GFM).

1. Preserve all structural headers, code blocks, and markdown tables.
2. Maintain table row alignment without truncating columns.
3. Return ONLY raw Markdown. No conversational intro or outro.`,
                  },
                ],
              },
            ],
            config: {
              abortSignal: controller.signal,
            },
          })

          if (sliceResult.text) {
            markdownSlices.push(sliceResult.text)
          }
        }

        extractedMarkdown = markdownSlices.join("\n\n")
      }
    } else {
      // Plain text / HTML handling
      extractedMarkdown = await blob.text()
    }

    if (!extractedMarkdown || extractedMarkdown.trim().length === 0) {
      throw new Error("Gemini multimodal extraction returned empty markdown")
    }
    // --- END SURGICAL PATCH ---

    // 5. Inferred Document-Driven Starts (Suggested Queries)
    let suggestedQueriesArray: string[] = []
    try {
      const sampleQueriesResult = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Document content:\n\n${extractedMarkdown.slice(0, 3000)}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            "You are a technical assistant. Based on the following document, generate exactly 3 relevant, highly specific technical questions a software engineer would ask. Return only a JSON array of strings.",
          responseMimeType: "application/json",
          abortSignal: controller.signal,
        },
      })

      const rawJson = sampleQueriesResult.text?.trim()
      if (rawJson) {
        const parsed = JSON.parse(rawJson)
        if (Array.isArray(parsed)) {
          suggestedQueriesArray = parsed
            .filter(
              (q): q is string => typeof q === "string" && q.trim().length > 0
            )
            .slice(0, 3)
        }
      }

      if (suggestedQueriesArray.length > 0) {
        await adminClient
          .from("projects")
          .update({ suggested_queries: suggestedQueriesArray })
          .eq("id", projectId)
      }
    } catch (queryGenErr) {
      console.warn("Failed to generate suggested queries:", queryGenErr)
    }

    // 6. Deterministic Structure-Aware Chunking & 1536d Vectorization
    const chunks = splitMarkdown(extractedMarkdown, {
      minTokens: 300,
      maxTokens: 800,
    })

    if (chunks.length === 0) {
      throw new Error("Document chunker produced 0 chunks from extracted markdown")
    }

    // --- START SURGICAL PATCH: THROTTLED CONCURRENCY POOL (BATCH SIZE = 4) ---
    const BATCH_SIZE = 4;
    const rawEmbeddings: number[][] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const slice = chunks.slice(i, i + BATCH_SIZE);
      const batchVectors = await Promise.all(
        slice.map(async (chunk, sliceIndex) => {
          const globalIndex = i + sliceIndex;
          const res: any = await ai.models.embedContent({
            model: "gemini-embedding-2",
            contents: chunk.content,
            config: {
              outputDimensionality: 1536,
            },
          });

          const values =
            res?.embedding?.values ||
            res?.embeddings?.[0]?.values ||
            (res as any)?.values ||
            (Array.isArray(res?.embedding) ? res.embedding : null);

          if (!values || !Array.isArray(values) || values.length === 0) {
            throw new Error(
              `Embedding extraction failed for chunk ${globalIndex} in document ${documentId}`
            );
          }

          return values as number[];
        })
      );

      rawEmbeddings.push(...batchVectors);
    }

    // Fail-Fast Atomic Cardinality Guard
    if (rawEmbeddings.length !== chunks.length) {
      throw new Error(
        `Cardinality mismatch: expected ${chunks.length} vectors for document ${documentId}, but received ${rawEmbeddings.length}`
      );
    }

    // Construct chunk rows for Supabase insertion
    const chunkRows = chunks.map((chunk, index) => ({
      document_id: documentId,
      project_id: projectId,
      content: chunk.content,
      metadata: chunk.metadata,
      embedding: rawEmbeddings[index],
    }));
    // --- END SURGICAL PATCH ---

    // 7. Stage 2 Update (Bulk Insert Chunks & Mark Indexed)
    // Clean up any existing chunks for this document
    await adminClient
      .from("document_chunks")
      .delete()
      .eq("document_id", documentId)

    const { error: chunkInsertErr } = await adminClient
      .from("document_chunks")
      .insert(chunkRows)

    if (chunkInsertErr) {
      throw new Error(
        `Failed to insert document chunks: ${chunkInsertErr.message}`
      )
    }

    // Update document status to 'indexed'
    await adminClient
      .from("documents")
      .update({ status: "indexed" })
      .eq("id", documentId)

    clearTimeout(timeoutId)
    const durationMs = Date.now() - startTime

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        projectId,
        filename,
        chunksCount: chunks.length,
        suggestedQueries: suggestedQueriesArray,
        durationMs,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  } catch (err) {
    clearTimeout(timeoutId)
    console.error("Ingestion pipeline failure:", err)

    // 8. Failure Handling: Mark the record as failed
    if (documentId) {
      await adminClient
        .from("documents")
        .update({ status: "failed" })
        .eq("id", documentId)
    }

    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
