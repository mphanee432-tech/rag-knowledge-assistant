import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "edge"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get("projectId")

  if (!projectId) {
    return new Response(JSON.stringify({ error: "projectId parameter is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("documents")
    .select("id, project_id, storage_path, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(JSON.stringify({ documents: data || [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const documentId = searchParams.get("documentId")

  if (!documentId) {
    return new Response(JSON.stringify({ error: "documentId parameter is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from("documents").delete().eq("id", documentId)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
