"use client"
import { ENTERPRISE_NO_EVIDENCE, NO_EVIDENCE, normalizePersonalRefusal, readChatStream } from "@/lib/chat-contract"
import { useChatStore, type Citation } from "@/lib/store/chat-store"

export async function sendChat(query: string, projectId: string | null | undefined, organizationId?: string) {
  const store = useChatStore.getState()
  const chatScope = organizationId ? `organization:${organizationId}` : projectId
  if (!chatScope || !query.trim() || store.isLoading || store.activeProjectId !== chatScope) return
  const history = organizationId ? [] : store.messages.slice(-8).map(({ role, content }) => ({ role, content }))
  const messageId = crypto.randomUUID()
  store.addMessage({ id: crypto.randomUUID(), role: "user", content: query })
  store.addMessage({ id: messageId, role: "assistant", content: "", citations: [] })
  store.setIsLoading(true)
  store.setStatusMessage("Searching your documents…")
  const current = () => {
    const state = useChatStore.getState()
    return state.activeProjectId === chatScope && state.messages.some(m => m.id === messageId)
  }
  let text = ""
  let citations: Citation[] = []
  let interactionId: string | undefined
  let fallbackQuestions: string[] | undefined
  const update = () => {
    if (current()) useChatStore.setState(state => ({
      messages: state.messages.map(m => m.id === messageId ? {
        ...m, content: text, citations, interactionId,
        ...(organizationId && text === ENTERPRISE_NO_EVIDENCE && fallbackQuestions?.length ? { fallbackQuestions } : {}),
      } : m),
    }))
  }
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(organizationId ? { organizationId } : { projectId }), query, messages: history, stream: true }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || "Unable to load answer.")
    }
    await readChatStream(response, event => {
      if (event.type === "metadata") { citations = event.citations; interactionId = event.interactionId }
      if (event.type === "text") { text += event.text; update() }
      if (event.type === "finish") fallbackQuestions = event.fallbackQuestions
    })
    if (!text.trim()) {
      throw new Error("The answer could not be completed. Please retry.")
    }
    if (!organizationId) {
      text = normalizePersonalRefusal(text)
      if (text === NO_EVIDENCE) citations = []
    }
    update()
  } catch (error) {
    text = error instanceof Error ? `Error: ${error.message}` : "Unable to complete the answer."
    citations = []
    interactionId = undefined
    update()
  } finally {
    if (current()) { store.setIsLoading(false); store.setStatusMessage(null) }
  }
}

