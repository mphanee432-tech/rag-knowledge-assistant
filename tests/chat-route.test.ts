import assert from "node:assert/strict"
import test from "node:test"
import { POST } from "../app/api/chat/route"
import { ENTERPRISE_NO_EVIDENCE, MAX_ANSWER_CHARS, NO_EVIDENCE, readChatStream, type ChatEvent } from "../lib/chat-contract"
import {
  CAPABILITY_RESPONSE_WITH_JIRA,
  CAPABILITY_RESPONSE_WITHOUT_JIRA,
  GREETING_RESPONSE,
  IDENTITY_RESPONSE_WITH_JIRA,
  IDENTITY_RESPONSE_WITHOUT_JIRA,
} from "../lib/chat-input"
import { buildEnterprisePolicyPrompt, getSystemPrompt } from "../lib/prompts/systemPrompt"

test("chat only persists and completes verified answers in JSON and SSE modes", async t => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://chat-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
    CHAT_MODEL: "gemini-3.1-flash-lite",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  t.mock.method(console, "error", () => {})
  const projectId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const valid = "Supported answer [Chunk 1, Chunk 2]."
  const cases = [
    { name: "valid grouped references", text: valid, ok: true },
    { name: "unknown reference", text: "Answer [Chunk 1, Chunk 99].", ok: false },
    { name: "missing reference", text: "Uncited answer.", ok: false },
    { name: "malformed reference", text: "Answer [Chunk 1] [Chunk banana]", ok: false },
    { name: "cut-off reference", text: "Answer [Chunk 1] [Chunk 2", ok: false },
    { name: "empty generation", text: "", ok: false },
    { name: "character limit", text: valid + "x".repeat(MAX_ANSWER_CHARS), ok: false },
    { name: "provider token limit", text: valid, finishReason: "MAX_TOKENS", ok: false },
    { name: "exact refusal", text: NO_EVIDENCE, ok: true },
    { name: "cited refusal normalized", text: "I don\'t know [Chunk 1, Chunk 2].", expectedText: NO_EVIDENCE, ok: true },
    { name: "empty retrieval", text: NO_EVIDENCE, emptyRetrieval: true, ok: true },
    { name: "persistence failure", text: valid, persistError: true, ok: false },
    { name: "evaluation context uses a finish event", text: valid, evalStream: true, ok: true },
  ]
  for (const stream of [false, true]) {
    for (const scenario of cases) {
      if (scenario.evalStream && !stream) continue
      await t.test(`${stream ? "SSE" : "JSON"}: ${scenario.name}`, async st => {
        const saved: Array<{ response_markdown: string }> = []
        const unexpected: string[] = []
        let generations = 0
        let authCalls = 0
        let projectChecks = 0
        st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          if (url.hostname === "chat-test.invalid") {
            switch (url.pathname) {
              case "/auth/v1/user":
                authCalls++
                assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token")
                return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
              case "/rest/v1/projects":
                projectChecks++
                assert.equal(url.searchParams.get("id"), `eq.${projectId}`)
                assert.equal(url.searchParams.get("user_id"), `eq.${userId}`)
                return Response.json([{ id: projectId, user_id: userId, name: "Owned" }])
              case "/rest/v1/rpc/search_rag_chunks":
                assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token")
                assert.equal(url.searchParams.get("select"), "id")
                return Response.json(scenario.emptyRetrieval ? [] : [{ id: "chunk-a" }, { id: "chunk-b" }])
              case "/rest/v1/document_chunks":
                assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token")
                assert.equal(url.searchParams.get("project_id"), `eq.${projectId}`)
                assert.equal(url.searchParams.get("documents.status"), "eq.indexed")
                return Response.json(["chunk-a", "chunk-b"].map(id => ({ id, content: "Evidence", metadata: {} })))
              case "/rest/v1/interactions": {
                const row = JSON.parse(String(init?.body))
                assert.equal(init?.method, "POST")
                assert.deepEqual(row, {
                  id: row.id, project_id: projectId, user_id: userId, query_text: "Question",
                  retrieved_chunk_ids: scenario.emptyRetrieval || scenario.expectedText === NO_EVIDENCE ? [] : ["chunk-a", "chunk-b"],
                  response_markdown: scenario.expectedText ?? scenario.text, latency_ms: row.latency_ms,
                })
                assert.match(row.id, /^[0-9a-f-]{36}$/i)
                assert.ok(Number.isInteger(row.latency_ms) && row.latency_ms >= 0)
                if (scenario.persistError) return Response.json({ message: "Persistence failed" }, { status: 400 })
                saved.push(row)
                return new Response(null, { status: 201 })
              }
            }
          }
          if (url.hostname === "generativelanguage.googleapis.com") {
            if (url.pathname.endsWith(":batchEmbedContents")) {
              return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
            }
            if (url.pathname.endsWith(":generateContent") || url.pathname.endsWith(":streamGenerateContent")) {
              generations++
              const parts = stream ? [scenario.text.slice(0, -3), scenario.text.slice(-3)] : [scenario.text]
              const responses = parts.map((text, i) => ({
                candidates: [{ index: 0, content: { role: "model", parts: [{ text }] },
                  ...(i === parts.length - 1 ? { finishReason: scenario.finishReason || "STOP" } : {}) }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
              }))
              return stream
                ? new Response(responses.map(body => `data: ${JSON.stringify(body)}\n\n`).join(""), {
                    headers: { "Content-Type": "text/event-stream" },
                  })
                : Response.json(responses[0])
            }
          }
          unexpected.push(url.href)
          throw new Error("Unexpected request: " + url.href)
        })
        const response = await POST(new Request("https://app.invalid/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-token",
            ...(scenario.evalStream ? { "x-eval-mode": "true" } : {}) },
          body: JSON.stringify({ projectId, query: "Question", stream, user_id: "33333333-3333-4333-8333-333333333333" }),
        }))
        if (stream) {
          assert.equal(response.status, 200)
          assert.equal(response.headers.get("content-type"), "text/event-stream")
          const wire = response.clone().text()
          const events: ChatEvent[] = []
          const reading = readChatStream(response, event => events.push(event))
          if (scenario.ok) await reading
          else await assert.rejects(reading, /could not be completed/)
          assert.equal(events[0]?.type, "metadata")
          assert.equal(events.some(event => event.type === "finish"), scenario.ok)
          if (scenario.ok) {
            assert.equal(events.filter(event => event.type === "text").map(event => event.text).join(""), scenario.expectedText ?? scenario.text)
            if (scenario.expectedText === NO_EVIDENCE) {
              const finalMetadata = events.filter(event => event.type === "metadata").at(-1)
              assert.ok(finalMetadata?.type === "metadata")
              assert.deepEqual(finalMetadata.citations, [])
            }
            const finish = events.find(event => event.type === "finish")
            assert.ok(finish?.type === "finish")
            assert.equal(typeof finish.metrics, "object")
            assert.equal(typeof finish.context, scenario.evalStream ? "string" : "undefined")
            if (scenario.evalStream) assert.match(finish.context!, /Evidence/)
          }
          const frames = (await wire).split("\n\n")
          assert.equal(frames.pop(), "")
          const wireEvents = frames.map(frame => {
            assert.ok(frame.startsWith("data: "))
            return JSON.parse(frame.slice(6)) as ChatEvent
          })
          assert.ok(!wireEvents.some(event => event.type === "text" && /Chunk (?:99|banana)/.test(event.text)))
          assert.equal(wireEvents.at(-1)?.type, scenario.ok ? "finish" : "error")
          assert.ok(!JSON.stringify(wireEvents).includes("rag-telemetry"))
        } else {
          assert.equal(response.status, scenario.ok ? 200 : 500)
          const body = await response.json()
          if (scenario.ok) {
            assert.equal(body.text, scenario.expectedText ?? scenario.text)
            if (scenario.expectedText === NO_EVIDENCE) assert.deepEqual(body.citations, [])
          }
          else assert.equal(body.text, undefined)
        }
        assert.deepEqual(unexpected, [])
        assert.equal(authCalls, 1)
        assert.equal(projectChecks, 1)
        assert.equal(generations, scenario.emptyRetrieval ? 0 : 1)
        assert.deepEqual(saved.map(row => row.response_markdown), scenario.ok ? [scenario.expectedText ?? scenario.text] : [])
      })
    }
  }
})

test("organization chat releases only freshly authorized, cited evidence", async t => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://enterprise-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const organizationId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const chunkId = "33333333-3333-4333-8333-333333333333"
  const cases = [
    { name: "authorized SSE", stream: true, answer: "Use the documented setting [Chunk 1]." },
    { name: "authorized JSON", stream: false, answer: "Use the documented setting [Chunk 1]." },
    { name: "revoked before SSE release", stream: true, revoked: true },
    { name: "revoked before JSON release", stream: false, revoked: true },
    { name: "invalid citation", stream: true, invalid: true },
    { name: "model refuses without citation", stream: true, refusal: ENTERPRISE_NO_EVIDENCE },
    { name: "model refuses with citation", stream: true, refusal: `${ENTERPRISE_NO_EVIDENCE} [Chunk 1]` },
    { name: "no authorized evidence", stream: true, empty: true },
    { name: "suggestion authorization unavailable", stream: false, empty: true, unavailable: true },
    { name: "unauthorized organization", stream: true, denied: true },
  ]
  for (const scenario of cases) await t.test(scenario.name, async st => {
    const calls: string[] = []
    st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url.pathname)
      if (url.hostname === "enterprise-test.invalid") {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer employee-token")
        switch (url.pathname) {
          case "/auth/v1/user":
            return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
          case "/rest/v1/rpc/enterprise_copilot_context":
            assert.deepEqual(JSON.parse(String(init?.body)), { target_organization_id: organizationId })
            return Response.json(scenario.denied ? [] : [{ organization_id: organizationId, can_upload_policy: false }])
          case "/rest/v1/rpc/search_enterprise_chunks":
            assert.equal(url.searchParams.get("select"), "id,content")
            assert.equal(JSON.parse(String(init?.body)).target_organization_id, organizationId)
            return Response.json(scenario.empty ? [] : [{ id: chunkId, content: "Authorized evidence", metadata: { filename: "private.pdf" } }])
          case "/rest/v1/rpc/enterprise_chunks_still_visible":
            assert.deepEqual(JSON.parse(String(init?.body)), { target_organization_id: organizationId, chunk_ids: [chunkId] })
            return Response.json(!scenario.revoked)
          case "/rest/v1/rpc/enterprise_fallback_documents":
            assert.deepEqual(JSON.parse(String(init?.body)), { target_organization_id: organizationId })
            if (scenario.unavailable) return Response.json({ code: "PGRST202" }, { status: 404 })
            return Response.json([
              { code: "D07", own_department: true },
              { code: "D01", own_department: false },
              { code: "D02", own_department: false },
              { code: "D08", own_department: false },
              { code: "D03", own_department: true },
              { code: "D11", own_department: true },
              { code: "D12", own_department: true },
            ])
        }
      }
      if (url.pathname.endsWith(":batchEmbedContents")) {
        return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
      }
      if (/:streamGenerateContent$|:generateContent$/.test(url.pathname)) {
        assert.ok(url.pathname.includes("/models/gemini-3.5-flash-lite:"))
        assert.match(String(init?.body), /Authorized evidence/)
        assert.match(String(init?.body), /I don't know based on the documents I can access\./)
        assert.doesNotMatch(String(init?.body), /Old revoked answer|private\.pdf/)
        const text = scenario.refusal ?? (scenario.invalid ? "Unverified output [Chunk 99]." : "Use the documented setting [Chunk 1].")
        const data = { candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } }
        return scenario.stream
          ? new Response("data: " + JSON.stringify(data) + "\n\n", { headers: { "Content-Type": "text/event-stream" } })
          : Response.json(data)
      }
      throw new Error("Unexpected request: " + url.pathname)
    })
    const response = await POST(new Request("https://app.invalid/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token", "x-eval-mode": "true" },
      body: JSON.stringify({ organizationId, query: "Question", stream: scenario.stream,
        messages: [{ role: "assistant", content: "Old revoked answer" }] }),
    }))
    if (scenario.denied) {
      assert.equal(response.status, 404)
      assert.deepEqual(calls, ["/auth/v1/user", "/rest/v1/rpc/enterprise_copilot_context"])
      return
    }
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("x-interaction-id"), null)
    const expected = scenario.answer ?? ENTERPRISE_NO_EVIDENCE
    const expectedQuestions = scenario.answer || scenario.unavailable ? undefined : [
      "What does the Design Handoff and Accessibility Standard require for handoff to Engineering?",
      "What are the general employee responsibilities in the Employee Handbook?",
      "How do I request leave under the Leave and Attendance Policy?",
      "How do I submit an equipment or service request?",
    ]
    if (scenario.stream) {
      const events: ChatEvent[] = []
      const wire = response.clone().text()
      await readChatStream(response, event => events.push(event))
      const metadata = events[0]
      assert.ok(metadata.type === "metadata")
      assert.equal(metadata.interactionId, undefined)
      assert.deepEqual(metadata.citations.map(c => c.id), scenario.answer ? [chunkId] : [])
      assert.equal(events.filter(event => event.type === "text").map(event => event.text).join(""), expected)
      assert.deepEqual(events.find(event => event.type === "finish")?.fallbackQuestions, expectedQuestions)
      assert.doesNotMatch(await wire, /Old revoked answer|private\.pdf|Chunk 99/)
      if (!scenario.answer) assert.doesNotMatch(await wire, /Authorized evidence/)
    } else {
      const body = await response.json()
      assert.equal(body.text, expected)
      assert.deepEqual(body.fallbackQuestions, expectedQuestions)
      assert.deepEqual(body.citations.map((c: { id: string }) => c.id), scenario.answer ? [chunkId] : [])
      if (!scenario.answer) assert.equal(body.context, "")
    }
    assert.equal(calls.some(path => path.endsWith("/interactions")), false)
    assert.equal(calls.some(path => path.endsWith("/enterprise_fallback_documents")), !scenario.answer)
    assert.equal(calls.some(path => path.endsWith("/enterprise_chunks_still_visible")), !scenario.invalid && !scenario.empty && !scenario.refusal)
    if (scenario.empty) assert.ok(!calls.some(path => /:streamGenerateContent$|:generateContent$/.test(path)))
  })
})

test("greeting handler and enterprise diagnostics preserve auth, RAG routing, and zero-Gemini greetings", async t => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://enterprise-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
    NODE_ENV: "development",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const organizationId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const chunkId = "33333333-3333-4333-8333-333333333333"

  for (const query of ["hi", "hello", "good morning"]) {
    for (const stream of [false, true]) {
      await t.test(`standalone greeting (${stream ? "SSE" : "JSON"}): ${query}`, async st => {
        const calls: string[] = []
        const logs: Array<Record<string, unknown>> = []
        st.mock.method(console, "info", (value: string) => { logs.push(JSON.parse(value)) })
        st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          calls.push(url.pathname)
          if (url.pathname === "/auth/v1/user") {
            return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
          }
          if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
            return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
          }
          throw new Error("Unexpected request: " + url.pathname)
        })
        const response = await POST(new Request("https://app.invalid/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token" },
          body: JSON.stringify({ organizationId, query, stream }),
        }))
        assert.equal(response.status, 200)
        assert.deepEqual(calls, ["/auth/v1/user", "/rest/v1/rpc/enterprise_copilot_context"])
        if (stream) {
          const events: ChatEvent[] = []
          await readChatStream(response, event => events.push(event))
          assert.deepEqual(events.map(e => e.type), ["metadata", "text", "finish"])
          assert.equal(events[0]?.type === "metadata" ? events[0].citations.length : -1, 0)
          assert.equal(events.filter(e => e.type === "text").map(e => e.text).join(""), GREETING_RESPONSE)
        } else {
          const body = await response.json()
          assert.equal(body.text, GREETING_RESPONSE)
          assert.deepEqual(body.citations, [])
        }
        await new Promise<void>(resolve => setImmediate(resolve))
        assert.equal(logs[0]?.retrieved_chunks_found, false)
        assert.equal(logs[0]?.retrieved_chunk_count, 0)
      })
    }
  }

  await t.test("unauthenticated greeting still rejects with 401 before greeting handler", async st => {
    st.mock.method(console, "info", () => {})
    st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ message: "Unauthorized" }, { status: 401 })
      }
      throw new Error("Unexpected request: " + url.pathname)
    })
    const response = await POST(new Request("https://app.invalid/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-token" },
      body: JSON.stringify({ organizationId, query: "hi", stream: false }),
    }))
    assert.equal(response.status, 401)
    await new Promise<void>(resolve => setImmediate(resolve))
  })

  await t.test("unauthenticated identity question rejects with 401 before handler", async st => {
    st.mock.method(console, "info", () => {})
    st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ message: "Unauthorized" }, { status: 401 })
      }
      throw new Error("Unexpected request: " + url.pathname)
    })
    const response = await POST(new Request("https://app.invalid/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-token" },
      body: JSON.stringify({ organizationId, query: "who are you?", stream: false }),
    }))
    assert.equal(response.status, 401)
    await new Promise<void>(resolve => setImmediate(resolve))
  })

  for (const item of [
    { query: "who are you?", intent: "identity" as const },
    { query: "what are you?", intent: "identity" as const },
    { query: "what can you do?", intent: "capability" as const },
    { query: "how can you help me?", intent: "capability" as const },
  ]) {
    for (const scenario of [
      { label: "db=true, meta=false", dbAccess: { enabled: true }, metaJira: false, active: true, expectJira: true },
      { label: "db=false, meta=true", dbAccess: { enabled: false }, metaJira: true, active: true, expectJira: false },
      { label: "db=null, meta=true", dbAccess: null, metaJira: true, active: true, expectJira: false },
      { label: "db=error", dbStatus: 500, metaJira: true, active: true, expectJira: false },
      { label: "inactive personal", dbAccess: { enabled: true }, metaJira: true, active: false, personal: true, expectJira: false },
    ]) {
      for (const stream of [false, true]) {
        await t.test(`deterministic ${item.intent} (${stream ? "SSE" : "JSON"}, ${scenario.label}): ${item.query}`, async st => {
          const calls: string[] = []
          const logs: Array<Record<string, unknown>> = []
          st.mock.method(console, "info", (value: string) => { logs.push(JSON.parse(value)) })
          st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
            const url = new URL(input instanceof Request ? input.url : String(input))
            calls.push(url.pathname)
            if (url.pathname === "/auth/v1/user") {
              return Response.json({
                id: userId,
                aud: "authenticated",
                role: "authenticated",
                user_metadata: { demo_jira_access: scenario.metaJira },
              })
            }
            if (url.pathname === "/rest/v1/projects") {
              return Response.json([{ id: chunkId, user_id: userId, name: "Personal" }])
            }
            if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
              return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
            }
            if (url.pathname === "/rest/v1/rpc/enterprise_account_status") {
              return Response.json([{ organization_id: organizationId, role: "employee", is_active: scenario.active }])
            }
            if (url.pathname === "/rest/v1/demo_jira_access") {
              if (scenario.dbStatus) {
                return Response.json({ message: "DB lookup failed" }, { status: scenario.dbStatus })
              }
              return Response.json(scenario.dbAccess)
            }
            throw new Error("Unexpected request: " + url.pathname)
          })

          const expectedText = item.intent === "identity"
            ? (scenario.expectJira ? IDENTITY_RESPONSE_WITH_JIRA : IDENTITY_RESPONSE_WITHOUT_JIRA)
            : (scenario.expectJira ? CAPABILITY_RESPONSE_WITH_JIRA : CAPABILITY_RESPONSE_WITHOUT_JIRA)

          const bodyPayload = scenario.personal
            ? { projectId: chunkId, query: item.query, stream }
            : { organizationId, query: item.query, stream }

          const response = await POST(new Request("https://app.invalid/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token" },
            body: JSON.stringify(bodyPayload),
          }))
          assert.equal(response.status, 200)
          assert.ok(calls.includes("/rest/v1/demo_jira_access"))

          if (stream) {
            const events: ChatEvent[] = []
            await readChatStream(response, event => events.push(event))
            assert.deepEqual(events.map(e => e.type), ["metadata", "text", "finish"])
            assert.equal(events[0]?.type === "metadata" ? events[0].citations.length : -1, 0)
            assert.equal(events.filter(e => e.type === "text").map(e => e.text).join(""), expectedText)
          } else {
            const body = await response.json()
            assert.equal(body.text, expectedText)
            assert.deepEqual(body.citations, [])
            assert.deepEqual(body.retrieved_chunks, [])
          }
          await new Promise<void>(resolve => setImmediate(resolve))
          assert.equal(logs[0]?.retrieved_chunks_found, false)
          assert.equal(logs[0]?.retrieved_chunk_count, 0)
        })
      }
    }
  }

  for (const scenario of [
    {
      name: "mixed query: hi, summarize D01 -> normal authorized RAG path",
      query: "hi, summarize D01",
      chunks: [{ id: chunkId, content: "D01 Employee Handbook applies to all active employees." }],
      modelText: "D01 is the Employee Handbook for all active employees [Chunk 1].",
      visible: true,
      expectedText: "D01 is the Employee Handbook for all active employees [Chunk 1].",
      expectedReason: "none",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
    {
      name: "mixed query: who are you? summarize D01 -> normal authorized RAG path",
      query: "who are you? summarize D01",
      chunks: [{ id: chunkId, content: "D01 Employee Handbook applies to all active employees." }],
      modelText: "D01 is the Employee Handbook for all active employees [Chunk 1].",
      visible: true,
      expectedText: "D01 is the Employee Handbook for all active employees [Chunk 1].",
      expectedReason: "none",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
    {
      name: "mixed query: what can you do with D11? -> restricted refusal in RAG path",
      query: "what can you do with D11?",
      chunks: [],
      modelText: "",
      visible: true,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedReason: "no_retrieved_chunks",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
    {
      name: "negative case: who am I? -> not intercepted by deterministic handler, goes to RAG",
      query: "who am I?",
      chunks: [],
      modelText: "",
      visible: true,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedReason: "no_retrieved_chunks",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
    {
      name: "mixed query: hello what is D03? -> normal authorized RAG path",
      query: "hello what is D03?",
      chunks: [{ id: chunkId, content: "D03 Compensation policy text." }],
      modelText: "D03 covers compensation administration [Chunk 1].",
      visible: true,
      expectedText: "D03 covers compensation administration [Chunk 1].",
      expectedReason: "none",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
    {
      name: "mixed query: hi D11 -> never bypasses authorization when restricted",
      query: "hi D11",
      chunks: [],
      modelText: "",
      visible: true,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedReason: "no_retrieved_chunks",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
    {
      name: "diagnostic: model refusal on retrieved chunks",
      query: "summarize d01 document",
      chunks: [{ id: chunkId, content: "D01 excerpt" }],
      modelText: ENTERPRISE_NO_EVIDENCE,
      visible: true,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedReason: "model_refusal",
      expectedRefusal: true,
      expectedCitationFail: false,
    },
    {
      name: "diagnostic: invalid citations on retrieved chunks",
      query: "summarize d01 document",
      chunks: [{ id: chunkId, content: "D01 excerpt" }],
      modelText: "Uncited summary of D01.",
      visible: true,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedReason: "invalid_citations",
      expectedRefusal: false,
      expectedCitationFail: true,
    },
    {
      name: "diagnostic: visibility recheck failed",
      query: "summarize d01 document",
      chunks: [{ id: chunkId, content: "D01 excerpt" }],
      modelText: "Cited summary [Chunk 1].",
      visible: false,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedReason: "visibility_recheck_failed",
      expectedRefusal: false,
      expectedCitationFail: false,
    },
  ]) {
    await t.test(scenario.name, async st => {
      const logs: Array<Record<string, unknown>> = []
      st.mock.method(console, "info", (value: string) => { logs.push(JSON.parse(value)) })
      st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname === "/auth/v1/user") {
          return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
          return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
        }
        if (url.pathname === "/rest/v1/rpc/search_enterprise_chunks") {
          return Response.json(scenario.chunks)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_chunks_still_visible") {
          return Response.json(scenario.visible)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_fallback_documents") {
          return Response.json([])
        }
        if (url.pathname.endsWith(":batchEmbedContents")) {
          return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
        }
        if (url.pathname.endsWith(":generateContent")) {
          return Response.json({
            candidates: [{ index: 0, content: { role: "model", parts: [{ text: scenario.modelText }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          })
        }
        throw new Error("Unexpected request: " + url.pathname)
      })
      const response = await POST(new Request("https://app.invalid/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token" },
        body: JSON.stringify({ organizationId, query: scenario.query, stream: false }),
      }))
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.text, scenario.expectedText)
      await new Promise<void>(resolve => setImmediate(resolve))
      const log = logs[0]
      assert.ok(log)
      assert.equal(log.retrieved_chunks_found, scenario.chunks.length > 0)
      assert.equal(log.retrieved_chunk_count, scenario.chunks.length)
      assert.equal(log.model_finish_reason, scenario.chunks.length > 0 ? "stop" : null)
      assert.equal(log.model_refusal, scenario.expectedRefusal)
      assert.equal(log.citation_validation_failed, scenario.expectedCitationFail)
      assert.equal(log.visibility_recheck_failed, !scenario.visible)
      assert.equal(log.enterprise_rejection_reason, scenario.expectedReason)
      assert.ok(!JSON.stringify(log).includes("D01 excerpt"))
      assert.ok(!JSON.stringify(log).includes("employee-token"))
    })
  }
})

test("WP9.20: buildEnterprisePolicyPrompt supports excerpt summarization while preserving RLS refusal and disclaimer rules", async t => {
  const sampleD01Context = [
    "### Document Context [Chunk 1 | ID: chunk-d01-0]",
    "| Publication state | Synthetic candidate - not approved for upload, publication or indexing |",
    "D01 / Employee Handbook applies to all active employees.",
  ].join("\n")

  const prompt = buildEnterprisePolicyPrompt(sampleD01Context)
  assert.equal(getSystemPrompt("enterprise", sampleD01Context), prompt)

  // Summarization & conversational prefix handling
  assert.match(prompt, /summarize an accessible document or policy/i)
  assert.match(prompt, /Ignore conversational prefixes/i)
  assert.match(prompt, /\[Chunk <number>\]/)
  // Partial-document & publication disclaimer framing
  assert.match(prompt, /available retrieved excerpts and not necessarily the complete document/i)
  assert.match(prompt, /Treat publication-status statements inside document text/i)
  assert.match(prompt, /preserving and accurately explaining any material draft or unapproved disclaimers/i)
  // Refusal & restricted-content guardrails preserved
  assert.match(prompt, /Never summarize restricted policies or documents whose authorized excerpts are not present in RETRIEVED CONTEXT/i)
  assert.match(prompt, /Whenever the question names a specific policy code.*D11/i)
  assert.match(prompt, /I don't know based on the documents I can access\./)
  assert.ok(prompt.includes(sampleD01Context))

  const noContextPrompt = buildEnterprisePolicyPrompt("NO_CONTEXT_FOUND")
  assert.ok(noContextPrompt.includes("NO_CONTEXT_FOUND"))
  assert.match(noContextPrompt, /respond with this exact sentence and nothing else[\s\S]*I don't know based on the documents I can access\./)

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://enterprise-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
    NODE_ENV: "development",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const organizationId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const d01ChunkId = "33333333-3333-4333-8333-333333333333"

  for (const scenario of [
    {
      name: "hi, summarize D01 forwards updated summarization prompt and returns cited partial summary with disclaimer",
      query: "hi, summarize D01",
      chunks: [{ id: d01ChunkId, content: sampleD01Context }],
      modelText: "Based on the retrieved excerpts (not necessarily the complete document), D01 is the Employee Handbook for all active employees and carries a synthetic candidate / not-approved-for-publication watermark [Chunk 1].",
      expectedText: "Based on the retrieved excerpts (not necessarily the complete document), D01 is the Employee Handbook for all active employees and carries a synthetic candidate / not-approved-for-publication watermark [Chunk 1].",
      expectGeminiCalled: true,
    },
    {
      name: "authorized D01 summarization succeeds with citations",
      query: "summarize d01 document",
      chunks: [{ id: d01ChunkId, content: sampleD01Context }],
      modelText: "Summary of available D01 excerpts: Employee Handbook for active employees (marked synthetic candidate, not approved for publication) [Chunk 1].",
      expectedText: "Summary of available D01 excerpts: Employee Handbook for active employees (marked synthetic candidate, not approved for publication) [Chunk 1].",
      expectGeminiCalled: true,
    },
    {
      name: "unauthorized D11 request returns exact refusal when RLS returns no D11 chunks",
      query: "Summarize D11 confidential budget approval",
      chunks: [],
      modelText: "",
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectGeminiCalled: false,
    },
    {
      name: "no-evidence abstention on unrelated question returns exact refusal",
      query: "What is our Mars office cafeteria menu?",
      chunks: [],
      modelText: "",
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectGeminiCalled: false,
    },
  ]) {
    await t.test(scenario.name, async st => {
      st.mock.method(console, "info", () => {})
      let capturedSystemPrompt = ""
      let geminiCalls = 0
      st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname === "/auth/v1/user") {
          return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
          return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
        }
        if (url.pathname === "/rest/v1/rpc/search_enterprise_chunks") {
          return Response.json(scenario.chunks)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_chunks_still_visible") {
          return Response.json(true)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_fallback_documents") {
          return Response.json([])
        }
        if (url.pathname.endsWith(":batchEmbedContents")) {
          return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
        }
        if (url.pathname.endsWith(":generateContent")) {
          geminiCalls++
          const payload = JSON.parse(String(init?.body || "{}"))
          capturedSystemPrompt = JSON.stringify(payload)
          return Response.json({
            candidates: [{ index: 0, content: { role: "model", parts: [{ text: scenario.modelText }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          })
        }
        throw new Error("Unexpected request: " + url.pathname)
      })

      const response = await POST(new Request("https://app.invalid/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token" },
        body: JSON.stringify({ organizationId, query: scenario.query, stream: false }),
      }))
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.text, scenario.expectedText)
      assert.equal(geminiCalls, scenario.expectGeminiCalled ? 1 : 0)
      if (scenario.expectGeminiCalled) {
        assert.match(capturedSystemPrompt, /Ignore conversational prefixes/)
        assert.match(capturedSystemPrompt, /available retrieved excerpts and not necessarily the complete document/)
        assert.match(capturedSystemPrompt, /Treat publication-status statements inside document text/)
      } else {
        assert.deepEqual(body.citations, [])
      }
      await new Promise<void>(resolve => setImmediate(resolve))
    })
  }
})

test("WP9.25: Enterprise answer length boundary allows 3400 and 4000 chars, rejects 4001 safely without leaking context, and preserves E044/E045 refusals", async t => {
  assert.equal(MAX_ANSWER_CHARS, 4000)
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://enterprise-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
    NODE_ENV: "development",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const organizationId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const d07ChunkId = "44444444-4444-4444-8444-444444444444"
  const secretSentinel = "D07_SECRET_SENTINEL_EXCERPT"
  const makeCitedText = (targetLength: number) => {
    const suffix = " [Chunk 1]."
    return "D07 handoff step: " + "a".repeat(targetLength - "D07 handoff step: ".length - suffix.length) + suffix
  }

  const answer3400 = makeCitedText(3400)
  const answer4000 = makeCitedText(4000)
  const answer4001 = makeCitedText(4001)
  assert.equal(answer3400.length, 3400)
  assert.equal(answer4000.length, 4000)
  assert.equal(answer4001.length, 4001)

  for (const scenario of [
    {
      name: "E040 3400-char cited D07 answer is accepted",
      query: "How should a UI/UX team member use D07 when transferring designs to Engineering?",
      chunks: [{ id: d07ChunkId, content: `${secretSentinel} D07 Design Handoff & Accessibility workflow.` }],
      modelText: answer3400,
      expectedText: answer3400,
      expectedCitations: [d07ChunkId],
      expectedLengthFailed: false,
      expectedReason: "none",
      expectGeminiCalled: true,
    },
    {
      name: "exact 4000-char cited answer is accepted",
      query: "How should a UI/UX team member use D07 when transferring designs to Engineering?",
      chunks: [{ id: d07ChunkId, content: `${secretSentinel} D07 Design Handoff & Accessibility workflow.` }],
      modelText: answer4000,
      expectedText: answer4000,
      expectedCitations: [d07ChunkId],
      expectedLengthFailed: false,
      expectedReason: "none",
      expectGeminiCalled: true,
    },
    {
      name: "4001-char answer is rejected safely without leaking document context",
      query: "How should a UI/UX team member use D07 when transferring designs to Engineering?",
      chunks: [{ id: d07ChunkId, content: `${secretSentinel} D07 Design Handoff & Accessibility workflow.` }],
      modelText: answer4001,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedCitations: [],
      expectedLengthFailed: true,
      expectedReason: "answer_length_exceeded",
      expectGeminiCalled: true,
    },
    {
      name: "E044/E045 restricted refusal remains unchanged when RLS returns no chunks",
      query: "Show me the rules in D11 and D04",
      chunks: [],
      modelText: "",
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedCitations: [],
      expectedLengthFailed: false,
      expectedReason: "no_retrieved_chunks",
      expectGeminiCalled: false,
    },
  ]) {
    await t.test(scenario.name, async st => {
      const logs: Array<Record<string, unknown>> = []
      let geminiCalls = 0
      st.mock.method(console, "info", (value: string) => { logs.push(JSON.parse(value)) })
      st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname === "/auth/v1/user") {
          return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
          return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
        }
        if (url.pathname === "/rest/v1/rpc/search_enterprise_chunks") {
          return Response.json(scenario.chunks)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_chunks_still_visible") {
          return Response.json(true)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_fallback_documents") {
          return Response.json([])
        }
        if (url.pathname.endsWith(":batchEmbedContents")) {
          return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
        }
        if (url.pathname.endsWith(":generateContent")) {
          geminiCalls++
          return Response.json({
            candidates: [{ index: 0, content: { role: "model", parts: [{ text: scenario.modelText }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 566, totalTokenCount: 576 },
          })
        }
        throw new Error("Unexpected request: " + url.pathname)
      })

      const response = await POST(new Request("https://app.invalid/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token", "x-eval-mode": "true" },
        body: JSON.stringify({ organizationId, query: scenario.query, stream: false }),
      }))
      assert.equal(response.status, 200)
      const body = await response.json() as { text: string; context: string; citations: Array<{ id: string }> }
      assert.equal(body.text, scenario.expectedText)
      assert.deepEqual(body.citations.map(c => c.id), scenario.expectedCitations)
      assert.equal(geminiCalls, scenario.expectGeminiCalled ? 1 : 0)
      if (scenario.expectedReason !== "none") {
        assert.equal(body.context, "")
        assert.ok(!JSON.stringify(body).includes(secretSentinel))
      }
      await new Promise<void>(resolve => setImmediate(resolve))
      const log = logs[0]
      assert.ok(log)
      assert.equal(log.answer_length_failed, scenario.expectedLengthFailed)
      assert.equal(log.enterprise_rejection_reason, scenario.expectedReason)
      assert.ok(!JSON.stringify(log).includes(secretSentinel))
    })
  }
})

test("WP9.26: JSON and streaming generation use 1000 maxOutputTokens while keeping length/truncation/authz protections intact", async t => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://enterprise-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
    NODE_ENV: "development",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const organizationId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const d07ChunkId = "44444444-4444-4444-8444-444444444444"
  const secretSentinel = "RESTRICTED_SENTINEL_DO_NOT_LEAK"
  const valid3400 = "D07 workflow summary: " + "a".repeat(3400 - "D07 workflow summary: ".length - " [Chunk 1].".length) + " [Chunk 1]."
  assert.equal(valid3400.length, 3400)

  for (const stream of [false, true]) {
    for (const scenario of [
      {
        name: `${stream ? "SSE" : "JSON"}: STOP complete answer <= 4000 chars passes with 1000 maxOutputTokens`,
        finishReason: "STOP",
        modelText: valid3400,
        chunks: [{ id: d07ChunkId, content: `${secretSentinel} D07 handoff procedure.` }],
        expectOk: true,
        expectStatus: 200,
        expectReason: "none",
      },
      {
        name: `${stream ? "SSE" : "JSON"}: MAX_TOKENS (finishReason='length') remains rejected without leaking chunk text`,
        finishReason: "MAX_TOKENS",
        modelText: `Partial leaked prefix ${secretSentinel} [Chunk 1]`,
        chunks: [{ id: d07ChunkId, content: `${secretSentinel} D07 handoff procedure.` }],
        expectOk: false,
        expectStatus: 500,
        expectReason: "incomplete_finish_reason",
      },
      {
        name: `${stream ? "SSE" : "JSON"}: empty retrieval (E044/E045) refuses without invoking Gemini`,
        finishReason: "STOP",
        modelText: "",
        chunks: [],
        expectOk: true,
        expectStatus: 200,
        expectReason: "no_retrieved_chunks",
      },
    ]) {
      await t.test(scenario.name, async st => {
        const logs: Array<Record<string, unknown>> = []
        const seenMaxTokens: number[] = []
        st.mock.method(console, "info", (value: string) => { logs.push(JSON.parse(value)) })
        st.mock.method(console, "error", () => {})
        st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          if (url.pathname === "/auth/v1/user") {
            return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
          }
          if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
            return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
          }
          if (url.pathname === "/rest/v1/rpc/search_enterprise_chunks") {
            return Response.json(scenario.chunks)
          }
          if (url.pathname === "/rest/v1/rpc/enterprise_chunks_still_visible") {
            return Response.json(true)
          }
          if (url.pathname === "/rest/v1/rpc/enterprise_fallback_documents") {
            return Response.json([])
          }
          if (url.pathname.endsWith(":batchEmbedContents")) {
            return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
          }
          if (url.pathname.endsWith(":generateContent") || url.pathname.endsWith(":streamGenerateContent")) {
            const reqBody = JSON.parse(String(init?.body || "{}")) as { generationConfig?: { maxOutputTokens?: number } }
            seenMaxTokens.push(reqBody.generationConfig?.maxOutputTokens ?? -1)
            const payload = {
              candidates: [{ index: 0, content: { role: "model", parts: [{ text: scenario.modelText }] }, finishReason: scenario.finishReason }],
              usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 746, totalTokenCount: 846 },
            }
            return url.pathname.endsWith(":streamGenerateContent")
              ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "Content-Type": "text/event-stream" } })
              : Response.json(payload)
          }
          throw new Error("Unexpected request: " + url.pathname)
        })

        const response = await POST(new Request("https://app.invalid/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token", "x-eval-mode": "true" },
          body: JSON.stringify({ organizationId, query: "How should a UI/UX team member use D07 when transferring designs to Engineering?", stream }),
        }))

        if (!stream) {
          assert.equal(response.status, scenario.expectStatus)
          const raw = await response.text()
          if (scenario.chunks.length > 0) {
            assert.deepEqual(seenMaxTokens, [1000])
          } else {
            assert.deepEqual(seenMaxTokens, [])
          }
          if (!scenario.expectOk || scenario.chunks.length === 0) {
            assert.ok(!raw.includes(secretSentinel))
          }
          if (scenario.expectOk) {
            const parsed = JSON.parse(raw) as { text: string }
            assert.equal(parsed.text, scenario.chunks.length ? valid3400 : ENTERPRISE_NO_EVIDENCE)
          }
        } else {
          assert.equal(response.status, 200)
          const wirePromise = response.clone().text()
          const events: ChatEvent[] = []
          const reading = readChatStream(response, e => events.push(e))
          if (scenario.expectOk) {
            await reading
            const text = events.filter(e => e.type === "text").map(e => e.text).join("")
            assert.equal(text, scenario.chunks.length ? valid3400 : ENTERPRISE_NO_EVIDENCE)
          } else {
            await assert.rejects(reading, /could not be completed/)
            assert.equal(events.some(e => e.type === "text"), false)
          }
          const raw = await wirePromise
          if (!scenario.expectOk || scenario.chunks.length === 0) {
            assert.ok(!raw.includes(secretSentinel))
          }
          if (scenario.chunks.length > 0) {
            assert.deepEqual(seenMaxTokens, [1000])
          } else {
            assert.deepEqual(seenMaxTokens, [])
          }
        }

        await new Promise<void>(resolve => setImmediate(resolve))
        const log = logs[0]
        assert.ok(log)
        assert.equal(log.enterprise_rejection_reason, scenario.expectReason)
        if (!scenario.expectOk) {
          assert.equal(log.model_finish_reason, "length")
          assert.equal(log.failure_stage, "answer_validation")
          assert.equal(log.failure_category, "generation_incomplete")
        }
        assert.ok(!JSON.stringify(log).includes(secretSentinel))
      })
    }
  }
})

test("WP9.29: enterprise prompt and chat route allow cited grounded negatives while keeping unknown refusals and access boundaries", async t => {
  const sampleContext = "### Document Context [Chunk 1 | ID: chunk-policy-1]\nPlanned leave requires 5 business days notice. Internal workflow targets do not establish statutory entitlements."
  const prompt = buildEnterprisePolicyPrompt(sampleContext)
  assert.match(prompt, /explicitly establish that a requested rule, figure, quota, entitlement, or legal obligation is not established or does not apply/i)
  assert.match(prompt, /explain that documented absence directly with supporting \[Chunk <number>\] citations/i)
  assert.match(prompt, /never treating synthetic or internal company policies as statutory law/i)
  assert.match(prompt, /respond with this exact sentence and nothing else[\s\S]*I don't know based on the documents I can access\./)
  assert.doesNotMatch(prompt, /\bE048\b|statutory leave allowance/i)

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://enterprise-test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-google",
    NODE_ENV: "development",
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const organizationId = "11111111-1111-4111-8111-111111111111"
  const userId = "22222222-2222-4222-8222-222222222222"
  const policyChunkId = "55555555-5555-4555-8555-555555555555"
  const restrictedSentinel = "RESTRICTED_ADMIN_POLICY_SECRET"

  for (const scenario of [
    {
      name: "grounded negative answer with supporting citation returns cited explanation cleanly",
      query: "What is the guaranteed statutory allowance under this internal rule?",
      chunks: [{ id: policyChunkId, content: "Internal workflow targets do not establish statutory entitlements." }],
      modelText: "This internal policy does not establish statutory entitlements [Chunk 1].",
      expectGeminiCalled: true,
      expectedText: "This internal policy does not establish statutory entitlements [Chunk 1].",
      expectedCitations: [policyChunkId],
      expectedRefusal: false,
      expectedReason: "none",
    },
    {
      name: "genuine unknown request refuses cleanly without citations",
      query: "What is the company policy for off-planet commuting?",
      chunks: [{ id: policyChunkId, content: "Internal workflow targets do not establish statutory entitlements." }],
      modelText: ENTERPRISE_NO_EVIDENCE,
      expectGeminiCalled: true,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedCitations: [] as string[],
      expectedRefusal: true,
      expectedReason: "model_refusal",
    },
    {
      name: "supported policy question continues answering with valid [Chunk N] citations",
      query: "How much notice is required for a planned absence?",
      chunks: [{ id: policyChunkId, content: "Submit planned absence requests at least 5 business days in advance." }],
      modelText: "Submit planned absence requests at least 5 business days in advance [Chunk 1].",
      expectGeminiCalled: true,
      expectedText: "Submit planned absence requests at least 5 business days in advance [Chunk 1].",
      expectedCitations: [policyChunkId],
      expectedRefusal: false,
      expectedReason: "none",
    },
    {
      name: "unauthorized document request refuses at retrieval boundary without invoking Gemini",
      query: "Summarize the restricted finance budget policy.",
      chunks: [] as Array<{ id: string; content: string }>,
      modelText: "",
      expectGeminiCalled: false,
      expectedText: ENTERPRISE_NO_EVIDENCE,
      expectedCitations: [] as string[],
      expectedRefusal: true,
      expectedReason: "no_retrieved_chunks",
    },
  ]) {
    await t.test(scenario.name, async st => {
      const logs: Array<Record<string, unknown>> = []
      const seenSystemPrompts: string[] = []
      let geminiCalls = 0
      st.mock.method(console, "info", (value: string) => { logs.push(JSON.parse(value)) })
      st.mock.method(console, "error", () => {})
      st.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.pathname === "/auth/v1/user") {
          return Response.json({ id: userId, aud: "authenticated", role: "authenticated" })
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_copilot_context") {
          return Response.json([{ organization_id: organizationId, can_upload_policy: false }])
        }
        if (url.pathname === "/rest/v1/rpc/search_enterprise_chunks") {
          return Response.json(scenario.chunks)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_chunks_still_visible") {
          return Response.json(true)
        }
        if (url.pathname === "/rest/v1/rpc/enterprise_fallback_documents") {
          return Response.json([])
        }
        if (url.pathname.endsWith(":batchEmbedContents")) {
          return Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })
        }
        if (url.pathname.endsWith(":generateContent")) {
          geminiCalls += 1
          const reqBody = JSON.parse(String(init?.body || "{}")) as {
            systemInstruction?: { parts?: Array<{ text?: string }> }
          }
          seenSystemPrompts.push(reqBody.systemInstruction?.parts?.map(part => part.text ?? "").join("") ?? "")
          return Response.json({
            candidates: [{ index: 0, content: { role: "model", parts: [{ text: scenario.modelText }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          })
        }
        throw new Error("Unexpected request: " + url.pathname)
      })

      const response = await POST(new Request("https://app.invalid/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer employee-token" },
        body: JSON.stringify({ organizationId, query: scenario.query, stream: false }),
      }))
      assert.equal(response.status, 200)
      const body = await response.json() as {
        text: string
        context: string
        citations: Array<{ index: number; id: string }>
      }
      assert.equal(body.text, scenario.expectedText)
      assert.deepEqual(body.citations.map(c => c.id), scenario.expectedCitations)
      assert.equal(geminiCalls, scenario.expectGeminiCalled ? 1 : 0)
      if (scenario.expectGeminiCalled) {
        assert.match(seenSystemPrompts[0], /explicitly establish that a requested rule, figure, quota, entitlement, or legal obligation is not established or does not apply/i)
      }
      if (scenario.expectedReason !== "none") {
        assert.equal(body.context, "")
        assert.ok(!JSON.stringify(body).includes(restrictedSentinel))
      }
      await new Promise<void>(resolve => setImmediate(resolve))
      const log = logs[0]
      assert.ok(log)
      assert.equal(log.model_refusal, scenario.expectedRefusal && scenario.expectGeminiCalled)
      assert.equal(log.citation_validation_failed, false)
      assert.equal(log.enterprise_rejection_reason, scenario.expectedReason)
      assert.ok(!JSON.stringify(log).includes(restrictedSentinel))
    })
  }
})
