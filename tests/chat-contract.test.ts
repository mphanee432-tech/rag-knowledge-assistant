import assert from "node:assert/strict"
import test from "node:test"
import { assertValidAnswer, encodeEvent, MAX_ANSWER_CHARS, NO_EVIDENCE, normalizePersonalRefusal, mayBePersonalRefusal, readChatStream, validCitations, type ChatEvent } from "../lib/chat-contract"

test("SSE parser survives split UTF-8 and frames without leaking metadata into text", async () => {
  const events: ChatEvent[] = [
    { type: "metadata", interactionId: "a", citations: [{ id: "b", index: 1, content: "private context" }] },
    { type: "text", text: "Answer café [Chunk 1]." },
    { type: "finish", metrics: { total_ms: 10 }, context: "private context" },
  ]
  const bytes = Buffer.concat(events.map(e => Buffer.from(encodeEvent(e))))
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  }}), { headers: { "Content-Type": "text/event-stream" } })
  let text = ""
  await readChatStream(response, event => { if (event.type === "text") text += event.text })
  assert.equal(text, "Answer café [Chunk 1].")
})
test("truncated and failed streams reject instead of looking successful", async () => {
  const response = (event: ChatEvent) => new Response(new TextDecoder().decode(encodeEvent(event)), { headers: { "Content-Type": "text/event-stream" } })
  await assert.rejects(readChatStream(response({ type:"text", text:"partial" }), () => {}), /unexpectedly/)
  await assert.rejects(readChatStream(response({ type:"error", message:"failed" }), () => {}), /failed/)
})

test("text after the finish boundary cannot be delivered as answer content", async () => {
  const events: ChatEvent[] = [
    { type: "text", text: "Answer [Chunk 1]" },
    { type: "finish", metrics: { total_ms: 10 } },
    { type: "text", text: "<!-- rag-telemetry: private context -->" },
  ]
  const response = new Response(Buffer.concat(events.map(event => Buffer.from(encodeEvent(event)))), {
    headers: { "Content-Type": "text/event-stream" },
  })
  let text = ""
  await assert.rejects(readChatStream(response, event => { if (event.type === "text") text += event.text }), /continued after completion/)
  assert.equal(text, "Answer [Chunk 1]")
})
test("citations resolve every index including grouped references", () => {
  const citations = [{id:"a", index:1, content:"a"}, {id:"b", index:2, content:"b"}]
  assert.equal(validCitations("Answer [Chunk 1, Chunk 2]", citations), true)
  assert.equal(validCitations("Answer [Chunk 1, Chunk 99]", citations), false)
  for (const text of ["No references", "Answer [Chunk 1] [Chunk banana]", "Answer [Chunk 1] [Chunk 2", "Answer [Chunk 0]"]) {
    assert.equal(validCitations(text, citations), false, text)
  }
  assert.equal(validCitations("Answer [Chunk 1]", [{ id: "", index: 1, content: "a" }]), false)
})

test("only complete, bounded answers with valid references or an exact refusal pass", () => {
  assert.equal(MAX_ANSWER_CHARS, 4000)
  const citations = [{ id: "a", index: 1, content: "evidence" }]
  assert.doesNotThrow(() => assertValidAnswer("Answer [Chunk 1]", citations, "stop"))
  assert.doesNotThrow(() => assertValidAnswer(NO_EVIDENCE, [], "stop"))
  assert.doesNotThrow(() => assertValidAnswer(NO_EVIDENCE, citations, "stop"))
  const bounded = "x".repeat(MAX_ANSWER_CHARS - " [Chunk 1]".length) + " [Chunk 1]"
  assert.doesNotThrow(() => assertValidAnswer(bounded, citations, "stop"))
  for (const text of ["", "  ", "Uncited answer", "Answer [Chunk 99]", "Answer [Chunk 1] [Chunk ?]", bounded + "x", NO_EVIDENCE + " Extra assertion."]) {
    assert.throws(() => assertValidAnswer(text, citations, "stop"), text)
  }
  assert.throws(() => assertValidAnswer("Answer [Chunk 1]", [], "stop"))
  for (const reason of ["length", "error", "content-filter", "tool-calls", "unknown"]) {
    assert.throws(() => assertValidAnswer("Answer [Chunk 1]", citations, reason))
  }
})


test("Personal RAG refuses without citation markers while preserving grounded negative explanations", () => {
  for (const candidate of [
    "I don't know.",
    "I don't know [Chunk 1].",
    "I don't know [Chunk 1, Chunk 2, Chunk 3].",
    "I don't know [Chunk 1] [Chunk 2].",
    "I DON’T KNOW [Chunk 8].",
  ]) {
    assert.equal(normalizePersonalRefusal(candidate), NO_EVIDENCE, candidate)
  }
  for (const supportedOrInvalid of [
    "I don't know why this happened [Chunk 1].",
    "I don't know, because policy excludes this case [Chunk 1].",
    "I don't know [Chunk banana].",
    "I don't know [Chunk 1] plus a factual claim.",
    "The policy does not establish a leave entitlement [Chunk 1].",
  ]) {
    assert.equal(normalizePersonalRefusal(supportedOrInvalid), supportedOrInvalid)
  }
  for (const fragment of ["I", "I don", "I don't know", "I don't know [Chunk 1"] ) {
    assert.equal(mayBePersonalRefusal(fragment), true, fragment)
  }
  assert.equal(mayBePersonalRefusal("The answer is [Chunk 1]."), false)
})
