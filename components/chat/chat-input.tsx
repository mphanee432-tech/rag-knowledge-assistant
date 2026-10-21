"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { ArrowUp, Loader2, Sparkles, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface ChatInputProps {
  onSendMessage: (query: string) => Promise<void>
  isLoading: boolean
  statusMessage: string | null
  disabled?: boolean
  suggestedQueries?: string[]
  showSuggestions?: boolean
}

export function ChatInput({
  onSendMessage,
  isLoading,
  statusMessage,
  disabled = false,
  suggestedQueries = [],
  showSuggestions = false,
}: ChatInputProps) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const maxChars = 2500
  const charCount = input.length
  const isOverLimit = charCount > maxChars
  const canSubmit = input.trim().length > 0 && !isOverLimit && !isLoading && !disabled

  // Auto-resize textarea as user types or pastes multi-line error logs
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        240
      )}px`
    }
  }, [input])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!canSubmit) return

    const trimmed = input.trim()
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }

    await onSendMessage(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="w-full flex flex-col gap-2">
      {/* Progressive Pipeline Status Badge */}
      {isLoading && statusMessage && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/60 text-xs text-zinc-600 dark:text-zinc-300 animate-in fade-in-0 duration-300">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span className="font-medium">{statusMessage}</span>
        </div>
      )}

      {/* Dynamic Suggested Queries Chips above the chat input box */}
      {showSuggestions && suggestedQueries.length > 0 && !isLoading && (
        <div className="flex flex-col gap-1.5 mb-1 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
            <Sparkles className="size-3 text-primary shrink-0" />
            <span>Suggested Technical Starts</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestedQueries.map((query, idx) => (
              <button
                key={idx}
                type="button"
                onClick={async () => {
                  setInput(query)
                  if (textareaRef.current) {
                    textareaRef.current.style.height = "auto"
                  }
                  await onSendMessage(query)
                }}
                disabled={isLoading || disabled}
                className="text-xs text-left py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 hover:bg-zinc-100/90 dark:hover:bg-zinc-800 hover:border-primary/50 text-zinc-800 dark:text-zinc-200 transition-all shadow-2xs hover:shadow-xs cursor-pointer flex items-center gap-2 group disabled:opacity-50"
              >
                <Sparkles className="size-3 text-primary shrink-0 group-hover:scale-110 transition-transform" />
                <span className="line-clamp-2">{query}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Input Container */}
      <form
        onSubmit={handleSubmit}
        className={`relative flex flex-col rounded-2xl border bg-white dark:bg-zinc-900 shadow-sm transition-all ${
          isOverLimit
            ? "border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20"
            : "border-zinc-200 dark:border-zinc-800 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a technical question, or paste logs, RFCs, and stack traces (up to 2,500 chars)..."
          disabled={disabled || isLoading}
          rows={2}
          className="w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden disabled:opacity-50 font-sans"
        />

        {/* Action & Counter Bar */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-xs ${
                isOverLimit
                  ? "text-rose-500 font-semibold"
                  : charCount > 2000
                  ? "text-amber-500"
                  : "text-zinc-400"
              }`}
            >
              {charCount} / {maxChars}
            </span>
            {isOverLimit && (
              <span className="text-xs text-rose-500">Exceeds limit by {charCount - maxChars} chars</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSubmit}
              className="size-8 rounded-full shadow-xs cursor-pointer disabled:cursor-not-allowed transition-transform active:scale-95"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
