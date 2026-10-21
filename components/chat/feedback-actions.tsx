"use client"

import * as React from "react"
import { useState } from "react"
import { ThumbsUp, ThumbsDown, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface FeedbackActionsProps {
  interactionId?: string
  className?: string
}

const ISSUE_TAGS = [
  "Inaccurate",
  "Missing Context",
  "Too Long",
  "Code Error",
  "Hallucination",
]

export function FeedbackActions({ interactionId, className = "" }: FeedbackActionsProps) {
  const [rating, setRating] = useState<"thumbs_up" | "thumbs_down" | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  if (!interactionId) {
    return null
  }

  const submitFeedback = async (
    newRating: "thumbs_up" | "thumbs_down",
    tag?: string | null,
    userComment?: string
  ) => {
    setIsSubmitting(true)
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionId,
          rating: newRating,
          issueTag: tag || undefined,
          comment: userComment || undefined,
        }),
      })
      setRating(newRating)
      setSubmitted(true)
      setShowTagPicker(false)
    } catch (err) {
      console.error("Failed to submit feedback:", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleThumbsUp = () => {
    if (rating === "thumbs_up") return
    submitFeedback("thumbs_up")
  }

  const handleThumbsDown = () => {
    if (rating === "thumbs_down") {
      setShowTagPicker(!showTagPicker)
      return
    }
    setShowTagPicker(true)
  }

  const handleTagSubmit = (tag: string) => {
    setSelectedTag(tag)
    submitFeedback("thumbs_down", tag, comment)
  }

  return (
    <div className={`relative flex flex-col gap-1.5 text-xs text-zinc-500 ${className}`}>
      <div className="flex items-center gap-1.5">
        {submitted ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            <Check className="size-3" />
            Feedback recorded
          </span>
        ) : (
          <>
            <span className="text-[11px] text-zinc-400">Helpful?</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleThumbsUp}
              disabled={isSubmitting}
              className={`size-6 rounded-md hover:text-emerald-600 dark:hover:text-emerald-400 ${
                rating === "thumbs_up" ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40" : ""
              }`}
              title="Accurate and helpful"
            >
              {isSubmitting && rating === "thumbs_up" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ThumbsUp className="size-3" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleThumbsDown}
              disabled={isSubmitting}
              className={`size-6 rounded-md hover:text-rose-600 dark:hover:text-rose-400 ${
                rating === "thumbs_down" ? "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40" : ""
              }`}
              title="Inaccurate or issues detected"
            >
              {isSubmitting && rating === "thumbs_down" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ThumbsDown className="size-3" />
              )}
            </Button>
          </>
        )}
      </div>

      {showTagPicker && !submitted && (
        <div className="mt-1 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-md flex flex-col gap-2 max-w-xs animate-in fade-in-0">
          <p className="font-medium text-[11px] text-zinc-700 dark:text-zinc-300">
            What went wrong with this answer?
          </p>
          <div className="flex flex-wrap gap-1">
            {ISSUE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleTagSubmit(tag)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                  selectedTag === tag
                    ? "bg-rose-500 text-white border-rose-500"
                    : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
