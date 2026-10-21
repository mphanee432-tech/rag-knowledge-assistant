"use client"

import * as React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Layers,
  FileText,
  Calendar,
  MoreVertical,
  Pencil,
  Trash2,
  ArrowRight,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { renameProject, deleteProject } from "@/app/actions/projects"

export interface ProjectCardData {
  id: string
  name?: string | null
  user_id: string
  created_at: string
  documentsCount?: number
}

interface ProjectCardProps {
  project: ProjectCardData
}

export function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter()
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(project.name || "Untitled Project")
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isRenaming, startRenameTransition] = useTransition()
  const [isDeleting, startDeleteTransition] = useTransition()

  const displayName = project.name?.trim() || "Untitled Project"
  const docCount = project.documentsCount ?? 0

  const formattedDate = new Date(project.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  const handleCardClick = () => {
    router.push(`/project/${project.id}`)
  }

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = renameValue.trim()
    if (!trimmed) {
      setRenameError("Workspace name cannot be empty.")
      return
    }
    if (trimmed.length > 60) {
      setRenameError("Workspace name must not exceed 60 characters.")
      return
    }

    setRenameError(null)
    startRenameTransition(async () => {
      try {
        await renameProject(project.id, trimmed)
        setIsRenameOpen(false)
      } catch (err) {
        setRenameError(err instanceof Error ? err.message : "Failed to rename project.")
      }
    })
  }

  const handleDeleteConfirm = () => {
    startDeleteTransition(async () => {
      try {
        await deleteProject(project.id)
        setIsDeleteOpen(false)
      } catch (err) {
        console.error("Delete project error:", err)
      }
    })
  }

  return (
    <>
      <div
        onClick={handleCardClick}
        className="group relative flex flex-col p-5 rounded-2xl border border-border bg-card hover:bg-accent/40 hover:border-primary/40 transition-all duration-200 shadow-2xs hover:shadow-md cursor-pointer"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
            <Layers className="size-5" />
          </div>

          <div
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Badge variant="outline" className="text-[10px] font-mono gap-1">
              <FileText className="size-2.5 text-blue-500" />
              <span>{docCount} {docCount === 1 ? "doc" : "docs"}</span>
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label="Workspace options"
                >
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={() => {
                    setRenameValue(displayName)
                    setRenameError(null)
                    setIsRenameOpen(true)
                  }}
                  className="gap-2 cursor-pointer text-xs"
                >
                  <Pencil className="size-3.5 text-zinc-500" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setIsDeleteOpen(true)}
                  className="gap-2 text-rose-600 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40 cursor-pointer text-xs"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex-1">
          <h3 className="font-semibold text-sm text-foreground tracking-tight group-hover:text-primary transition-colors truncate">
            {displayName}
          </h3>
        </div>

        <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Calendar className="size-3 text-muted-foreground/70" />
            <span>{formattedDate}</span>
          </div>

          <span className="inline-flex items-center gap-1 font-medium text-primary text-[11px] group-hover:translate-x-0.5 transition-transform">
            Open <ArrowRight className="size-3" />
          </span>
        </div>
      </div>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent
          className="sm:max-w-[420px]"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>Rename Workspace</DialogTitle>
              <DialogDescription>
                Provide a new title for this workspace. Changes will immediately update all dashboard links.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-2">
              <label
                htmlFor="rename-input"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block"
              >
                Workspace Name
              </label>
              <Input
                id="rename-input"
                autoFocus
                value={renameValue}
                onChange={(e) => {
                  setRenameValue(e.target.value)
                  if (renameError) setRenameError(null)
                }}
                disabled={isRenaming}
                maxLength={60}
                className="text-sm"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span>Must be 1–60 characters</span>
                <span className="font-mono">{renameValue.trim().length}/60</span>
              </div>
              {renameError && (
                <p className="text-xs text-rose-500 font-medium pt-1">
                  {renameError}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRenameOpen(false)}
                disabled={isRenaming}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isRenaming || renameValue.trim().length === 0}
              >
                {isRenaming ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent
          className="sm:max-w-[440px]"
          onClick={(e) => e.stopPropagation()}
        >
          <AlertDialogHeader>
            <div className="size-10 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-center justify-center text-rose-600 mb-2">
              <AlertTriangle className="size-5" />
            </div>
            <AlertDialogTitle>Delete Workspace?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              This will permanently delete <strong className="text-foreground">{displayName}</strong> and all {docCount} indexed document{docCount === 1 ? "" : "s"}, vector embeddings, and storage payloads. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={isDeleting} size="sm">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDeleteConfirm()
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              size="sm"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <span>Permanently Delete</span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
