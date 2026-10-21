"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { Plus, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CreateProjectButton({
  size = "default",
  className,
  label = "Create Project",
}: {
  size?: "default" | "xs" | "sm" | "lg"
  className?: string
  label?: string
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      size={size}
      disabled={pending}
      className={className}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          <span>Creating Workspace...</span>
        </>
      ) : (
        <>
          <Plus className="size-4" />
          <span>{label}</span>
        </>
      )}
    </Button>
  )
}
