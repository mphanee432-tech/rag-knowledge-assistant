"use client"

import * as React from "react"
import { useRef, useEffect } from "react"
import {
  RotateCcw,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChatMessages } from "@/components/chat/chat-messages"
import { ChatInput } from "@/components/chat/chat-input"
import { ThemeToggle } from "@/components/theme-toggle"
import { DocumentUploader } from "@/components/upload/document-uploader"
import { useChatStore, type ChatMessage, type Citation } from "@/lib/store/chat-store"

interface ChatContainerProps {
  onSuggestedQuery?: (query: string) => void
  projectId?: string
  projectName?: string | null
}

export function ChatContainer({
  onSuggestedQuery,
  projectId,
  projectName,
}: ChatContainerProps) {
  const {
    messages,
    activeProjectId,
    isLoading,
    statusMessage,
    documents,
    suggestedQueries,
    addMessage,
    updateLastMessage,
    setIsLoading,
    setStatusMessage,
    clearChat,
  } = useChatStore()

  const effectiveProjectId = projectId || activeProjectId

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new messages or streaming chunks
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, statusMessage])

  const handleSendMessage = async (queryText: string) => {
    if (!queryText.trim() || isLoading) return

    const userMessageId = crypto.randomUUID()
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: queryText,
    }

    // Append user message (bounded 5-turn sliding window automatically enforced by store)
    addMessage(userMsg)

    const assistantMessageId = crypto.randomUUID()
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      citations: [],
    }

    addMessage(assistantPlaceholder)
    setIsLoading(true)
    setStatusMessage("Searching repository sources...")

    try {
      // Progressive pipeline feedback
      const timer1 = setTimeout(() => {
        setStatusMessage("Executing Hybrid Reciprocal Rank Fusion...")
      }, 700)

      const timer2 = setTimeout(() => {
        setStatusMessage("Synthesizing verified code & citations...")
      }, 1500)

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: effectiveProjectId,
          query: queryText,
          messages: messages.slice(-10), // Send last 10 turns
        }),
      })

      clearTimeout(timer1)
      clearTimeout(timer2)

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || `HTTP error ${response.status}`)
      }

      // Extract custom metadata headers
      const interactionId = response.headers.get("x-interaction-id") || undefined
      let parsedCitations: Citation[] = []
      const rawCitationsHeader = response.headers.get("x-citations")
      if (rawCitationsHeader) {
        try {
          parsedCitations = JSON.parse(decodeURIComponent(rawCitationsHeader))
        } catch (e) {
          console.warn("Failed to parse x-citations header:", e)
        }
      }

      // Stream response tokens
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("Response body is not readable")
      }

      const decoder = new TextDecoder()
      let accumulatedText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunkText = decoder.decode(value, { stream: true })
        accumulatedText += chunkText
        updateLastMessage(accumulatedText, parsedCitations, interactionId)
      }

      // Final update
      updateLastMessage(accumulatedText, parsedCitations, interactionId)
    } catch (err) {
      console.error("Chat streaming error:", err)
      const errorMsg =
        err instanceof Error
          ? `Error: ${err.message}`
          : "An error occurred while streaming response. Please verify network connectivity."
      updateLastMessage(errorMsg)
    } finally {
      setIsLoading(false)
      setStatusMessage(null)
    }
  }

  const activeDocCount = documents.filter((d) => d.status !== "failed").length

  return (
    <main className="flex-1 flex flex-col h-full bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {projectName || "Untitled Project"}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={clearChat}
              className="text-xs h-7 gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
            >
              <RotateCcw className="size-3" />
              <span>Clear Session</span>
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* 0 Documents State (Hard Lock) */}
      {activeDocCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center text-center">
            <div className="size-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mb-4 shadow-xs">
              <Lock className="size-8" />
            </div>

            <Badge
              variant="outline"
              className="px-3 py-1 text-xs font-medium gap-1.5 border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 mb-3"
            >
              <Lock className="size-3 text-amber-500" />
              <span>Workspace Locked • 0 Documents</span>
            </Badge>

            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mb-2">
              Upload a document in the sidebar to unlock the workspace.
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto mb-6 leading-relaxed">
              Upload at least one engineering document, API contract, or error log to provide grounded answers with citations.
            </p>

            {/* Prominent Large Drag-and-Drop Zone */}
            <DocumentUploader
              projectId={effectiveProjectId || ""}
              largeDropzone={true}
              customInstruction="Upload a document in the sidebar to unlock the workspace."
              className="w-full"
            />
          </div>
        </div>
      ) : (
        <>
          {/* Messages Thread Container */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 flex flex-col gap-2">
            {messages.length === 0 ? (
              <div className="flex-1" />
            ) : (
              <ChatMessages
                messages={messages}
                isLoading={isLoading}
                messagesEndRef={messagesEndRef}
              />
            )}
          </div>

          {/* Bottom Input Area */}
          <footer className="p-4 md:px-8 max-w-3xl w-full mx-auto border-t border-zinc-100 dark:border-zinc-800/60 bg-white dark:bg-zinc-950 shrink-0">
            <ChatInput
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              statusMessage={statusMessage}
              disabled={!effectiveProjectId}
              suggestedQueries={suggestedQueries}
              showSuggestions={messages.length === 0}
            />
          </footer>
        </>
      )}
    </main>
  )
}
