import {
  Layers,
  FolderPlus,
  ShieldCheck,
  Database,
} from "lucide-react"
import { createServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CreateProjectDialog } from "@/components/dashboard/create-project-dialog"
import { ProjectCard, type ProjectCardData } from "@/components/dashboard/project-card"

interface RawProjectRecord {
  id: string
  name?: string | null
  user_id: string
  created_at: string
  documents?: Array<{ count: number }>
}

export default async function DashboardPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let rawProjects: RawProjectRecord[] = []

  if (user) {
    // SELECT id, name, user_id, created_at, documents(count) WHERE user_id = auth.uid()
    const { data } = await supabase
      .from("projects")
      .select("id, name, user_id, created_at, documents(count)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
    rawProjects = (data as unknown as RawProjectRecord[]) || []
  } else {
    // Graceful fallback for local development or demo sessions without active auth cookies
    const { data } = await supabase
      .from("projects")
      .select("id, name, user_id, created_at, documents(count)")
      .order("created_at", { ascending: false })

    if (data && data.length > 0) {
      rawProjects = data as unknown as RawProjectRecord[]
    } else {
      const admin = createAdminClient()
      const { data: users } = await admin.auth.admin.listUsers()
      if (users && users.users.length > 0) {
        const demoUser = users.users[0]
        const { data: demoProjects } = await admin
          .from("projects")
          .select("id, name, user_id, created_at, documents(count)")
          .eq("user_id", demoUser.id)
          .order("created_at", { ascending: false })
        if (demoProjects) {
          rawProjects = demoProjects as unknown as RawProjectRecord[]
        }
      }
    }
  }

  const projects: ProjectCardData[] = rawProjects.map((p) => ({
    id: p.id,
    name: p.name,
    user_id: p.user_id,
    created_at: p.created_at,
    documentsCount: p.documents?.[0]?.count ?? 0,
  }))

  const isEmpty = projects.length === 0

  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-foreground">
      {/* Navigation Header */}
      <header className="px-6 py-4 border-b border-border bg-card/60 backdrop-blur-sm flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-xs">
            RAG
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Knowledge Assistant Dashboard
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Tenant-Isolated Technical Vector Workspaces
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isEmpty && <CreateProjectDialog />}
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-6 md:p-12 max-w-6xl w-full mx-auto">
        {isEmpty ? (
          /* Empty State: Clean, centered layout with folder icon, descriptive text, and primary create button */
          <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-16">
            <div className="size-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-6 shadow-sm">
              <FolderPlus className="size-10" />
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
              No Workspaces Created
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mb-8 leading-relaxed">
              You haven&apos;t created any project workspaces yet. Launch an isolated workspace to upload RFCs, analyze error logs, and query technical specifications.
            </p>

            <CreateProjectDialog
              trigger={
                <Button size="lg" className="h-12 px-6 text-sm font-medium shadow-md gap-2 cursor-pointer">
                  <FolderPlus className="size-4" />
                  <span>Create Your First Project</span>
                </Button>
              }
            />

            <div className="mt-12 flex items-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-emerald-500" />
                <span>Strict Tenant Isolation</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Database className="size-3.5 text-blue-500" />
                <span>1536d Exact k-NN</span>
              </div>
            </div>
          </div>
        ) : (
          /* Populated State: Display a grid of previously created projects with links and options */
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  Your Workspaces
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select an active workspace to access chat synthesis, document retrieval, and uploads.
                </p>
              </div>
              <span className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                {projects.length} {projects.length === 1 ? "Workspace" : "Workspaces"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
