"use client"

import * as React from "react"
import { useState } from "react"
import { Bot, User, Check, Copy, AlertCircle, FileText } from "lucide-react"
import { CitationBadge } from "@/components/chat/citation-badge"
import { MessageActions } from "@/components/chat/message-actions"
import type { ChatMessage, Citation } from "@/lib/store/chat-store"

interface MessageItemProps {
  message: ChatMessage
  isStreaming?: boolean
}

const REFUSAL_PREFIX = "I couldn't find enough evidence in this project's uploaded documents"

export function MessageItem({ message, isStreaming = false }: MessageItemProps) {
  const isUser = message.role === "user"
  const isRefusal = message.content.includes(REFUSAL_PREFIX)
  const citations = message.citations || []

  // Map chunk IDs to citation objects for inline replacement
  const citationMap = new Map<string, Citation>()
  citations.forEach((c) => {
    citationMap.set(c.id, c)
  })

  return (
    <div
      className={`flex w-full gap-3 py-4 ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      {!isUser && (
        <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5 text-primary">
          <Bot className="size-4" />
        </div>
      )}

      <div
        className={`flex flex-col max-w-[85%] md:max-w-[75%] gap-2 ${
          isUser
            ? "items-end"
            : "items-start"
        }`}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
            isUser
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-br-xs"
              : isRefusal
              ? "bg-amber-500/10 border border-amber-500/20 text-zinc-800 dark:text-zinc-200 rounded-bl-xs w-full"
              : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-xs w-full"
          }`}
        >
          {isRefusal && (
            <div className="flex items-center gap-2 mb-2 font-medium text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-4" />
              <span>Grounded Retrieval Refusal</span>
            </div>
          )}

          {/* Render formatted message content */}
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
            <FormattedContent
              content={message.content}
              citations={citations}
              citationMap={citationMap}
            />
          </div>

          {/* Citation Tray if citations exist */}
          {!isUser && citations.length > 0 && (
            <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1">
                <FileText className="size-3" />
                Sources:
              </span>
              {citations.map((c, i) => (
                <CitationBadge key={c.id || i} citation={c} index={i} />
              ))}
            </div>
          )}

          {/* Assistant message actions directly below content */}
          {!isUser && !isStreaming && (
            <MessageActions
              interactionId={message.interactionId}
              content={message.content}
            />
          )}
        </div>
      </div>

      {isUser && (
        <div className="size-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5 text-zinc-700 dark:text-zinc-300">
          <User className="size-4" />
        </div>
      )}
    </div>
  )
}

function FormattedContent({
  content,
  citations,
  citationMap,
}: {
  content: string
  citations: Citation[]
  citationMap: Map<string, Citation>
}) {
  // Regex parsing for code blocks and inline citations
  // Match markdown code blocks: ```lang\ncode\n```
  const parts = content.split(/(```[\s\S]*?```)/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.slice(3, -3).trim().split("\n")
          const language = lines[0].trim()
          const code = (lines.length > 1 ? lines.slice(1).join("\n") : lines[0]).trim()

          return <CodeBlock key={index} code={code} language={language} />
        }

        // Parse inline citations in text: [Doc Chunk: <id>]
        const subParts = part.split(/(\[Doc Chunk:\s*[^\]]+\])/gi)

        return (
          <span key={index} className="whitespace-pre-wrap">
            {subParts.map((sub, sIdx) => {
              const match = sub.match(/\[Doc Chunk:\s*([^\]]+)\]/i)
              if (match) {
                const chunkId = match[1].trim()
                const foundCitation =
                  citationMap.get(chunkId) ||
                  citations.find((c) => c.id.includes(chunkId)) || {
                    id: chunkId,
                    content: `Verified chunk ${chunkId}`,
                    metadata: {},
                  }

                return (
                  <CitationBadge
                    key={sIdx}
                    citation={foundCitation}
                  />
                )
              }
              return sub
            })}
          </span>
        )
      })}
    </>
  )
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 font-mono text-[11px] text-zinc-400">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-zinc-100 cursor-pointer transition-colors"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto font-mono text-[12px] leading-relaxed select-text">
        <pre>{code}</pre>
      </div>
    </div>
  )
}
