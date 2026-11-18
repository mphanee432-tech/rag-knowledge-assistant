import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MessageItem } from "../components/chat/message-item"
import { AccountSummary } from "../components/account-summary"
import { WorkspaceTabs } from "../components/workspace-tabs"
import { encodeEvent, ENTERPRISE_NO_EVIDENCE, type ChatEvent } from "../lib/chat-contract"
import { parseChatInput } from "../lib/chat-input"
import { sendChat } from "../lib/send-chat"
import { useChatStore, type ChatMessage } from "../lib/store/chat-store"

const projectId = "11111111-1111-4111-8111-111111111111"
const sourceContext = "retrieved-context-sentinel"
const telemetry = "<!-- rag-telemetry: {\"internal\":true} -->"
const citations = [{ id: "chunk-a", index: 1, content: "private-citation-excerpt", metadata: { filename: "source.txt" } }]

test("logout and account switch discard history and late responses on the same project", async t => {
  const initial = useChatStore.getState()
  t.after(() => useChatStore.setState(initial, true))
  const store = useChatStore.getState()
  store.setAccount("first-user")
  store.setActiveProject(projectId)
  store.addMessage({ id: "old", role: "assistant", content: "Private history", citations })
  store.setAccount("first-user")
  assert.equal(useChatStore.getState().messages.length, 1)

  let finish!: (response: Response) => void
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { finish = resolve }))
  const pending = sendChat("Old account question", projectId)
  store.setAccount(null)
  assert.deepEqual(useChatStore.getState().messages, [])
  store.setAccount("second-user")
  store.setActiveProject(projectId)
  finish(response([{ type: "metadata", citations }, { type: "text", text: "Late private answer" }, { type: "finish", metrics: {} }]))
  await pending
  assert.deepEqual(useChatStore.getState().messages, [])
  assert.equal(useChatStore.getState().accountId, "second-user")
})

function response(events: ChatEvent[]) {
  const bytes = Buffer.concat(events.map(event => Buffer.from(encodeEvent(event))))
  return new Response(new ReadableStream({ start(controller) {
    // Split JSON frames and UTF-8 characters across reads, as real network delivery can do.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  }}), { headers: { "Content-Type": "text/event-stream" } })
}

test("Personal refusal does not expose unrelated source chips, even with legacy bad metadata", async t => {
  const previous = useChatStore.getState()
  t.after(() => useChatStore.setState(previous, true))
  const store = useChatStore.getState()
  store.setActiveProject(projectId)
  t.mock.method(globalThis, "fetch", async () => response([
    { type: "metadata", interactionId: "personal-refusal-1", citations },
    { type: "text", text: "I don't know [Chunk 1]." },
    { type: "metadata", interactionId: "personal-refusal-1", citations: [] },
    { type: "finish", metrics: {} },
  ]))
  await sendChat("Unknown HR policy", projectId)
  const assistant = useChatStore.getState().messages.at(-1)!
  assert.equal(assistant.content, "I don't know.")
  assert.deepEqual(assistant.citations, [])
  assert.equal(assistant.interactionId, "personal-refusal-1")
  const html = renderToStaticMarkup(createElement(MessageItem, { message: assistant }))
  assert.ok(html.includes("I don&#x27;t know.") || html.includes("I don&#39;t know.") || html.includes("I don&#x27;t know"))
  assert.ok(!html.includes("Sources:"))
  assert.ok(!html.includes("private-citation-excerpt"))
  const legacyHtml = renderToStaticMarkup(createElement(MessageItem, {
    message: { ...assistant, content: "I don't know [Chunk 1].", citations },
  }))
  assert.ok(!legacyHtml.includes("Sources:"))
  assert.ok(!legacyHtml.includes("Chunk #1"))
  assert.ok(!legacyHtml.includes("private-citation-excerpt"))
})

test("enterprise chat sends an organization request without previous evidence or a project", async t => {
  const initial = useChatStore.getState()
  t.after(() => useChatStore.setState(initial, true))
  const organizationId = "22222222-2222-4222-8222-222222222222"
  initial.setActiveProject(`organization:${organizationId}`)
  initial.addMessage({ id: "old", role: "assistant", content: "Previously authorized answer", citations })
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { organizationId, query: "Question", messages: [], stream: true })
    return response([{ type: "metadata", citations }, { type: "text", text: "Answer [Chunk 1]." }, { type: "finish", metrics: {} }])
  })
  await sendChat("Question", undefined, organizationId)
  assert.equal(useChatStore.getState().messages.at(-1)?.content, "Answer [Chunk 1].")
})

test("enterprise refusal suggestions stay separate from text and are discarded on account switch", async t => {
  const store = useChatStore.getState()
  t.after(() => useChatStore.setState(store, true))
  const organizationId = "22222222-2222-4222-8222-222222222222"
  const scope = `organization:${organizationId}`
  const fallbackQuestions = ["How should I hand off a design?", "How do I request leave?", "How do I request equipment?"]
  const refusal = () => response([
    { type: "text", text: ENTERPRISE_NO_EVIDENCE },
    { type: "finish", metrics: {}, fallbackQuestions },
  ])
  store.setAccount("designer")
  store.setActiveProject(scope)
  let release!: (value: Response) => void
  const requested: string[] = []
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { query, messages } = JSON.parse(String(init?.body))
    assert.deepEqual(messages, [])
    requested.push(query)
    return requested.length === 1 ? refusal() : new Promise<Response>(resolve => { release = resolve })
  })
  await sendChat("Unsupported question", undefined, organizationId)
  const message = useChatStore.getState().messages.at(-1)
  assert.equal(message?.content, ENTERPRISE_NO_EVIDENCE)
  assert.deepEqual(message?.fallbackQuestions, fallbackQuestions)
  const pending = sendChat(fallbackQuestions[0], undefined, organizationId)
  assert.equal(requested.at(-1), fallbackQuestions[0])
  store.setAccount("engineer")
  store.setActiveProject(scope)
  release(refusal())
  await pending
  assert.deepEqual(useChatStore.getState().messages, [])
})

test("shared chat consumer keeps metadata outside answer text and subsequent history", async t => {
  const initial = useChatStore.getState()
  t.after(() => useChatStore.setState(initial, true))

  await t.test("finish telemetry cannot render or enter the next request", async st => {
    useChatStore.getState().setActiveProject(projectId)
    const updates: string[] = []
    const unsubscribe = useChatStore.subscribe(state => {
      updates.push(...state.messages.filter(message => message.role === "assistant").map(message => message.content))
    })
    st.after(unsubscribe)
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
    st.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      return response([
        { type: "metadata", interactionId: "interaction-a", citations },
        { type: "text", text: "Answer café " },
        { type: "text", text: "[Chunk 1]." },
        { type: "finish", metrics: { internal_metric: 1234 }, context: `${sourceContext}\n${telemetry}` },
      ])
    })
    await sendChat("Question", projectId)
    const assistant = useChatStore.getState().messages.at(-1)!
    assert.equal(assistant.content, "Answer café [Chunk 1].")
    assert.deepEqual(assistant.citations, citations)
    assert.equal(assistant.interactionId, "interaction-a")
    assert.equal(useChatStore.getState().isLoading, false)
    const html = renderToStaticMarkup(createElement(MessageItem, { message: assistant }))
    assert.ok(html.includes("Answer café"))
    assert.ok(!html.includes(sourceContext) && !html.includes("rag-telemetry") && !html.includes("internal_metric"))
    assert.ok(updates.every(text => !text.includes(sourceContext) && !text.includes("rag-telemetry")))

    await sendChat("Follow-up", projectId)
    assert.deepEqual(requests[1].messages, [
      { role: "user", content: "Question" }, { role: "assistant", content: "Answer café [Chunk 1]." },
    ])
    assert.deepEqual(parseChatInput({ projectId, query: "Follow-up", messages: requests[1].messages }).boundedHistory, [
      ...requests[1].messages, { role: "user", content: "Follow-up" },
    ])
    const wireHistory = JSON.stringify(requests[1].messages)
    for (const privateField of [sourceContext, "rag-telemetry", "internal_metric", "private-citation-excerpt", "interaction-a", "citations"]) {
      assert.ok(!wireHistory.includes(privateField), privateField)
    }
  })

  await t.test("existing message metadata is excluded from outgoing history", async st => {
    useChatStore.getState().setActiveProject(projectId)
    const existing: ChatMessage = { id: "old-message", role: "assistant", content: "Previous answer [Chunk 1]", citations, interactionId: "old-interaction" }
    useChatStore.getState().addMessage(existing)
    st.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.deepEqual(JSON.parse(String(init?.body)).messages, [{ role: "assistant", content: existing.content }])
      return response([
        { type: "metadata", interactionId: "next", citations },
        { type: "text", text: "Next answer [Chunk 1]" },
        { type: "finish", metrics: {} },
      ])
    })
    await sendChat("Next question", projectId)
    assert.equal(useChatStore.getState().messages.at(-1)?.content, "Next answer [Chunk 1]")
  })

  await t.test("legacy raw streams fail closed instead of displaying a telemetry trailer", async st => {
    useChatStore.getState().setActiveProject(projectId)
    st.mock.method(globalThis, "fetch", async () => new Response(`Answer [Chunk 1]\n${telemetry}\n${sourceContext}`, {
      headers: { "Content-Type": "text/plain" },
    }))
    await sendChat("Question", projectId)
    const assistant = useChatStore.getState().messages.at(-1)!
    assert.match(assistant.content, /^Error: Unsupported chat response/)
    assert.ok(!assistant.content.includes(sourceContext) && !assistant.content.includes("rag-telemetry"))
    assert.deepEqual(assistant.citations, [])
  })

  await t.test("streaming failures and empty streams render a readable error instead of a blank message", async st => {
    useChatStore.getState().setActiveProject(projectId)
    st.mock.method(globalThis, "fetch", async () => response([
      { type: "metadata", citations },
      { type: "error", message: "The answer could not be completed. Please retry." },
    ]))
    await sendChat("Question", projectId)
    const assistant = useChatStore.getState().messages.at(-1)!
    assert.equal(assistant.content, "Error: The answer could not be completed. Please retry.")
    assert.deepEqual(assistant.citations, [])
    const html = renderToStaticMarkup(createElement(MessageItem, { message: assistant }))
    assert.ok(html.includes("Response Error"))
    assert.ok(html.includes("The answer could not be completed. Please retry."))

    const emptyFinished: ChatMessage = { id: "empty-assistant", role: "assistant", content: "" }
    const emptyHtml = renderToStaticMarkup(createElement(MessageItem, { message: emptyFinished, isStreaming: false }))
    assert.ok(emptyHtml.includes("Response Error"))
    assert.ok(emptyHtml.includes("The answer could not be completed. Please retry."))
  })
})

test("WP9.14: workspace tabs render Personal RAG and Enterprise RAG links and preserve independent chat histories per scope", t => {
  const initial = useChatStore.getState()
  t.after(() => useChatStore.setState(initial, true))

  const personalTabsHtml = renderToStaticMarkup(createElement(WorkspaceTabs, { activeTab: "personal" }))
  assert.ok(personalTabsHtml.includes("Personal RAG"))
  assert.ok(personalTabsHtml.includes("Your private documents"))
  assert.ok(personalTabsHtml.includes("Enterprise RAG"))
  assert.ok(personalTabsHtml.includes("Company knowledge"))
  assert.ok(personalTabsHtml.includes('href="/?tab=personal"'))
  assert.ok(personalTabsHtml.includes('href="/?tab=enterprise"'))
  assert.ok(personalTabsHtml.includes('grid-cols-2'))
  assert.ok(personalTabsHtml.includes('focus-visible:ring-2'))
  assert.match(personalTabsHtml, /<a[^>]*href="\/\?tab=personal"[^>]*>|<a[^>]*aria-current="page"[^>]*href="\/\?tab=personal"/)
  assert.match(personalTabsHtml, /<a[^>]*aria-current="page"[^>]*href="\/\?tab=personal"/)
  assert.doesNotMatch(personalTabsHtml, /<a[^>]*aria-current="page"[^>]*href="\/\?tab=enterprise"/)

  const enterpriseTabsHtml = renderToStaticMarkup(createElement(WorkspaceTabs, { activeTab: "enterprise" }))
  assert.match(enterpriseTabsHtml, /<a[^>]*aria-current="page"[^>]*href="\/\?tab=enterprise"/)
  assert.doesNotMatch(enterpriseTabsHtml, /<a[^>]*aria-current="page"[^>]*href="\/\?tab=personal"/)

  const store = useChatStore.getState()
  const enterpriseScope = "organization:c0000000-0000-4000-8000-000000000001"
  store.setAccount("user-1")
  store.setActiveProject(projectId)
  store.addMessage({ id: "p-1", role: "user", content: "Personal project question" })
  store.addMessage({ id: "p-2", role: "assistant", content: "Personal project answer [Chunk 1]" })

  // Switch to Enterprise RAG tab: starts with clean enterprise history, does not mix personal messages
  store.setActiveProject(enterpriseScope)
  assert.deepEqual(useChatStore.getState().messages, [])
  store.addMessage({ id: "e-1", role: "user", content: "Enterprise policy question" })
  store.addMessage({ id: "e-2", role: "assistant", content: "Enterprise policy answer [Chunk 1]" })

  // Switch back to Personal RAG project: restores personal conversation without enterprise messages
  store.setActiveProject(projectId)
  assert.deepEqual(
    useChatStore.getState().messages.map(m => m.content),
    ["Personal project question", "Personal project answer [Chunk 1]"],
  )

  // Switch back to Enterprise RAG tab: restores enterprise conversation
  store.setActiveProject(enterpriseScope)
  assert.deepEqual(
    useChatStore.getState().messages.map(m => m.content),
    ["Enterprise policy question", "Enterprise policy answer [Chunk 1]"],
  )

  // Account switch clears all scoped histories
  store.setAccount("user-2")
  store.setActiveProject(projectId)
  assert.deepEqual(useChatStore.getState().messages, [])
  store.setActiveProject(enterpriseScope)
  assert.deepEqual(useChatStore.getState().messages, [])

  const accountHtml = renderToStaticMarkup(
    createElement(AccountSummary, {
      account: {
        email: "newengineering@example.com",
        organizationName: "DeccanBridge Software",
        departmentName: "Engineering",
        role: "Employee",
        accessStatus: "Active",
        jiraAccessAvailable: true,
      },
    }),
  )
  assert.ok(accountHtml.includes("newengineering@example.com"))
  assert.ok(accountHtml.includes("DeccanBridge Software"))
  assert.ok(accountHtml.includes("Engineering"))
  assert.ok(accountHtml.includes("Employee"))
  assert.ok(accountHtml.includes("Enterprise membership: Active"))
  assert.ok(accountHtml.includes("Jira Access: Enabled"))
})

test("WP9.15: Sign Up page displays Department dropdown and renamed Enable Jira Ticket Creation checkbox, while Sign In displays neither", async () => {
  const fs = await import("node:fs/promises")
  const loginSource = await fs.readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8")
  const { DEMO_DEPARTMENTS } = await import("../lib/utils")

  assert.deepEqual(DEMO_DEPARTMENTS, [
    "Engineering",
    "HR",
    "Product Management",
    "Project Management",
    "UI/UX",
    "Operations",
    "Marketing",
    "Finance",
  ])

  // Sign In is default mode and demoJiraAccess is false (unchecked) by default
  assert.match(loginSource, /useState<"signin"\s*\|\s*"signup"\s*\|\s*"forgot">\("signin"\)/)
  assert.match(loginSource, /const \[demoJiraAccess, setDemoJiraAccess\] = useState\(false\)/)

  // Sign Up block renders both Department dropdown and renamed Jira checkbox simultaneously, gated by mode === "signup"
  const signupBlockMatch = loginSource.match(/\{mode === "signup" && \([\s\S]*?\n        \)\}/)
  assert.ok(signupBlockMatch, "Expected signup-only block in app/login/page.tsx")
  const signupBlock = signupBlockMatch[0]

  assert.match(signupBlock, /name="department"[\s\S]*?required/)
  assert.match(signupBlock, /DEMO_DEPARTMENTS\.map/)
  assert.match(signupBlock, /type="checkbox"[\s\S]*?name="demoJiraAccess"/)
  assert.ok(signupBlock.includes("Enable Jira Ticket Creation"))
  assert.ok(signupBlock.includes("Allow creation of Jira tickets through the confirmation workflow."))
  assert.ok(!signupBlock.includes(">Enterprise membership<"))
  assert.ok(!signupBlock.includes("Enable Jira ticket creation for the demo."))
})

test("WP9.25: shared ChatInput displays updated placeholder in both Personal RAG and Enterprise RAG without changing submission", async t => {
  const { ChatContainer } = await import("../components/chat/chat-container")
  const { ChatInput } = await import("../components/chat/chat-input")
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime")
  type AppRouterInstance = import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterInstance
  const fs = await import("node:fs/promises")

  const mockRouter = {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    replace: () => {},
    prefetch: async () => {},
  } as unknown as AppRouterInstance
  const renderWithRouter = (node: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: mockRouter }, node))

  const initial = useChatStore.getState()
  t.after(() => useChatStore.setState(initial, true))

  // Enterprise RAG ChatContainer renders the shared ChatInput placeholder
  const orgId = "c0000000-0000-4000-8000-000000000001"
  const enterpriseHtml = renderWithRouter(
    createElement(ChatContainer, {
      organizationId: orgId,
      canUploadPolicy: false,
    }),
  )
  assert.ok(enterpriseHtml.includes('placeholder="How can I help you today?"'))
  assert.ok(!enterpriseHtml.includes("Ask a technical question, or paste logs"))

  // Both Personal RAG and Enterprise RAG share the single <ChatInput /> in ChatContainer
  const [chatContainerSource, workspaceClientSource, chatInputSource] = await Promise.all([
    fs.readFile(new URL("../components/chat/chat-container.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../components/chat/project-workspace-client.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../components/chat/chat-input.tsx", import.meta.url), "utf8"),
  ])
  assert.equal((chatContainerSource.match(/<ChatInput\b/g) || []).length, 1)
  assert.match(workspaceClientSource, /<ChatContainer\b/)

  // Direct shared ChatInput render (Personal RAG & Enterprise RAG) & submission wiring remain intact
  const inputHtml = renderToStaticMarkup(
    createElement(ChatInput, {
      onSendMessage: async () => {},
      isLoading: false,
      statusMessage: null,
    }),
  )
  assert.ok(inputHtml.includes('placeholder="How can I help you today?"'))
  assert.ok(!inputHtml.includes("Ask a technical question, or paste logs"))
  assert.ok(inputHtml.includes("0 / 2500"))

  assert.match(chatInputSource, /if \(e\.key === "Enter" && !e\.shiftKey\)/)
  assert.match(chatInputSource, /await onSendMessage\(trimmed\)/)
})
