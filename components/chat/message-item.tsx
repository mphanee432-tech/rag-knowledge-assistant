"use client"

import * as React from "react"
import { useState } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Bot, User, Check, Copy, AlertCircle, FileText } from "lucide-react"
import { CitationBadge } from "@/components/chat/citation-badge"
import { splitCitations } from "@/lib/citations"
import { isNoEvidenceAnswer, normalizePersonalRefusal } from "@/lib/chat-contract"
import { MessageActions } from "@/components/chat/message-actions"
import type { ChatMessage, Citation } from "@/lib/store/chat-store"

interface MessageItemProps {
  message: ChatMessage
  isStreaming?: boolean
}

const REFUSAL_PREFIX = "I couldn't find evidence in this project's documents"

export function MessageItem({ message, isStreaming = false }: MessageItemProps) {
  const isUser = message.role === "user"
  const displayContent = !isUser && !isStreaming && !message.content.trim()
    ? "Error: The answer could not be completed. Please retry."
    : !isUser ? normalizePersonalRefusal(message.content) : message.content
  const isError = !isUser && /^Error:/i.test(displayContent.trim())
  const isRefusal = !isError && (displayContent.includes(REFUSAL_PREFIX) || isNoEvidenceAnswer(displayContent))
  const citations = isRefusal ? [] : (message.citations || [])

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
        className={`flex min-w-0 flex-col max-w-[85%] md:max-w-[75%] gap-2 ${
          isUser
            ? "items-end"
            : "items-start"
        }`}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
            isUser
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-br-xs"
              : isError
              ? "bg-red-500/10 border border-red-500/25 text-red-700 dark:text-red-300 rounded-bl-xs w-full"
              : isRefusal
              ? "bg-amber-500/10 border border-amber-500/20 text-zinc-800 dark:text-zinc-200 rounded-bl-xs w-full"
              : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-xs w-full"
          }`}
        >
          {isError && (
            <div className="flex items-center gap-2 mb-1.5 font-medium text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>Response Error</span>
            </div>
          )}
          {isRefusal && (
            <div className="flex items-center gap-2 mb-2 font-medium text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-4" />
              <span>Grounded Retrieval Refusal</span>
            </div>
          )}

          {/* Render formatted message content */}
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
            <FormattedContent
              content={displayContent}
              citations={citations}
            />
          </div>

          {/* Citation Tray if citations exist */}
          {!isUser && !isStreaming && citations.length > 0 && (
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
          {!isUser && !isStreaming && !isError && (
            <MessageActions
              interactionId={message.interactionId}
              content={displayContent}
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
}: {
  content: string
  citations: Citation[]
}) {
  const components = React.useMemo<Components>(() => ({
      span({ node, children }) {
        const indices = node?.properties.dataCitationIndices
        if (!Array.isArray(indices)) return <span>{children}</span>
        return <>{indices.map((value, position) => {
          const index = Number(value)
          const citation = citations.find(c => c.index === index && c.id.trim().length > 0)
          return citation ? <CitationBadge key={position} citation={citation} index={index - 1} /> : <span key={position}>[Unverified citation {index}]</span>
        })}</>
      },
      p: ({ children }) => <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>,
      h1: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>,
      h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
      h3: ({ children }) => <h4 className="mb-1 mt-3 font-semibold">{children}</h4>,
      ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children, start }) => <ol start={start} className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
      blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 dark:border-zinc-600">{children}</blockquote>,
      a: ({ children, href }) => <a href={href} className="text-primary underline underline-offset-2">{children}</a>,
      img: ({ alt }) => <span>{alt || "[Image]"}</span>,
      code: ({ children, className }) => <code className={`rounded bg-zinc-100 px-1 font-mono text-[0.9em] dark:bg-zinc-800 ${className || ""}`}>{children}</code>,
      pre({ children }) {
        const code = React.Children.toArray(children)[0]
        if (!React.isValidElement<{ children?: React.ReactNode; className?: string }>(code) || typeof code.props.children !== "string") {
          return <pre>{children}</pre>
        }
        return <CodeBlock code={code.props.children.replace(/\n$/, "")} language={code.props.className?.replace(/^language-/, "")} />
      },
      table: ({ children }) => <div role="region" aria-label="Answer table" tabIndex={0} className="my-3 max-w-full overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-primary dark:border-zinc-700">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>,
      thead: ({ children }) => <thead className="bg-zinc-100 dark:bg-zinc-800">{children}</thead>,
      th: ({ children, style }) => <th scope="col" style={style} className="border-b border-zinc-200 px-3 py-2 font-semibold dark:border-zinc-700">{children}</th>,
      td: ({ children, style }) => <td style={style} className="border-b border-zinc-200 px-3 py-2 align-top dark:border-zinc-700">{children}</td>,
    }), [citations])
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeCitations]} skipHtml components={components}>{content}</Markdown>
  )
}

interface MarkdownNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: MarkdownNode[]
}

function rehypeCitations() {
  return function transform(node: MarkdownNode) {
    // Literal code and link labels must not gain nested interactive buttons.
    if (!node.children || ["pre", "code", "a"].includes(node.tagName || "")) return
    node.children = node.children.flatMap(child => {
      if (child.type === "text" && child.value) {
        return splitCitations(child.value).map(part => part.indices ? {
          type: "element", tagName: "span", properties: { dataCitationIndices: part.indices },
          children: [{ type: "text", value: part.text }],
        } : { ...child, value: part.text })
      }
      transform(child)
      return [child]
    })
  }
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
