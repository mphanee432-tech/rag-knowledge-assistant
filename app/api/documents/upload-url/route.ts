import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "edge"

interface UploadUrlRequest {
  projectId: string
  filename: string
  fileSize?: number
  mimeType?: string
}

export async function POST(req: Request) {
  try {
    const body: UploadUrlRequest = await req.json()
    const { projectId, filename, fileSize } = body

    if (!projectId || !filename) {
      return new Response(
        JSON.stringify({ error: "projectId and filename are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // 25MB File limit check
    if (fileSize && fileSize > 25 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: "File exceeds maximum size limit of 25MB" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const supabase = createAdminClient()

    // Enforce 10-document limit at application layer
    const { count, error: countErr } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .neq("status", "failed")

    if (countErr) {
      console.error("Document count check error:", countErr)
    }

    if (count !== null && count >= 10) {
      return new Response(
        JSON.stringify({
          error: "Project document limit reached: maximum 10 documents allowed.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Pre-allocate document record with pending_upload status
    const documentId = crypto.randomUUID()
    // Fetch project's user_id for tenant directory pathing: {user_id}/{project_id}/{document_id}/{filename}
    const { data: project } = await supabase
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single()

    const userId = project?.user_id || "anonymous"
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${userId}/${projectId}/${documentId}/${sanitizedFilename}`

    const { error: insertErr } = await supabase.from("documents").insert([
      {
        id: documentId,
        project_id: projectId,
        storage_path: storagePath,
        status: "pending_upload",
      },
    ])

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Create signed upload URL from Supabase Storage
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from("documents")
      .createSignedUploadUrl(storagePath)

    if (uploadErr) {
      console.error("Storage signed upload URL creation error:", uploadErr)
      // Return storage path so client can also try direct upload with token if provisioned
      return new Response(
        JSON.stringify({
          documentId,
          storagePath,
          error: uploadErr.message,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({
        documentId,
        storagePath,
        signedUrl: uploadData?.signedUrl,
        token: uploadData?.token,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate upload URL", details: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
