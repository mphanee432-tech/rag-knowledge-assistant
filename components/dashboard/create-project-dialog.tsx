"use client"

import * as React from "react"
import { useState, useTransition } from "react"
import { Plus, Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createProject } from "@/app/actions/projects"

interface CreateProjectDialogProps {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateProjectDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: CreateProjectDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? setControlledOpen! : setInternalOpen

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName("")
      setError(null)
    }
    setOpen(newOpen)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()

    if (trimmed.length < 1) {
      setError("Project name cannot be empty.")
      return
    }

    if (trimmed.length > 60) {
      setError("Project name must not exceed 60 characters.")
      return
    }

    setError(null)
    startTransition(async () => {
      try {
        await createProject(trimmed)
      } catch (err) {
        // Next.js redirect throws a NEXT_REDIRECT digest error, do not catch that as an error
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: string }).digest).startsWith("NEXT_REDIRECT")) {
          throw err
        }
        setError(err instanceof Error ? err.message : "Failed to create project.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5 shadow-xs cursor-pointer">
            <Plus className="size-4" />
            <span>Create Project</span>
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-2">
              <Sparkles className="size-5" />
            </div>
            <DialogTitle>Create New Workspace</DialogTitle>
            <DialogDescription>
              Assign a name to your new technical knowledge base. Each workspace maintains isolated documents, embeddings, and chat sessions.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-2">
            <label
              htmlFor="project-name"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block"
            >
              Workspace Name
            </label>
            <Input
              id="project-name"
              autoFocus
              placeholder="e.g. Payments Gateway RFCs"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              disabled={isPending}
              maxLength={60}
              className="text-sm"
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
              <span>Must be 1–60 characters</span>
              <span className={name.trim().length > 55 ? "text-amber-500 font-mono" : "font-mono"}>
                {name.trim().length}/60
              </span>
            </div>

            {error && (
              <p className="text-xs text-rose-500 font-medium pt-1">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || name.trim().length === 0}
              className="gap-1.5"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Creating Workspace...</span>
                </>
              ) : (
                <>
                  <Plus className="size-3.5" />
                  <span>Create Project</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
