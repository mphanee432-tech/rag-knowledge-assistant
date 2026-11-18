import { validCitations } from "./citations"
export { citationIndices, validCitations } from "./citations"

export const NO_EVIDENCE = "I don't know."
export const ENTERPRISE_NO_EVIDENCE = "I don't know based on the documents I can access."
export const MAX_ANSWER_CHARS = 4000

export function isNoEvidenceAnswer(text: string): boolean {
  const normalized = text.trim()
  return normalized === NO_EVIDENCE || normalized === ENTERPRISE_NO_EVIDENCE
}
// Normalize Personal RAG refusals whose generated citation markers do not actually support an answer.
// Accept only a bare refusal plus optional well-formed Chunk markers; preserve substantive explanations.
const PERSONAL_REFUSAL_WITH_OPTIONAL_CITATIONS =
  /^I don['’]t know\.?(?:\s*\[Chunk\s+\d+(?:\s*,\s*(?:Chunk\s+)?\d+)*\])*\s*\.?$/i

export function normalizePersonalRefusal(text: string): string {
  return PERSONAL_REFUSAL_WITH_OPTIONAL_CITATIONS.test(text.trim()) ? NO_EVIDENCE : text
}

// Hold a potential refusal during SSE streaming so misleading citations never reach the UI.
export function mayBePersonalRefusal(text: string): boolean {
  const value = text.trimStart().toLowerCase()
  return value.length > 0 && ("i don't know".startsWith(value) || /^i don['’]t know\b/.test(value))
}

export interface StreamCitation {
  id: string
  index: number
  content: string
  metadata?: Record<string, unknown>
}
export type ChatEvent =
  | { type: "metadata"; interactionId?: string; citations: StreamCitation[] }
  | { type: "text"; text: string }
  | { type: "finish"; metrics: Record<string, unknown>; context?: string; fallbackQuestions?: string[] }
  | { type: "error"; message: string }

export function encodeEvent(event: ChatEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

// Both chat entry points use the same parser. Metadata never enters answer text.
export async function readChatStream(response: Response, onEvent: (event: ChatEvent) => void) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Unsupported chat response.")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Response body is not readable.")
  const decoder = new TextDecoder()
  let buffer = ""
  let finished = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (!frame.startsWith("data: ")) continue
        if (finished) throw new Error("The answer stream continued after completion.")
        const event = JSON.parse(frame.slice(6)) as ChatEvent
        if (event.type === "error") throw new Error(event.message)
        if (event.type === "finish") finished = true
        onEvent(event)
      }
      if (done) break
    }
    if (!finished || buffer.trim()) throw new Error("The answer stream ended unexpectedly. Please retry.")
  } finally { reader.releaseLock() }
}
export function assertValidAnswer(text: string, citations: StreamCitation[], finishReason: string) {
  if (finishReason !== "stop") throw new Error("Generation did not complete.")
  if (!text.trim() || text.length > MAX_ANSWER_CHARS) throw new Error("Answer is empty or exceeds the length limit.")
  if (!isNoEvidenceAnswer(text) && !validCitations(text, citations)) {
    throw new Error("Answer contains missing or invalid citations.")
  }
}

