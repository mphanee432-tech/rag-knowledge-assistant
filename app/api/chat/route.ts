import { google } from '@ai-sdk/google';
import { streamText, generateText } from 'ai';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@/lib/supabase/server';
import { getSystemPrompt } from '@/lib/prompts/systemPrompt';

export const runtime = 'edge';

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY,
});

/**
 * Edge-compatible promise timeout guard.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function POST(req: Request) {
  const reqStart = Date.now();
  const interactionId = crypto.randomUUID();
  let isEvalMode = false;

  try {
    const body = await req.json().catch(() => ({}));

    // Detect evaluation mode
    isEvalMode =
      body.stream === false ||
      body.stream === 'false' ||
      req.headers.get('x-eval-mode') === 'true';

    // 1. Strict Contract: Extract projectId
    const projectId =
      body.projectId ||
      body.vars?.projectId ||
      body.project_id ||
      body.vars?.project_id;

    if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: projectId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Resolve Prompt Variant
    const promptVariant =
      req.headers.get('x-prompt-variant') ||
      body.promptVariant ||
      body.vars?.promptVariant ||
      'strict';

    // 3. Extract & Validate Query within 2,500-Character Envelope
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const validMessages = rawMessages
      .filter((m: any) => m && typeof m === 'object' && typeof m.content === 'string')
      .map((m: any) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content.trim(),
      }))
      .filter((m: any) => m.content.length > 0);

    const lastMsg = validMessages.length > 0 ? validMessages[validMessages.length - 1] : null;

    const rawUserQuery =
      body.query ||
      body.vars?.query ||
      body.prompt ||
      body.vars?.prompt ||
      body.message ||
      (lastMsg?.role === 'user' ? lastMsg.content : null);

    if (!rawUserQuery || typeof rawUserQuery !== 'string' || !rawUserQuery.trim()) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty user query in request payload' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userQuery = rawUserQuery.trim();
    if (userQuery.length > 2500) {
      return new Response(
        JSON.stringify({ error: 'Query exceeds maximum limit of 2,500 characters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(
      `[API /chat] [${isEvalMode ? 'EVAL' : 'STREAM'}] Query: "${userQuery.slice(0, 45)}..." | Project: ${projectId}`
    );

    // 4. Bounded 5-Turn Sliding Window Memory (10 messages max)
    const boundedHistory = validMessages.slice(-10);
    if (
      boundedHistory.length === 0 ||
      boundedHistory[boundedHistory.length - 1].content !== userQuery
    ) {
      boundedHistory.push({ role: 'user', content: userQuery });
    }

    // 5. Query Embedding via gemini-embedding-2 (1536d MRL) with 45s Timeout
    console.time('[API /chat] 1. Embedding');
    const embedRes = await withTimeout(
      ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: userQuery,
        config: { outputDimensionality: 1536 },
      }),
      45000,
      'Gemini Embedding API'
    );
    console.timeEnd('[API /chat] 1. Embedding');

    const queryEmbedding =
      embedRes?.embeddings?.[0]?.values ||
      (embedRes as any)?.embedding?.values ||
      (embedRes as any)?.values ||
      (Array.isArray((embedRes as any)?.embedding) ? (embedRes as any).embedding : null);

    if (!queryEmbedding) {
      throw new Error('Failed to generate query embedding vector');
    }

    // 6. Direct Supabase Hybrid Search RPC (RRF k=60) with 45s Timeout
    console.time('[API /chat] 2. Supabase RRF RPC');
    const supabase = createClient();
    const rpcPromise = Promise.resolve(
      supabase.rpc('match_chunks_hybrid_rrf', {
        query_embedding: queryEmbedding,
        query_text: userQuery,
        target_project_id: projectId.trim(),
        match_count: 8,
        rrf_k: 60,
      })
    );

    const { data: chunks, error: rpcError } = await withTimeout(
      rpcPromise,
      45000,
      'Supabase Hybrid Search RPC'
    );
    console.timeEnd('[API /chat] 2. Supabase RRF RPC');

    if (rpcError) {
      console.error('[API /chat] Supabase RRF RPC Error:', rpcError.message);
    }

    const relevantChunks = (chunks || []).filter(
      (chunk: any) => !chunk.project_id || chunk.project_id === projectId.trim()
    );

    const contextBlock =
      relevantChunks.length > 0
        ? relevantChunks
          .map(
            (c: any, index: number) =>
              `### Document Context [Chunk ${index + 1} | ID: ${c.id}]\n${c.content}`
          )
          .join('\n\n')
        : 'NO_CONTEXT_FOUND';

    // 7. Resolve System Prompt
    const systemPrompt = getSystemPrompt(promptVariant, contextBlock);

    // Generation Model: Default to stable GA gemini-3.1-flash-lite (1,500 RPD / 15-30 RPM)
    const generationModelId = process.env.CHAT_MODEL || 'gemini-3.1-flash-lite';

    // 8. Evaluation Mode: Non-Streaming JSON with 45s Timeout & Fail-Fast (maxRetries: 0)
    if (isEvalMode) {
      console.time('[API /chat] 3. Generation (Eval)');
      const { text } = await withTimeout(
        generateText({
          model: google(generationModelId),
          system: systemPrompt,
          messages: boundedHistory,
          maxTokens: 750,
          maxOutputTokens: 750,
          maxRetries: 0,
        } as any),
        45000,
        'Gemini 3.1 Flash-Lite Generation (Eval)'
      );
      console.timeEnd('[API /chat] 3. Generation (Eval)');
      console.log(`[API /chat] Eval query finished in ${Date.now() - reqStart}ms`);

      const contextString = relevantChunks
        .map((c: any, i: number) => `[Chunk ${i + 1}]: ${c.content}`)
        .join('\n\n');

      return new Response(
        JSON.stringify({
          text,
          output: text,
          context: contextString,
          retrieved_chunks: relevantChunks.map((c: any, i: number) => ({
            id: c.id,
            index: i + 1,
          })),
          interactionId,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-interaction-id': interactionId,
          },
        }
      );
    }

    // 9. Interactive UI Mode: Server-Sent Events (SSE) Stream
    console.time('[API /chat] 3. Generation (Stream)');
    const result = streamText({
      model: google(generationModelId),
      system: systemPrompt,
      messages: boundedHistory,
      maxTokens: 750,
      maxOutputTokens: 750,
      maxRetries: 2,
      onFinish: async ({ text }: { text: string }) => {
        console.timeEnd('[API /chat] 3. Generation (Stream)');
        try {
          const latencyMs = Date.now() - reqStart;
          await supabase.from('interactions').insert({
            id: interactionId,
            project_id: projectId.trim(),
            query_text: userQuery,
            retrieved_chunk_ids: relevantChunks.map((c: any) => c.id),
            response_markdown: text,
            latency_ms: latencyMs,
          });
        } catch (err) {
          console.error('[API /chat] Telemetry logging error:', err);
        }
      },
    } as any);

    return (
      (result as any).toDataStreamResponse?.({
        headers: { 'x-interaction-id': interactionId },
      }) ??
      result.toTextStreamResponse({
        headers: { 'x-interaction-id': interactionId },
      })
    );
  } catch (error: any) {
    const elapsed = Date.now() - reqStart;
    const errorMessage = error?.message || 'Internal Server Error';
    console.error(`[API /chat] Error after ${elapsed}ms:`, errorMessage);

    if (isEvalMode) {
      return new Response(
        JSON.stringify({
          error: errorMessage,
          text: `[Error: ${errorMessage}]`,
          output: `[Error: ${errorMessage}]`,
          context: '',
          interactionId,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-interaction-id': interactionId,
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: errorMessage, interactionId }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'x-interaction-id': interactionId,
        },
      }
    );
  }
}
