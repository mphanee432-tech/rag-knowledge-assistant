import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { ProjectWorkspaceClient } from "@/components/chat/project-workspace-client"

interface ProjectPageProps {
  params: Promise<{ id: string }> | { id: string }
}

export default async function ProjectWorkspacePage({ params }: ProjectPageProps) {
  const resolvedParams = await Promise.resolve(params)
  const id = resolvedParams?.id

  if (!id) {
    notFound()
  }

  const supabase = await createClient()
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .single()

  if (error || !project) {
    notFound()
  }

  return (
    <ProjectWorkspaceClient
      projectId={project.id}
      projectName={project.name}
    />
  )
}
