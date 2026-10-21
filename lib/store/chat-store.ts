import { create } from "zustand"

export interface Citation {
  id: string
  content: string
  metadata?: {
    is_tabular?: boolean
    parent_headers?: string[]
    dom_path?: string
    page?: number
    line?: number
    char_count?: number
    filename?: string
    [key: string]: unknown
  }
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  interactionId?: string
}

export interface DocumentItem {
  id: string
  project_id: string
  storage_path: string
  status: "pending_upload" | "uploaded" | "processing" | "indexed" | "failed"
  created_at: string
  metadata?: Record<string, unknown>
}

interface ChatStore {
  messages: ChatMessage[]
  activeProjectId: string | null
  isLoading: boolean
  statusMessage: string | null
  documents: DocumentItem[]
  suggestedQueries: string[]
  isDocumentsLoading: boolean

  // Core Actions
  setActiveProject: (projectId: string) => void
  setStatusMessage: (status: string | null) => void
  addMessage: (message: ChatMessage) => void
  clearChat: () => void

  // UI state actions
  setIsLoading: (isLoading: boolean) => void
  updateLastMessage: (content: string, citations?: Citation[], interactionId?: string) => void
  setDocuments: (documents: DocumentItem[]) => void
  setSuggestedQueries: (queries: string[]) => void
  setIsDocumentsLoading: (loading: boolean) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  activeProjectId: null,
  isLoading: false,
  statusMessage: null,
  documents: [],
  suggestedQueries: [],
  isDocumentsLoading: true,

  setActiveProject: (projectId: string) =>
    set({
      activeProjectId: projectId,
      messages: [],
      statusMessage: null,
      documents: [],
      suggestedQueries: [],
      isDocumentsLoading: true,
    }),

  setStatusMessage: (status: string | null) =>
    set({ statusMessage: status }),

  addMessage: (message: ChatMessage) =>
    set((state) => {
      const updated = [...state.messages, message]
      // Strictly enforce bounded 5-turn sliding window (maximum 10 messages: 5 user turns + 5 assistant turns)
      const bounded = updated.length > 10 ? updated.slice(updated.length - 10) : updated
      return { messages: bounded }
    }),

  clearChat: () =>
    set({
      messages: [],
      statusMessage: null,
      isLoading: false,
    }),

  setIsLoading: (isLoading: boolean) =>
    set({ isLoading }),

  updateLastMessage: (content: string, citations?: Citation[], interactionId?: string) =>
    set((state) => {
      if (state.messages.length === 0) return state
      const lastIndex = state.messages.length - 1
      const last = state.messages[lastIndex]
      const updated = [...state.messages]
      updated[lastIndex] = {
        ...last,
        content,
        citations: citations !== undefined ? citations : last.citations,
        interactionId: interactionId !== undefined ? interactionId : last.interactionId,
      }
      return { messages: updated }
    }),

  setDocuments: (documents: DocumentItem[]) =>
    set({ documents, isDocumentsLoading: false }),

  setSuggestedQueries: (suggestedQueries: string[]) =>
    set({ suggestedQueries }),

  setIsDocumentsLoading: (isDocumentsLoading: boolean) =>
    set({ isDocumentsLoading }),
}))
