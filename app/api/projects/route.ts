import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "edge"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get("id") || searchParams.get("projectId")
  const supabase = createAdminClient()

  if (projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, user_id, suggested_queries, created_at")
      .eq("id", projectId)
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ project: data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, user_id, suggested_queries, created_at")
    .order("created_at", { ascending: false })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(JSON.stringify({ projects: data || [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    // Retrieve or generate a project id
    const projectId = body.id || crypto.randomUUID()
    // For standalone edge runs without a strict session, use demo or provided user_id
    let userId = body.userId
    if (!userId) {
      // Fetch or create a default demo user from auth if needed
      const { data: users } = await supabase.auth.admin.listUsers()
      if (users && users.users.length > 0) {
        userId = users.users[0].id
      } else {
        const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
          email: "engineer@internal.rag",
          password: "demo-password-1234!",
          email_confirm: true,
        })
        if (createErr || !newUser?.user) {
          return new Response(JSON.stringify({ error: "Failed to initialize auth user context" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }
        userId = newUser.user.id
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .insert([{ id: projectId, user_id: userId }])
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ project: data }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
