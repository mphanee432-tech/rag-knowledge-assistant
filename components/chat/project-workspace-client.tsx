"use client"

import * as React from "react"
import { Sidebar } from "@/components/chat/sidebar"
import { ChatContainer } from "@/components/chat/chat-container"
import { useChatStore } from "@/lib/store/chat-store"

interface ProjectWorkspaceClientProps {
  projectId: string
  projectName?: string | null
}

export function ProjectWorkspaceClient({
  projectId,
  projectName,
}: ProjectWorkspaceClientProps) {
  const {
    addMessage,
    setIsLoading,
    setStatusMessage,
    updateLastMessage,
    messages,
    activeProjectId,
    setActiveProject,
    setDocuments,
    setSuggestedQueries,
    setIsDocumentsLoading,
  } = useChatStore()

  // Strictly wire the URL id parameter into the Zustand chat store on mount / param change and fetch workspace state
  React.useEffect(() => {
    if (projectId) {
      if (activeProjectId !== projectId) {
        setActiveProject(projectId)
      }

      const fetchWorkspaceData = async () => {
        setIsDocumentsLoading(true)
        try {
          const [docRes, projRes] = await Promise.all([
            fetch(`/api/documents?projectId=${projectId}`),
            fetch(`/api/projects?id=${projectId}`),
          ])

          if (docRes.ok) {
            const docData = await docRes.json()
            if (docData.documents) {
              setDocuments(docData.documents)
            }
          }

          if (projRes.ok) {
            const projData = await projRes.json()
            if (
              projData.project?.suggested_queries &&
              Array.isArray(projData.project.suggested_queries)
            ) {
              setSuggestedQueries(projData.project.suggested_queries)
            }
          }
        } catch (err) {
          console.warn("Failed to fetch project workspace data:", err)
        } finally {
          setIsDocumentsLoading(false)
        }
      }

      fetchWorkspaceData()
    }
  }, [
    projectId,
    activeProjectId,
    setActiveProject,
    setDocuments,
    setSuggestedQueries,
    setIsDocumentsLoading,
  ])

  const handleSelectSuggestion = async (query: string) => {
    // Dispatch query directly through the chat container flow with strict tenant isolation
    const userMessageId = crypto.randomUUID()
    addMessage({ id: userMessageId, role: "user", content: query })

    const assistantMessageId = crypto.randomUUID()
    addMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
      citations: [],
    })
    setIsLoading(true)
    setStatusMessage("Searching repository sources...")

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          query,
          messages: messages.slice(-10),
        }),
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || `HTTP error ${response.status}`)
      }

      const interactionId = response.headers.get("x-interaction-id") || undefined
      const rawCitations = response.headers.get("x-citations")
      let citations = []
      if (rawCitations) {
        try {
          citations = JSON.parse(decodeURIComponent(rawCitations))
        } catch {
          // ignore
        }
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("Stream unreadable")

      const decoder = new TextDecoder()
      let accumulated = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        updateLastMessage(accumulated, citations, interactionId)
      }
      updateLastMessage(accumulated, citations, interactionId)
    } catch (err) {
      updateLastMessage(
        err instanceof Error
          ? `Error: ${err.message}`
          : "Failed to retrieve answer."
      )
    } finally {
      setIsLoading(false)
      setStatusMessage(null)
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      {/* Left Sidebar: Document Quota & Repository Sources with strict tenant id */}
      <Sidebar
        onSelectSuggestion={handleSelectSuggestion}
        projectId={projectId}
        projectName={projectName}
      />

      {/* Main Research Copilot Chat Interface with strict tenant id */}
      <ChatContainer
        onSuggestedQuery={handleSelectSuggestion}
        projectId={projectId}
        projectName={projectName}
      />
    </div>
  )
}
