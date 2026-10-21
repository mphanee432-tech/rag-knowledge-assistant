"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function resolveUser() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let userId = user?.id

  // If no auth cookie session exists in local demo environment, resolve default user
  if (!userId) {
    const admin = createAdminClient()
    const { data: users } = await admin.auth.admin.listUsers()
    if (users && users.users.length > 0) {
      userId = users.users[0].id
    } else {
      const { data: newUser } = await admin.auth.admin.createUser({
        email: "engineer@internal.rag",
        password: "demo-password-1234!",
        email_confirm: true,
      })
      userId = newUser?.user?.id
    }
  }

  return { supabase, user, userId: userId! }
}

async function purgeProjectStorage(userId: string, projectId: string) {
  const admin = createAdminClient()
  const prefix = `${userId}/${projectId}`

  try {
    const { data: docFolders } = await admin.storage.from("documents").list(prefix)
    if (!docFolders || docFolders.length === 0) return

    const pathsToDelete: string[] = []
    for (const docFolder of docFolders) {
      const { data: files } = await admin.storage
        .from("documents")
        .list(`${prefix}/${docFolder.name}`)

      if (files && files.length > 0) {
        for (const file of files) {
          pathsToDelete.push(`${prefix}/${docFolder.name}/${file.name}`)
        }
      }
    }

    if (pathsToDelete.length > 0) {
      await admin.storage.from("documents").remove(pathsToDelete)
    }
  } catch (storageErr) {
    console.warn("Storage purge warning:", storageErr)
  }
}

export async function createProject(nameOrFormData?: string | FormData) {
  const { supabase, user, userId } = await resolveUser()

  let rawName = ""
  if (typeof nameOrFormData === "string") {
    rawName = nameOrFormData
  } else if (nameOrFormData instanceof FormData) {
    rawName = (nameOrFormData.get("name") as string) || ""
  }

  const trimmed = rawName.trim()
  const projectName = trimmed ? trimmed.slice(0, 60) : "Untitled Project"
  const projectId = crypto.randomUUID()

  if (user) {
    const { error } = await supabase.from("projects").insert([
      {
        id: projectId,
        user_id: userId,
        name: projectName,
      },
    ])
    if (error) {
      throw new Error(`Failed to create workspace: ${error.message}`)
    }
  } else {
    const admin = createAdminClient()
    const { error } = await admin.from("projects").insert([
      {
        id: projectId,
        user_id: userId,
        name: projectName,
      },
    ])
    if (error) {
      throw new Error(`Failed to create workspace: ${error.message}`)
    }
  }

  redirect(`/project/${projectId}`)
}

export const createProjectAction = createProject

export async function renameProject(projectId: string, newName: string) {
  const { supabase, user, userId } = await resolveUser()

  const trimmed = newName.trim()
  if (!trimmed || trimmed.length > 60) {
    throw new Error("Project name must be between 1 and 60 characters.")
  }

  if (user) {
    const { error } = await supabase
      .from("projects")
      .update({ name: trimmed })
      .eq("id", projectId)
      .eq("user_id", userId)

    if (error) {
      throw new Error(`Failed to rename workspace: ${error.message}`)
    }
  } else {
    const admin = createAdminClient()
    const { error } = await admin
      .from("projects")
      .update({ name: trimmed })
      .eq("id", projectId)
      .eq("user_id", userId)

    if (error) {
      throw new Error(`Failed to rename workspace: ${error.message}`)
    }
  }

  revalidatePath("/")
  return { success: true }
}

export async function deleteProject(projectId: string) {
  const { supabase, user, userId } = await resolveUser()

  if (user) {
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", userId)

    if (error) {
      throw new Error(`Failed to delete workspace: ${error.message}`)
    }
  } else {
    const admin = createAdminClient()
    const { error } = await admin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", userId)

    if (error) {
      throw new Error(`Failed to delete workspace: ${error.message}`)
    }
  }

  // Purge any associated files in Supabase Storage documents bucket under ${userId}/${projectId}/
  await purgeProjectStorage(userId, projectId)

  revalidatePath("/")
  return { success: true }
}
