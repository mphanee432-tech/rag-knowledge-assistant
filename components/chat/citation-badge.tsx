"use client"

import * as React from "react"
import { useState } from "react"
import { FileText, Table, Hash, ExternalLink, X, Copy, Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Citation } from "@/lib/store/chat-store"

interface CitationBadgeProps {
  citation: Citation
  index?: number
}

export function CitationBadge({ citation, index }: CitationBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const meta = citation.metadata || {}
  const isTabular = Boolean(meta.is_tabular)
  const parentHeaders = Array.isArray(meta.parent_headers) ? meta.parent_headers : []
  const filename = (meta.filename as string) || "Document"

  const handleCopy = () => {
    navigator.clipboard.writeText(citation.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <span className="relative inline-block my-0.5 mx-1 align-middle">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono font-medium rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 transition-colors shadow-xs cursor-pointer select-none"
        title="Click to view verified source chunk evidence"
      >
        <FileText className="size-3 text-primary shrink-0" />
        <span>
          {meta.filename ? `${String(meta.filename).slice(0, 15)}...` : `Chunk #${index !== undefined ? index + 1 : citation.id.slice(0, 6)}`}
        </span>
        {isTabular && <Table className="size-3 text-amber-500 shrink-0" />}
      </button>

      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 z-50 w-80 sm:w-96 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl text-left text-xs text-zinc-900 dark:text-zinc-100 animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
              <FileText className="size-4 text-primary" />
              <span>Verified Source Chunk</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleCopy}
                title="Copy chunk content"
                className="size-6 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setIsOpen(false)}
                className="size-6 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Metadata tags */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            <Badge variant="outline" className="text-[10px] font-mono">
              <Hash className="size-2.5 mr-0.5" />
              {citation.id.slice(0, 8)}
            </Badge>

            {isTabular && (
              <Badge variant="warning" className="text-[10px]">
                <Table className="size-2.5 mr-1" />
                Atomic Table
              </Badge>
            )}

            {meta.page && (
              <Badge variant="secondary" className="text-[10px]">
                Page {String(meta.page)}
              </Badge>
            )}

            {meta.dom_path && (
              <Badge variant="outline" className="text-[10px] font-mono truncate max-w-[150px]">
                {String(meta.dom_path)}
              </Badge>
            )}
          </div>

          {/* Hierarchy breadcrumbs */}
          {parentHeaders.length > 0 && (
            <div className="mb-2 p-1.5 rounded-md bg-zinc-50 dark:bg-zinc-800/60 font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
              <span className="font-semibold text-zinc-500">Headers: </span>
              {parentHeaders.join(" > ")}
            </div>
          )}

          {/* Chunk Content Snippet */}
          <div className="max-h-48 overflow-y-auto p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
            {citation.content}
          </div>
        </div>
      )}
    </span>
  )
}
