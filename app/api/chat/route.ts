import { google } from '@ai-sdk/google';
import { APICallError, streamText, generateText, type LanguageModelUsage } from 'ai';
import { GoogleGenAI } from '@google/genai';
import { getEnterpriseCopilotContext, HttpError, isJiraAccessAvailable, requireChatProject, requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertValidAnswer, encodeEvent, ENTERPRISE_NO_EVIDENCE, isNoEvidenceAnswer, NO_EVIDENCE, MAX_ANSWER_CHARS, type ChatEvent } from '@/lib/chat-contract';
import { getSystemPrompt } from '@/lib/prompts/systemPrompt';

import {
  getDeterministicIntent,
  getDeterministicResponse,
  parseChatInput,
} from '@/lib/chat-input';
import { retrieveVerifiedChunks } from '@/lib/retrieve-chunks';
import { withTimeout } from '@/lib/with-timeout';
import { citationIndices, safeCitationPrefix, validCitations } from '@/lib/citations';
import { getEnterpriseFallbackQuestions } from '@/lib/enterprise-fallback';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request failed';
export const runtime = 'nodejs';

type FailureStage = 'stream_initialization' | 'model_stream_iteration' | 'model_stream_finalization'
  | 'answer_validation' | 'interaction_persistence' | 'sse_emission' | 'unknown';
type FailureCategory = 'provider_timeout' | 'provider_error' | 'stream_interrupted' | 'generation_incomplete'
  | 'answer_empty' | 'answer_too_long' | 'invalid_citations' | 'interaction_write_failed'
  | 'request_cancelled' | 'unknown_error';
type EnterpriseRejectionReason = 'none' | 'no_retrieved_chunks' | 'incomplete_finish_reason'
  | 'model_refusal' | 'answer_length_exceeded' | 'invalid_citations' | 'visibility_recheck_failed';

function sanitizeProviderError(error: unknown): {
  status: number | null;
  code: string | null;
  message: string | null;
} {
  if (!APICallError.isInstance(error)) {
    return { status: null, code: null, message: null };
  }
  const status = typeof error.statusCode === 'number' ? error.statusCode : null;
  let code: string | null = null;
  let rawMessage = '';
  if (typeof error.responseBody === 'string') {
    try {
      const parsed = JSON.parse(error.responseBody) as {
        error?: { code?: unknown; status?: unknown; message?: unknown };
      };
      if (typeof parsed?.error?.status === 'string' && /^[A-Z0-9_]+$/.test(parsed.error.status)) {
        code = parsed.error.status;
      } else if (typeof parsed?.error?.code === 'number') {
        code = String(parsed.error.code);
      }
      if (typeof parsed?.error?.message === 'string') {
        rawMessage = parsed.error.message;
      }
    } catch {
      // Ignore non-JSON provider error bodies
    }
  }
  if (!code && status !== null) code = String(status);
  const source = `${rawMessage} ${error.message || ''}`;
  const message = /high demand|spikes in demand|temporarily unavailable|overloaded/i.test(source)
    ? 'This model is currently experiencing high demand. Please try again later.'
    : /quota|rate limit|resource[_\s]exhausted|too many requests/i.test(source)
      ? 'Provider rate limit or quota exceeded.'
      : /deadline exceeded|timed?\s*out/i.test(source)
        ? 'Provider request timed out.'
        : /not found|not supported/i.test(source)
          ? 'Requested model or operation is not available.'
          : /permission|unauthorized|unauthenticated|api key/i.test(source)
            ? 'Provider authentication or permission failed.'
            : status !== null
              ? `Provider returned HTTP ${status}.`
              : 'Provider request failed.';
  return { status, code, message };
}

export async function POST(req: Request) {
  const reqStart = performance.now();
  const interactionId = crypto.randomUUID();
  let isEvalMode = false;
  let stage: FailureStage = 'unknown';
  let cancelled = false;
  let generationDeadline: AbortSignal | undefined;
  let generationSignal: AbortSignal | undefined;
  const failure = {
    failure_stage: null as FailureStage | null,
    failure_category: null as FailureCategory | null,
    provider_error_status: null as number | null,
    provider_error_code: null as string | null,
    provider_error_message: null as string | null,
    model_stream_completed: false,
    interaction_write_started: false,
    retrieved_chunks_found: null as boolean | null,
    model_finish_reason: null as string | null,
    model_refusal: false,
    citation_validation_failed: false,
    answer_length_failed: false,
    visibility_recheck_failed: false,
    enterprise_rejection_reason: null as EnterpriseRejectionReason | null,
  };
  const recordFailure = (failedStage: FailureStage, error: unknown, category: FailureCategory =
    failedStage === 'interaction_persistence' ? 'interaction_write_failed'
      : failedStage === 'model_stream_iteration' ? 'stream_interrupted' : 'unknown_error') => {
    if (failure.failure_stage !== null) return;
    const modelStage = failedStage === 'stream_initialization' || failedStage === 'model_stream_iteration'
      || failedStage === 'model_stream_finalization';
    failure.failure_stage = failedStage;
    failure.failure_category = modelStage && generationDeadline?.aborted && generationSignal?.reason === generationDeadline.reason
      ? 'provider_timeout'
      : (modelStage && (cancelled || req.signal.aborted)) || (req.signal.aborted && error === req.signal.reason) ? 'request_cancelled'
      : APICallError.isInstance(error) ? 'provider_error' : category;
    if (failure.failure_category === 'provider_error') {
      const sanitized = sanitizeProviderError(error);
      failure.provider_error_status = sanitized.status;
      failure.provider_error_code = sanitized.code;
      failure.provider_error_message = sanitized.message;
    }
  };

  const telemetry = {
    request_parse_ms: null as number | null,
    auth_ms: null as number | null,
    rrf_rpc_ms: null as number | null,
    chunk_verify_ms: null as number | null,
    prompt_build_ms: null as number | null,
    model_first_text_ms: null as number | null,
    server_ttft_ms: null as number | null,
    interaction_write_ms: null as number | null,
    server_finish_ready_ms: null as number | null,
    request_mode: null as 'stream' | 'json' | null,
    model_id: null as string | null,
    retrieved_chunk_count: null as number | null,
    context_chars: null as number | null,
    embedding_ms: 0,
    retrieval_ms: 0,
    ttft_ms: 0,
    generation_ms: 0,
    total_ms: 0,
    retries: { embedding: 0, retrieval: 0, generation: 0 },
    errors: [] as string[],
    token_usage: { prompt: 0, completion: 0, total: 0 },
    tokens: { prompt: 0, completion: 0, total: 0 },
  };
  const logTiming = (status: 'success' | 'error' | 'cancelled') => {
    // In hosted previews, log only sanitized failure-stage diagnostics; never log prompts or evidence.
    if (process.env.NODE_ENV !== 'development' && status === 'success') return;
    // Errors can contain provider or document data; only a controlled category is logged.
    const { errors, ...diagnostics } = telemetry;
    const record = { type: 'rag_timing', interaction_id: interactionId, status,
      ...diagnostics, ...failure, had_first_text: telemetry.model_first_text_ms !== null,
      elapsed_ms: performance.now() - reqStart,
      error_categories: status === 'success' && !errors.length ? [] : [status === 'cancelled' ? 'cancelled' : 'request_failed'] };
    setImmediate(() => console.info(JSON.stringify(record)));
  };

  try {

    const rawBody = await req.text();
    if (rawBody.length > 40000) throw new HttpError(413, 'Request is too large.');
    let input;
    try { input = parseChatInput(JSON.parse(rawBody)); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid request.'); }
    const { projectId, organizationId, userQuery, boundedHistory } = input;
    telemetry.request_parse_ms = performance.now() - reqStart;
    const authStart = performance.now();
    const { user, supabase, enterprise } = projectId
      ? await requireChatProject(projectId, req)
      : { ...await requireUser(req, 'enterprise'), enterprise: true };
    if (organizationId && !await getEnterpriseCopilotContext(supabase, organizationId)) {
      throw new HttpError(404, 'Organization not found.');
    }
    telemetry.auth_ms = performance.now() - authStart;
    const promptVariant = req.headers.get('x-prompt-variant') || input.promptVariant;
    isEvalMode = !input.wantsStream && (input.isEvalMode || req.headers.get('x-eval-mode') === 'true');
    telemetry.request_mode = isEvalMode ? 'json' : 'stream';
    const deterministicIntent = getDeterministicIntent(userQuery);
    if (deterministicIntent) {
      const jiraEnabled = deterministicIntent === 'greeting'
        ? false
        : await isJiraAccessAvailable(supabase, organizationId);
      const deterministicResponse = getDeterministicResponse(deterministicIntent, jiraEnabled);

      telemetry.retrieved_chunk_count = 0;
      telemetry.context_chars = 0;
      failure.retrieved_chunks_found = false;
      const deterministicHeaders = {
        'Cache-Control': 'no-store',
        ...(!enterprise ? { 'x-interaction-id': interactionId } : {}),
        'x-rag-embedding-ms': '0',
        'x-rag-retrieval-ms': '0',
      };
      if (isEvalMode) {
        telemetry.ttft_ms = Math.round(performance.now() - reqStart);
        telemetry.total_ms = Math.round(performance.now() - reqStart);
        logTiming('success');
        return Response.json({
          text: deterministicResponse,
          output: deterministicResponse,
          context: '',
          citations: [],
          retrieved_chunks: [],
          ...(!enterprise ? { interactionId } : {}),
          metrics: telemetry,
        }, { headers: deterministicHeaders });
      }
      const deterministicStream = new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
        start(controller) {
          try {
            controller.enqueue(encodeEvent({ type: 'metadata', ...(!enterprise ? { interactionId } : {}), citations: [] }));
            telemetry.ttft_ms = Math.round(performance.now() - reqStart);
            telemetry.server_ttft_ms = performance.now() - reqStart;
            controller.enqueue(encodeEvent({ type: 'text', text: deterministicResponse }));
            telemetry.total_ms = Math.round(performance.now() - reqStart);
            telemetry.server_finish_ready_ms = performance.now() - reqStart;
            controller.enqueue(encodeEvent({
              type: 'finish',
              metrics: telemetry,
              ...(req.headers.get('x-eval-mode') === 'true' ? { context: '' } : {}),
            }));
            controller.close();
            logTiming('success');
          } catch (error) {
            recordFailure('sse_emission', error);
            logTiming('error');
            throw error;
          }
        },
      });
      return new Response(deterministicStream, {
        headers: { ...deterministicHeaders, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' },
      });
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    // Stage 1: Query Embedding via gemini-embedding-2 (1536d MRL)
    const tEmbedStart = performance.now();
    let queryEmbedding: number[] | undefined;
    const maxEmbedRetries = 1;

    for (let attempt = 0; attempt <= maxEmbedRetries; attempt++) {
      try {
        const embedRes = await withTimeout(
          ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: userQuery,
            config: { outputDimensionality: 1536, abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(15000)]) },
          }),
          15000,
          'Gemini Embedding API'
        );
        queryEmbedding = embedRes.embeddings?.[0]?.values;

        if (queryEmbedding && queryEmbedding.length === 1536 && queryEmbedding.every(Number.isFinite)) {
          break;
        }
      } catch (err: unknown) {
        if (attempt < maxEmbedRetries) {
          telemetry.retries.embedding++;
        } else {
          telemetry.errors.push(`Embedding: ${errorMessage(err)}`);
          throw err;
        }
      }
    }
    telemetry.embedding_ms = Math.round(performance.now() - tEmbedStart);

    if (!queryEmbedding || queryEmbedding.length !== 1536 || !queryEmbedding.every(Number.isFinite)) {
      throw new Error('Failed to generate query embedding vector');
    }

    // The authenticated search RPC applies document RLS before both rankings.
    const tRetrievalStart = performance.now();
    const relevantChunks = await retrieveVerifiedChunks(supabase, projectId, queryEmbedding, userQuery, req.signal, telemetry, enterprise, organizationId);
    telemetry.retrieval_ms = Math.round(performance.now() - tRetrievalStart);

    const promptStart = performance.now();
    const contextBlock =
      relevantChunks.length > 0
        ? relevantChunks
            .map(
              (c, index: number) =>
                `### Document Context [Chunk ${index + 1} | ID: ${c.id}]\n${c.content}`
            )
            .join('\n\n')
        : 'NO_CONTEXT_FOUND';

    const systemPrompt = getSystemPrompt(enterprise ? 'enterprise' : promptVariant, contextBlock);
    const refusalText = enterprise ? ENTERPRISE_NO_EVIDENCE : NO_EVIDENCE;
    // Previous enterprise answers may contain evidence whose grants have since expired.
    const messages = enterprise ? [{ role: 'user' as const, content: userQuery }] : boundedHistory;
    const generationModelId = process.env.CHAT_MODEL || 'gemini-3.5-flash-lite';
    telemetry.model_id = /^gemini-[a-z0-9.-]+$/.test(generationModelId) ? generationModelId : null;
    telemetry.retrieved_chunk_count = relevantChunks.length;
    failure.retrieved_chunks_found = relevantChunks.length > 0;

    let citations = relevantChunks.map((c, index: number) => ({
      id: c.id,
      index: index + 1,
      content: c.content?.slice(0, 300) || '',
      metadata: c.metadata || {},
    }));


    let contextString = relevantChunks.map((c, i: number) => `[Chunk ${i + 1}]: ${c.content}`).join('\n\n');
    const isEnterpriseRefusal = (value: string) => {
      const trimmed = value.trim();
      return isNoEvidenceAnswer(trimmed)
        || /^I don't know(?:\s+based on the documents I can access)?\.?(?:\s*\[Chunk[^\]]*\])*\s*$/i.test(trimmed);
    };
    const prepareEnterpriseAnswer = async (text: string, finishReason: string, signal: AbortSignal) => {
      if (!enterprise) return text;
      if (!relevantChunks.length) {
        failure.enterprise_rejection_reason = 'no_retrieved_chunks';
        citations = [];
        contextString = '';
        return ENTERPRISE_NO_EVIDENCE;
      }
      if (finishReason !== 'stop') {
        failure.enterprise_rejection_reason = 'incomplete_finish_reason';
        return text;
      }
      const refused = isEnterpriseRefusal(text);
      const tooLong = text.length > MAX_ANSWER_CHARS;
      const citationsValid = !refused && !tooLong && validCitations(text, citations);
      failure.model_refusal = refused;
      failure.answer_length_failed = !refused && tooLong;
      failure.citation_validation_failed = !refused && !tooLong && !citationsValid;
      if (!refused && !tooLong && citationsValid) {
        const chunkIds = relevantChunks.map(chunk => chunk.id);
        const visibility = organizationId
          ? supabase.rpc('enterprise_chunks_still_visible', { target_organization_id: organizationId, chunk_ids: chunkIds })
          : supabase.rpc('rag_chunks_still_visible', { target_project_id: projectId, chunk_ids: chunkIds });
        const { data, error } = await withTimeout(Promise.resolve(
          visibility.abortSignal(AbortSignal.any([signal, AbortSignal.timeout(5000)])),
        ), 5000, 'Evidence authorization');
        signal.throwIfAborted();
        if (error) throw new Error('Unable to verify evidence authorization.');
        if (data === true) {
          failure.enterprise_rejection_reason = 'none';
          const cited = new Set(citationIndices(text));
          citations = citations.filter(citation => cited.has(citation.index));
          return text;
        }
        failure.visibility_recheck_failed = true;
        failure.enterprise_rejection_reason = 'visibility_recheck_failed';
      } else {
        failure.enterprise_rejection_reason = refused
          ? 'model_refusal'
          : tooLong
            ? 'answer_length_exceeded'
            : 'invalid_citations';
      }
      citations = [];
      contextString = '';
      return ENTERPRISE_NO_EVIDENCE;
    };

    const finalizeAnswer = async (text: string, finishReason: string, signal = req.signal) => {
      stage = 'answer_validation';
      if (!enterprise && relevantChunks.length > 0) {
        failure.model_refusal = isNoEvidenceAnswer(text);
      }
      try {
        assertValidAnswer(text, citations, finishReason);
      } catch (error) {
        if (!enterprise) {
          failure.answer_length_failed = finishReason === 'stop' && text.length > MAX_ANSWER_CHARS;
          failure.citation_validation_failed = finishReason === 'stop'
            && error instanceof Error
            && error.message === 'Answer contains missing or invalid citations.';
        }
        recordFailure(stage, error, finishReason !== 'stop' ? 'generation_incomplete'
          : !text.trim() ? 'answer_empty' : text.length > MAX_ANSWER_CHARS ? 'answer_too_long'
          : error instanceof Error && error.message === 'Answer contains missing or invalid citations.'
            ? 'invalid_citations' : 'unknown_error');
        throw error;
      }
      telemetry.generation_ms = Math.round(performance.now() - generationStart);
      telemetry.total_ms = Math.round(performance.now() - reqStart);
      if (enterprise || !projectId) {
        signal.throwIfAborted();
        return;
      }
      const writeStart = performance.now();
      stage = 'interaction_persistence';
      const writeAbort = new AbortController();
      let rejectCancellation!: (reason: unknown) => void;
      const onAbort = () => {
        writeAbort.abort(signal.reason);
        rejectCancellation(signal.reason);
      };
      try {
        signal.throwIfAborted();
        const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
        signal.addEventListener('abort', onAbort, { once: true });
        failure.interaction_write_started = true;
        const { error } = await withTimeout(Promise.race([
          Promise.resolve(createAdminClient(enterprise ? 'enterprise' : 'personal').from('interactions').insert({
            id: interactionId, project_id: projectId.trim(), query_text: userQuery,
            user_id: user.id,
            retrieved_chunk_ids: relevantChunks.map((c) => c.id),
            response_markdown: text, latency_ms: telemetry.total_ms,
          }).abortSignal(writeAbort.signal).retry(false)),
          cancellation,
        ]), 5000, 'Interaction persistence');
        signal.throwIfAborted();
        if (error) throw new Error('Unable to save interaction.');
      } catch (error) {
        writeAbort.abort(error);
        recordFailure(stage, error, signal.aborted ? 'request_cancelled' : 'interaction_write_failed');
        throw error;
      } finally {
        signal.removeEventListener('abort', onAbort);
        telemetry.interaction_write_ms = performance.now() - writeStart;
      }
    };
    telemetry.context_chars = contextBlock.length;
    telemetry.prompt_build_ms = performance.now() - promptStart;
    const updateUsage = (u: LanguageModelUsage) => {
      telemetry.token_usage = { prompt: u.inputTokens ?? 0, completion: u.outputTokens ?? 0, total: u.totalTokens ?? 0 };
      telemetry.tokens = { ...telemetry.token_usage };
    };
    const headers = {
      'Cache-Control': 'no-store',
      ...(!enterprise ? { 'x-interaction-id': interactionId } : {}),
      'x-rag-embedding-ms': String(telemetry.embedding_ms),
      'x-rag-retrieval-ms': String(telemetry.retrieval_ms),
    };
    const generationStart = performance.now();
    const fallbackQuestionsFor = (text: string, signal: AbortSignal) =>
      organizationId && text === ENTERPRISE_NO_EVIDENCE
        ? getEnterpriseFallbackQuestions(supabase, organizationId, signal)
        : [];
    if (isEvalMode) {
      let text = refusalText;
      let finishReason = 'stop';
      if (relevantChunks.length) {
        const result = await generateText({
          model: google(generationModelId), system: systemPrompt, messages,
          maxOutputTokens: 1000, maxRetries: 0, abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(35000)]),
        });
        text = result.text;
        finishReason = result.finishReason;
        failure.model_finish_reason = finishReason;
        updateUsage(result.usage);
      }
      text = await prepareEnterpriseAnswer(text, finishReason, req.signal);
      await finalizeAnswer(text, finishReason);
      const fallbackQuestions = await fallbackQuestionsFor(text, req.signal);
      logTiming('success');
      return Response.json({ text, output: text, context: contextString, citations,
        ...(fallbackQuestions.length ? { fallbackQuestions } : {}),
        retrieved_chunks: citations.map(c => ({ id: c.id, index: c.index })),
        ...(!enterprise ? { interactionId } : {}), metrics: telemetry }, { headers });
    }

    const streamAbort = new AbortController();
    stage = 'stream_initialization';
    const stream = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; streamAbort.abort(); },
      async start(controller) {
        const send = (event: ChatEvent) => {
          if (cancelled) return;
          if (event.type === 'text' && event.text && telemetry.server_ttft_ms === null) {
            telemetry.server_ttft_ms = performance.now() - reqStart;
          }
          try {
            controller.enqueue(encodeEvent(event));
          } catch (error) {
            recordFailure('sse_emission', error);
            throw error;
          }
        };
        let succeeded = false;
        try {
          if (!enterprise) send({ type: 'metadata', interactionId, citations });
          let text = '';
          let emittedLength = 0;
          let finishReason = 'stop';
          if (!relevantChunks.length) {
            text = refusalText;
            telemetry.ttft_ms = Math.round(performance.now() - reqStart);
            if (!enterprise) {
              send({ type: 'text', text });
              emittedLength = text.length;
            }
          } else {
            const modelStart = performance.now();
            stage = 'stream_initialization';
            generationDeadline = AbortSignal.timeout(35000);
            generationSignal = AbortSignal.any([req.signal, streamAbort.signal, generationDeadline]);
            let modelStreamErrored = false;
            const result = streamText({
              model: google(generationModelId), system: systemPrompt, messages,
              maxOutputTokens: 1000, maxRetries: 0,
              abortSignal: generationSignal,
              // The SDK filters error parts out of textStream; retain their origin without raw logging.
              onError: ({ error }) => {
                modelStreamErrored = true;
                recordFailure('model_stream_iteration', error);
              },
            });
            stage = 'model_stream_iteration';
            for await (const delta of result.textStream) {
              if (text.length + delta.length > MAX_ANSWER_CHARS) {
                failure.answer_length_failed = true;
                if (enterprise) failure.enterprise_rejection_reason = 'answer_length_exceeded';
                recordFailure('answer_validation', undefined, 'answer_too_long');
                streamAbort.abort();
                throw new Error('Answer exceeds the length limit.');
              }
              if (!delta) continue;
              if (!text) {
                const firstText = performance.now();
                telemetry.ttft_ms = Math.round(firstText - reqStart);
                telemetry.model_first_text_ms = firstText - modelStart;
              }
              text += delta;
              if (!enterprise) {
                const publishable = safeCitationPrefix(text, citations);
                if (publishable.length > emittedLength) {
                  send({ type: 'text', text: publishable.slice(emittedLength) });
                  emittedLength = publishable.length;
                }
              }
            }
            stage = 'model_stream_finalization';
            updateUsage(await result.usage);
            finishReason = await result.finishReason;
            failure.model_finish_reason = finishReason;
            failure.model_stream_completed = !modelStreamErrored && !generationSignal.aborted;
          }
          const signal = AbortSignal.any([req.signal, streamAbort.signal]);
          text = await prepareEnterpriseAnswer(text, finishReason, signal);
          await finalizeAnswer(text, finishReason, signal);
          const fallbackQuestions = await fallbackQuestionsFor(text, signal);
          if (enterprise) send({ type: 'metadata', citations });
          if (text.length > emittedLength) send({ type: 'text', text: text.slice(emittedLength) });
          if (!cancelled) telemetry.server_finish_ready_ms = performance.now() - reqStart;
          send({ type: 'finish', metrics: telemetry,
            ...(fallbackQuestions.length ? { fallbackQuestions } : {}),
            ...(req.headers.get('x-eval-mode') === 'true' ? { context: contextString } : {}) });
          succeeded = true;
        } catch (error) {
          recordFailure(stage, error);
          send({ type: 'error', message: 'The answer could not be completed. Please retry.' });
        } finally {
          try {
            if (!cancelled) controller.close();
          } catch (error) {
            recordFailure('sse_emission', error);
            throw error;
          } finally {
            if ((cancelled || req.signal.aborted) && failure.failure_stage === null) recordFailure(stage, undefined, 'request_cancelled');
            logTiming(cancelled || req.signal.aborted ? 'cancelled' : succeeded && failure.failure_stage === null ? 'success' : 'error');
          }
        }
      },
    });
    return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    recordFailure(stage, error);
    logTiming(req.signal.aborted ? 'cancelled' : 'error');
    return error instanceof HttpError
      ? Response.json({ error: error.message }, { status: error.status })
      : Response.json({ error: 'The request could not be completed.' }, { status: 500 });
  }
}
