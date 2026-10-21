"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  FileText,
  Trash2,
  Layers,
  CheckCircle2,
  Clock,
  ArrowLeft,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useChatStore, type DocumentItem } from "@/lib/store/chat-store"
import { DocumentUploader } from "@/components/upload/document-uploader"

interface SidebarProps {
  onSelectSuggestion?: (query: string) => void
  projectId?: string
  projectName?: string | null
}

export function Sidebar({ projectId, projectName }: SidebarProps) {
  const router = useRouter()
  const {
    activeProjectId,
    setActiveProject,
    documents,
    setDocuments,
    setSuggestedQueries,
  } = useChatStore()

  const effectiveProjectId = projectId || activeProjectId

  const [projects, setProjects] = useState<Array<{ id: string; name?: string; created_at: string }>>([])

  // Sync route projectId into store
  useEffect(() => {
    if (projectId && activeProjectId !== projectId) {
      setActiveProject(projectId)
    }
  }, [projectId, activeProjectId, setActiveProject])

  // Fetch projects on mount for workspace switcher
  useEffect(() => {
    fetchProjects()
  }, [])

  // Fetch documents when effectiveProjectId changes
  useEffect(() => {
    if (effectiveProjectId) {
      fetchDocuments(effectiveProjectId)
    }
  }, [effectiveProjectId])

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects")
      const data = await res.json()
      if (data.projects && data.projects.length > 0) {
        setProjects(data.projects)
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err)
    }
  }

  const fetchDocuments = async (projId: string) => {
    try {
      const [docRes, projRes] = await Promise.all([
        fetch(`/api/documents?projectId=${projId}`),
        fetch(`/api/projects?id=${projId}`),
      ])
      const docData = await docRes.json()
      if (docData.documents) {
        setDocuments(docData.documents)
      }
      const projData = await projRes.json()
      if (projData.project?.suggested_queries && Array.isArray(projData.project.suggested_queries)) {
        setSuggestedQueries(projData.project.suggested_queries)
      }
    } catch (err) {
      console.error("Failed to fetch documents or project details:", err)
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    if (!effectiveProjectId) return
    try {
      await fetch(`/api/documents?documentId=${documentId}`, {
        method: "DELETE",
      })
      await fetchDocuments(effectiveProjectId)
    } catch (err) {
      console.error("Failed to delete document:", err)
    }
  }

  const activeDocCount = documents.filter((d) => d.status !== "failed").length
  const quotaPercent = Math.min((activeDocCount / 10) * 100, 100)

  return (
    <aside className="w-80 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50 flex flex-col h-full shrink-0">
      {/* Workspace Header */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
            title="Return to Dashboard"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="size-8 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center font-bold text-xs shadow-xs">
            RAG
          </div>
          <div>
            <h2 className="font-semibold text-xs tracking-tight text-zinc-900 dark:text-zinc-100">
              Knowledge Assistant
            </h2>
          </div>
        </div>
      </div>

      {/* Project Switcher */}
      {projects.length > 1 && (
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
            <Layers className="size-3.5" />
            <span className="font-medium">Workspace:</span>
          </div>
          <select
            value={effectiveProjectId || ""}
            onChange={(e) => {
              if (e.target.value) {
                setActiveProject(e.target.value)
                router.push(`/project/${e.target.value}`)
              }
            }}
            className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 text-[11px] font-mono max-w-[150px] text-ellipsis"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Document Quota Indicator */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800/60 bg-zinc-100/40 dark:bg-zinc-900/30">
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Document Quota
          </span>
          <span className="font-mono text-zinc-500">
            {activeDocCount} / 10 files
          </span>
        </div>
        <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              activeDocCount >= 10
                ? "bg-rose-500"
                : activeDocCount >= 8
                ? "bg-amber-500"
                : "bg-primary"
            }`}
            style={{ width: `${quotaPercent}%` }}
          />
        </div>
      </div>

      {/* Indexed Document List */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1">
          <span>Sources</span>
          <span>{documents.length}</span>
        </div>

        {documents.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center flex flex-col items-center justify-center my-4">
            <FileText className="size-6 text-zinc-300 dark:text-zinc-700 mb-2" />
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              No documents uploaded
            </p>
            <p className="text-[10px] text-zinc-500 mt-1 max-w-[180px]">
              Upload RFCs, logs, or specs (.pdf, .txt, .html up to 25MB)
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {documents.map((doc) => {
              const filename = doc.storage_path.split("/").pop() || "document"
              return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xs text-xs group"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-1">
                    <FileText className="size-3.5 text-zinc-400 shrink-0" />
                    <span
                      className="truncate font-medium text-zinc-800 dark:text-zinc-200 text-[11px]"
                      title={filename}
                    >
                      {filename}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <StatusChip status={doc.status} />
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(doc.id)}
                      className={`${doc.status === "failed" ? "opacity-100 text-rose-500" : "opacity-0 group-hover:opacity-100 text-zinc-400"} hover:text-rose-600 p-0.5 rounded transition-all cursor-pointer`}
                      title="Delete document"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Direct-to-Storage Upload Dropzone */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40">
        <DocumentUploader
          projectId={effectiveProjectId || ""}
          currentDocCount={activeDocCount}
          onUploadSuccess={() => {
            if (effectiveProjectId) {
              fetchDocuments(effectiveProjectId)
            }
          }}
        />
      </div>
    </aside>
  )
}

function StatusChip({ status }: { status: DocumentItem["status"] }) {
  switch (status) {
    case "indexed":
      return (
        <Badge variant="success" className="text-[9px] px-1.5 py-0 h-4">
          <CheckCircle2 className="size-2.5 mr-0.5" />
          Indexed
        </Badge>
      )
    case "processing":
    case "uploaded":
    case "pending_upload":
      return (
        <Badge variant="processing" className="text-[9px] px-1.5 py-0 h-4">
          <Clock className="size-2.5 mr-0.5" />
          Processing
        </Badge>
      )
    case "failed":
      return (
        <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">
          Failed
        </Badge>
      )
    default:
      return null
  }
}
