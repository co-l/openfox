/**
 * Pure LLM Streaming Generator
 *
 * This module provides pure generator functions that yield TurnEvents.
 * No side effects, no persistence - just transforms LLM streams to events.
 *
 * The orchestrator is responsible for:
 * - Appending events to EventStore
 * - Handling tool execution
 * - Managing session state
 */

import type {
  ToolCall,
  MessageSegment,
  MessageStats,
  StatsIdentity,
  ToolResult,
  Attachment,
  TokenUsage,
} from '../../shared/types.js'
import type { RequestContextMessage } from '../chat/request-context.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition, ReasoningEffort } from '../llm/types.js'
import { buildModelParams } from '../llm/client-pure.js'
import type { StreamTiming } from '../llm/streaming.js'
import type { TurnEvent } from '../events/types.js'
import type { RetryPatternConfig, RetryPatternMatch } from './auto-patterns.js'
import { matchRetryPatterns } from './auto-patterns.js'
import { randomUUID } from 'node:crypto'
import { buildStreamRequest } from './stream-utils.js'
import { computeAggregatedStats } from './stats.js'
import { getModelProfile } from '../llm/profiles.js'
import { getBackendCapabilities } from '../llm/backend.js'
import { logger } from '../utils/logger.js'
import type { LLMRetryPolicy } from '../runner/types.js'

// ============================================================================
// Types
// ============================================================================

export interface PureStreamOptions {
  messageId: string
  systemPrompt: string
  llmClient: LLMClientWithModel
  /** Stable session id, forwarded as x-opencode-session to opencode.ai endpoints. */
  sessionId?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    thinkingContent?: string
    toolCalls?: ToolCall[]
    toolCallId?: string
    attachments?: Attachment[]
  }>
  tools?: LLMToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
  signal?: AbortSignal | undefined
  reasoningEffort?: ReasoningEffort
  /** User-configured model settings (temperature, topP, topK, maxTokens, supportsVision, omitParams) */
  modelSettings?: ModelParams & { supportsVision?: boolean; omitParams?: string[] }
  /** Retry patterns to check mid-stream */
  retryPatterns?: RetryPatternConfig[]
  /** Set of tool names that are sub-agent aliases (e.g. "explorer").
   *  When a preparing event matches, the name is shown as "call_sub_agent"
   *  instead of the hallucinated name. */
  subAgentAliases?: Set<string>
  /** Fast-fail preflight for path-based tools (write_file, edit_file).
   *  Invoked once per tool call as soon as a complete top-level "path"
   *  argument is available. Returning an error string aborts the stream
   *  early: the result then carries a path-only tool call so the caller
   *  surfaces the error without paying for the doomed payload tokens. */
  preflight?: (path: string) => Promise<string | undefined>
}

export interface PureStreamResult {
  content: string
  thinkingContent?: string
  /** Wall-clock time spent streaming thinking deltas (ms), when the model thought. */
  thinkingDurationMs?: number
  toolCalls: ToolCall[]
  segments: MessageSegment[]
  /** Provider cache attribution is sourced from the provider response,
   *  never inferred from OpenFox's prefTokenIncrement. */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens?: number
    cachedPromptTokens?: number
    cacheWriteTokens?: number
    cacheSource?: 'provider' | 'estimated' | 'unavailable'
  }
  timing: StreamTiming
  aborted: boolean
  modelParams?: ModelParams
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter'
  /** Set when a retry pattern matched mid-stream */
  patternMatch?: RetryPatternMatch
  /** Set when the LLM stream reported an error — the call failed, so no usable usage exists */
  error?: string
}

type StreamMessageInput = {
  role: string
  content: string
  thinkingContent?: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}

export function toStreamMessages(messages: StreamMessageInput[]): PureStreamOptions['messages'] {
  return messages.map((m) => ({
    role: m.role as PureStreamOptions['messages'][0]['role'],
    content: m.content,
    ...(m.thinkingContent ? { thinkingContent: m.thinkingContent } : {}),
    ...(m.toolCalls?.length
      ? { toolCalls: m.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) }
      : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
  }))
}

export function createAssistantMessage(
  content: string,
  thinkingContent: string | undefined,
  toolCalls: ToolCall[],
): RequestContextMessage {
  return {
    role: 'assistant',
    content,
    source: 'history',
    ...(thinkingContent ? { thinkingContent } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }
}

// ============================================================================
// Helpers
// ============================================================================

function createEmptyStreamResult(
  aborted: boolean,
  modelParams: ModelParams,
  patternMatch?: RetryPatternMatch,
  error?: string,
): PureStreamResult {
  return {
    content: '',
    toolCalls: [],
    segments: [],
    usage: { promptTokens: 0, completionTokens: 0 },
    timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
    aborted,
    modelParams,
    finishReason: 'stop',
    ...(patternMatch ? { patternMatch } : {}),
    ...(error ? { error } : {}),
  }
}

// ============================================================================
// Preflight fast-fail helpers
// ============================================================================

/**
 * Extract the complete top-level "path" string value from partial tool-call
 * JSON arguments. Returns undefined until the value's closing quote has
 * streamed in. Only top-level keys are matched (preceded by `{` or `,`), so a
 * `"path"` lookalike inside a content string (always escaped `\"path\"` in
 * valid JSON) can never false-trigger.
 */
export function extractTopLevelPathArg(rawArgs: string): string | undefined {
  const match = /\{\s*"path"\s*:|,\s*"path"\s*:/.exec(rawArgs)
  if (!match) return undefined

  const colonIdx = rawArgs.indexOf(':', match.index)
  let i = colonIdx + 1
  while (i < rawArgs.length && /\s/.test(rawArgs[i]!)) i++
  if (rawArgs[i] !== '"') return undefined
  i++

  let value = ''
  let closed = false
  while (i < rawArgs.length) {
    const char = rawArgs[i]!
    if (char === '\\') {
      const next = rawArgs[i + 1]
      if (next === undefined) return undefined
      if (next === 'u') {
        const hex = rawArgs.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
      }
      value += next
      i += 2
      continue
    }
    if (char === '"') {
      closed = true
      break
    }
    value += char
    i++
  }

  if (!closed || value.length === 0) return undefined
  return value
}

/**
 * True when another tool call in the same response is a read_file for the same
 * path (or its path is not known yet). That flow is legitimate — the sibling
 * read registers before the batch executes — so fast-fail must not abort,
 * otherwise the write/edit would deterministically fail and its path-only
 * stand-in could crash at execution if the read wins the parallel race.
 */
function siblingReadsSamePath(
  toolNames: Map<number, string>,
  toolArgs: Map<number, string>,
  currentIndex: number,
  path: string,
): boolean {
  for (const [index, name] of toolNames) {
    if (index === currentIndex) continue
    if (name !== 'read_file') continue
    const rawArgs = toolArgs.get(index)
    if (rawArgs === undefined) return true
    const siblingPath = extractTopLevelPathArg(rawArgs)
    if (siblingPath === undefined) return true
    if (siblingPath === path) return true
  }
  return false
}

// ============================================================================
// Pure Streaming Generator
// ============================================================================

/**
 * Pure generator that streams a SINGLE LLM request and yields TurnEvents live.
 *
 * Does NOT:
 * - Create or update messages in database
 * - Emit WebSocket messages
 * - Execute tools
 * - Retry failed requests (the caller owns retries — see agent-loop.ts)
 *
 * DOES:
 * - Yield events for message deltas, thinking, tool preparation as they arrive
 * - Check retry patterns mid-stream and abort on match
 * - Return the final result with content, tool calls, usage stats
 *
 * Stream errors are recorded on the result (result.error) but never emitted
 * as chat.error events — retry decisions belong to the caller.
 */
export async function* streamLLMPure(options: PureStreamOptions): AsyncGenerator<TurnEvent, PureStreamResult> {
  const { messageId, systemPrompt, llmClient, messages, tools, toolChoice, signal, reasoningEffort, retryPatterns } =
    options

  // Build LLM messages
  const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages]

  // Compute modelParams from request and profile
  const profile = getModelProfile(llmClient.getModel())
  const backend = getBackendCapabilities(llmClient.getBackend())
  // Use user-configured settings if provided, fall back to profile defaults
  const userTemp = options.modelSettings?.temperature
  const userTopP = options.modelSettings?.topP
  const userTopK = options.modelSettings?.topK
  const userMaxTokens = options.modelSettings?.maxTokens
  const temperature = userTemp ?? profile.temperature
  const maxTokens = userMaxTokens ?? profile.defaultMaxTokens
  const topP = userTopP ?? profile.topP
  const topK = userTopK ?? (backend.supportsTopK ? profile.topK : undefined)
  // Omitted params (stripped from the wire request in client-pure) must not be
  // reported in stats/truncation-retry modelParams either.
  const modelParams = buildModelParams({
    temperature,
    topP,
    topK,
    maxTokens,
    ...(options.modelSettings?.omitParams !== undefined && { omitParams: options.modelSettings.omitParams }),
  })

  // Log model settings for debugging
  logger.debug('LLM request settings', {
    model: llmClient.getModel(),
    profile: profile.name,
    temperature,
    maxTokens,
    topP,
    topK,
    userConfigured: {
      temperature: userTemp !== undefined ? `user:${userTemp}` : 'default',
      topP: userTopP !== undefined ? `user:${userTopP}` : 'default',
      topK: userTopK !== undefined ? `user:${userTopK}` : 'default',
      maxTokens: userMaxTokens !== undefined ? `user:${userMaxTokens}` : 'default',
    },
  })

  // Create abort controller for pattern-based abort
  const patternAbortController = new AbortController()
  // Separate abort controller for preflight fast-fail (a rejected preflight
  // must not look like a user abort — the caller turns it into a failed tool call)
  const preflightAbortController = new AbortController()
  const combinedSignal = signal
    ? AbortSignal.any([signal, patternAbortController.signal, preflightAbortController.signal])
    : AbortSignal.any([patternAbortController.signal, preflightAbortController.signal])

  // Start streaming
  const stream = buildStreamRequest(llmClient, {
    messages: llmMessages,
    tools,
    toolChoice,
    reasoningEffort,
    signal: combinedSignal,
    modelSettings: options.modelSettings,
    sessionId: options.sessionId,
  })

  // Track tool call indices we've emitted preparing events for
  const seenToolIndices = new Set<number>()
  const toolNames = new Map<number, string>()
  const toolIds = new Map<number, string>()
  // Accumulate raw JSON arguments for return_value to extract content
  const returnValueArgs = new Map<number, string>()
  // Track accumulated tool arguments by index (for streaming partial args)
  const toolArgs = new Map<number, string>()

  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  let aborted = false
  let streamError: string | undefined
  let accumulatedContent = ''
  let accumulatedThinking = ''
  let thinkingStartedAt: number | undefined
  let lastThinkingAt = 0
  let patternMatch: RetryPatternMatch | undefined
  // Preflight fast-fail state: indices already checked + the failure payload
  const checkedPreflight = new Set<number>()
  let preflightFailure: { index: number; toolName: string; toolCallId: string; path: string; error: string } | undefined

  const activePatterns = retryPatterns?.filter((p) => p.active) ?? []

  try {
    while (true) {
      if (preflightFailure) break
      if (signal?.aborted) {
        aborted = true
        break
      }

      const { value, done } = await stream.next()

      if (done) {
        result = value
        break
      }

      // Transform streaming events to TurnEvents
      switch (value.type) {
        case 'text_delta':
          accumulatedContent += value.content
          yield {
            type: 'message.delta',
            data: { messageId, content: value.content },
          }
          break

        case 'thinking_delta':
          accumulatedThinking += value.content
          if (thinkingStartedAt === undefined) thinkingStartedAt = Date.now()
          lastThinkingAt = Date.now()
          yield {
            type: 'message.thinking',
            data: { messageId, content: value.content },
          }
          break

        case 'tool_call_delta': {
          // Accumulate tool name and id if provided
          if (value.name) {
            const existingName = toolNames.get(value.index) ?? ''
            toolNames.set(value.index, existingName + value.name)
          }
          if (value.id) {
            toolIds.set(value.index, value.id)
          }
          // Accumulate arguments if provided
          if (value.arguments) {
            const existingArgs = toolArgs.get(value.index) ?? ''
            toolArgs.set(value.index, existingArgs + value.arguments)
          }

          // Emit preparing event on first delta for this index (when we have a complete name)
          const fullName = toolNames.get(value.index)
          if (!seenToolIndices.has(value.index) && fullName) {
            seenToolIndices.add(value.index)
            // If the tool name is a sub-agent alias, show call_sub_agent instead
            const displayName = options.subAgentAliases?.has(fullName) ? 'call_sub_agent' : fullName
            const accumulatedArgs = toolArgs.get(value.index)
            yield {
              type: 'tool.preparing',
              data: {
                messageId,
                index: value.index,
                name: displayName,
                ...(accumulatedArgs ? { arguments: accumulatedArgs } : {}),
              },
            }
          } else if (seenToolIndices.has(value.index) && value.arguments) {
            // Only stream partial arguments for tools that display them live
            // (run_command shows the command text, return_value shows sub-agent
            // output, session_metadata shows the item being added, write_file
            // and edit_file show the file content/diff while it streams in)
            const name = toolNames.get(value.index)
            if (
              name === 'run_command' ||
              name === 'return_value' ||
              name === 'session_metadata' ||
              name === 'write_file' ||
              name === 'edit_file'
            ) {
              const accumulatedArgs = toolArgs.get(value.index)
              if (accumulatedArgs) {
                yield {
                  type: 'tool.preparing',
                  data: { messageId, index: value.index, name, arguments: accumulatedArgs },
                }
              }
            }
          }

          // Stream return_value content fragments as tool.output for live display
          if (fullName === 'return_value' && value.arguments) {
            const toolCallId = toolIds.get(value.index)
            if (toolCallId) {
              const prevRaw = returnValueArgs.get(value.index) ?? ''
              const newRaw = prevRaw + value.arguments
              returnValueArgs.set(value.index, newRaw)

              // Extract the "content" value from partial JSON: {"content":"...text..."}
              // Find the start of the content string value
              const contentStart = newRaw.indexOf('"content"')
              if (contentStart >= 0) {
                // Find the opening quote of the value (after "content":)
                const colonPos = newRaw.indexOf(':', contentStart + 9)
                if (colonPos >= 0) {
                  const valueStart = newRaw.indexOf('"', colonPos + 1)
                  if (valueStart >= 0) {
                    // Everything after the opening quote (minus trailing `"}` if complete)
                    const prevContent =
                      prevRaw.length > valueStart + 1 ? prevRaw.slice(valueStart + 1).replace(/"\s*\}\s*$/, '') : ''
                    const currentContent = newRaw.slice(valueStart + 1).replace(/"\s*\}\s*$/, '')
                    // Emit only the new delta
                    const delta = currentContent.slice(prevContent.length)
                    if (delta) {
                      // Unescape JSON string escapes
                      const unescaped = delta
                        .replace(/\\n/g, '\n')
                        .replace(/\\t/g, '\t')
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\')
                      yield {
                        type: 'tool.output',
                        data: { messageId, toolCallId, stream: 'stdout' as const, content: unescaped },
                      }
                    }
                  }
                }
              }
            }
          }

          // Fast-fail preflight: as soon as a complete top-level "path" is
          // available for a path-based tool, ask the caller whether the write
          // is legal. A rejection aborts the stream before the payload tokens
          // are generated — the result carries a path-only tool call instead.
          if (options.preflight && (fullName === 'write_file' || fullName === 'edit_file')) {
            const path = extractTopLevelPathArg(toolArgs.get(value.index) ?? '')
            if (path !== undefined && !checkedPreflight.has(value.index)) {
              checkedPreflight.add(value.index)
              // A throwing preflight must not break the turn — the tool's own
              // validation at execution time remains the safety net.
              let preflightError: string | undefined
              try {
                preflightError = await options.preflight(path)
              } catch (error) {
                logger.warn('Preflight check failed, falling back to tool-time validation', {
                  tool: fullName,
                  path,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
              if (preflightError) {
                // A sibling read of the same path in this response makes the
                // flow legitimate — don't fail fast, let batch execution race.
                if (siblingReadsSamePath(toolNames, toolArgs, value.index, path)) {
                  break
                }
                preflightFailure = {
                  index: value.index,
                  toolName: fullName,
                  toolCallId: toolIds.get(value.index) ?? randomUUID(),
                  path,
                  error: preflightError,
                }
                preflightAbortController.abort()
                break
              }
            }
          }
          break
        }

        case 'error':
          // Suppress chat.error when user-initiated abort caused the error —
          // the agent loop handles abort gracefully via signal check + emitPartialDoneEvents.
          if (signal?.aborted) break
          streamError = value.error
          break
      }

      // Check retry patterns mid-stream — abort and let cleanup happen naturally
      if (activePatterns.length > 0 && (accumulatedContent || accumulatedThinking)) {
        const matches = matchRetryPatterns(accumulatedContent, accumulatedThinking || undefined, activePatterns)
        if (matches.length > 0) {
          patternMatch = matches[0]!
          patternAbortController.abort()
          break
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Aborted') {
      aborted = true
    } else {
      throw error
    }
  }

  // Preflight rejection takes precedence: the caller turns the path-only tool
  // call into a failed tool result, so the LLM learns the error without having
  // streamed the doomed payload. Sibling tool calls that already streamed
  // complete arguments (e.g. a read_file preceding an edit_file in the same
  // response) are preserved — only the rejected call is reduced to its path.
  if (preflightFailure) {
    const toolCalls: ToolCall[] = []
    for (const [index, name] of toolNames) {
      if (index === preflightFailure.index) continue
      const rawArgs = toolArgs.get(index)
      if (!rawArgs) continue
      try {
        const parsedArgs = JSON.parse(rawArgs)
        if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) {
          toolCalls.push({
            id: toolIds.get(index) ?? randomUUID(),
            name,
            arguments: parsedArgs as Record<string, unknown>,
          })
        }
      } catch {
        // Incomplete arguments — the call was cut mid-stream, drop it
      }
    }
    toolCalls.push({
      id: preflightFailure.toolCallId,
      name: preflightFailure.toolName,
      arguments: { path: preflightFailure.path },
      preflightError: preflightFailure.error,
    })

    return {
      content: accumulatedContent,
      toolCalls,
      segments: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
      aborted: false,
      modelParams,
      finishReason: 'stop',
    }
  }

  // Pattern match took precedence over normal result
  if (patternMatch) {
    return createEmptyStreamResult(false, modelParams, patternMatch)
  }

  // Return result (available via generator.value after iteration)
  if (!result) {
    return createEmptyStreamResult(aborted, modelParams, undefined, streamError)
  }

  const baseResult: PureStreamResult = {
    content: result.content,
    toolCalls: result.toolCalls,
    segments: result.segments,
    usage: {
      promptTokens: result.response.usage.promptTokens,
      completionTokens: result.response.usage.completionTokens,
      totalTokens: result.response.usage.totalTokens,
      ...(result.response.usage.cachedPromptTokens !== undefined && {
        cachedPromptTokens: result.response.usage.cachedPromptTokens,
      }),
      ...(result.response.usage.cacheWriteTokens !== undefined && {
        cacheWriteTokens: result.response.usage.cacheWriteTokens,
      }),
      ...(result.response.usage.cacheSource !== undefined && {
        cacheSource: result.response.usage.cacheSource,
      }),
    },
    timing: result.timing,
    aborted,
    modelParams,
    finishReason: result.response.finishReason,
  }

  // Only include thinkingContent if it has content
  if (result.thinkingContent) {
    baseResult.thinkingContent = result.thinkingContent
  }
  if (thinkingStartedAt !== undefined) {
    baseResult.thinkingDurationMs = Math.max(0, lastThinkingAt - thinkingStartedAt)
  }

  return baseResult
}

// ============================================================================
// LLM Failure Retry helpers (shared by the agent loop's per-request retry)
// ============================================================================

/**
 * Decide what to do after a failed LLM attempt, per the retry policy.
 *
 * Delays escalate through `backoffMs` (before attempt 2, 3, …) and then hold
 * at `minIntervalMs`; retrying stops once `maxDurationMs` has elapsed since
 * the first failure or `maxAttempts` consecutive failures are reached.
 */
export function evaluateLLMRetry(
  failures: number,
  firstFailureAt: number,
  now: number,
  policy: LLMRetryPolicy,
): { retry: true; delayMs: number; attempt: number } | { retry: false } {
  if (now - firstFailureAt >= policy.maxDurationMs) return { retry: false }
  if (failures >= policy.maxAttempts) return { retry: false }
  const delayMs = failures <= policy.backoffMs.length ? policy.backoffMs[failures - 1]! : policy.minIntervalMs
  return { retry: true, delayMs, attempt: failures + 1 }
}

/** AbortControllers for in-flight backoff waits, keyed by session. */
const retryWaiters = new Map<string, AbortController>()

/** Timestamp of the last definitive LLM failure per session (chat.retry guard). */
const llmFailures = new Map<string, number>()

/**
 * Whether a session had a definitive LLM failure within the given window.
 * Used to validate `chat.retry` — an unprompted turn must never be started
 * unless the last turn actually failed.
 */
export function hasRecentLLMFailure(sessionId: string, withinMs: number): boolean {
  const at = llmFailures.get(sessionId)
  if (at === undefined) return false
  if (Date.now() - at <= withinMs) return true
  // Expired entries are dropped lazily so the map never accumulates
  // permanent entries for sessions that failed long ago.
  llmFailures.delete(sessionId)
  return false
}

/**
 * Interrupt the current LLM-retry backoff wait for a session ("Retry now").
 * Returns whether a wait was interrupted.
 */
export function interruptLLMRetryWait(sessionId: string): boolean {
  const controller = retryWaiters.get(sessionId)
  if (!controller) return false
  controller.abort()
  return true
}

/**
 * Sleep through a retry backoff, interruptible by the user abort signal or
 * the "Retry now" signal. Resolves with the reason the wait ended.
 */
function sleepWithRetryInterrupt(
  ms: number,
  signal?: AbortSignal,
  retryNowSignal?: AbortSignal,
): Promise<'waited' | 'aborted' | 'retry-now'> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('aborted')
      return
    }
    if (retryNowSignal?.aborted) {
      resolve('retry-now')
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      retryNowSignal?.removeEventListener('abort', onRetryNow)
    }
    const onAbort = () => {
      cleanup()
      resolve('aborted')
    }
    const onRetryNow = () => {
      cleanup()
      resolve('retry-now')
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve('waited')
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    retryNowSignal?.addEventListener('abort', onRetryNow, { once: true })
  })
}

/**
 * Sleep through a retry backoff for a session, interruptible by the user abort
 * signal or the "Retry now" signal. Registers the wait so `chat.llm_retry_now`
 * can interrupt it. Resolves with the reason the wait ended.
 */
export async function sleepThroughRetryBackoff(
  ms: number,
  sessionId: string,
  signal?: AbortSignal,
): Promise<'waited' | 'aborted' | 'retry-now'> {
  const retryNowController = new AbortController()
  retryWaiters.set(sessionId, retryNowController)
  try {
    return await sleepWithRetryInterrupt(ms, signal, retryNowController.signal)
  } finally {
    retryWaiters.delete(sessionId)
  }
}

/** Record a definitive LLM failure (chat.retry guard). */
export function recordLLMFailure(sessionId: string): void {
  llmFailures.set(sessionId, Date.now())
}

/** Clear a recorded LLM failure after a successful turn (chat.retry guard). */
export function clearLLMFailure(sessionId: string): void {
  llmFailures.delete(sessionId)
}

// ============================================================================
// Turn Metrics (pure, no side effects)
// ============================================================================

/**
 * Tracks aggregated metrics across a full turn (multiple LLM calls + tool executions).
 * Pure data structure - no side effects.
 */
export interface ModelParams {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

export class TurnMetrics {
  private startTime: number
  private totalPrefillTokens = 0
  private totalPrefillIncrement = 0
  private hasPrefillIncrement = false
  private totalPrefillTime = 0 // seconds
  private totalGenTokens = 0
  private totalGenTime = 0 // seconds
  private totalToolTime = 0 // seconds
  private totalThinkingTime = 0 // milliseconds
  private llmCalls: Array<
    Omit<NonNullable<MessageStats['llmCalls']>[number], 'providerId' | 'providerName' | 'backend' | 'model'>
  > = []
  private modelParams: ModelParams = {}

  constructor() {
    this.startTime = performance.now()
  }

  /** Add metrics from an LLM call.
   * @param previousContextTokens - context size BEFORE this LLM call (for computing the non-cached increment)
   */
  addLLMCall(
    timing: StreamTiming,
    promptTokens: number,
    completionTokens: number,
    previousContextTokens?: number,
    modelParams?: ModelParams,
    providerUsage?: Partial<TokenUsage>,
  ): void {
    const callIndex = this.llmCalls.length + 1
    this.totalPrefillTokens += promptTokens
    this.totalPrefillTime += timing.ttft
    this.totalGenTokens += completionTokens
    this.totalGenTime += timing.completionTime
    if (modelParams) {
      this.modelParams = modelParams
    }
    // When the context shrank (e.g. after compaction) the previous prefix is no
    // longer reusable, so the whole prompt had to be processed again. Only a
    // non-shrinking prompt can reuse the previous context as its cached prefix.
    const prefTokenIncrement =
      previousContextTokens !== undefined
        ? promptTokens >= previousContextTokens
          ? promptTokens - previousContextTokens
          : promptTokens
        : undefined
    if (prefTokenIncrement !== undefined) {
      this.totalPrefillIncrement += prefTokenIncrement
      this.hasPrefillIncrement = true
    }
    const prefillSource = prefTokenIncrement ?? promptTokens
    this.llmCalls = [
      ...this.llmCalls,
      {
        callIndex,
        promptTokens,
        completionTokens,
        ...(prefTokenIncrement !== undefined && { prefTokenIncrement }),
        ...(providerUsage?.cachedPromptTokens !== undefined && {
          cachedPromptTokens: providerUsage.cachedPromptTokens,
        }),
        ...(providerUsage?.cacheWriteTokens !== undefined && {
          cacheWriteTokens: providerUsage.cacheWriteTokens,
        }),
        ...(providerUsage?.cacheSource !== undefined && {
          cacheSource: providerUsage.cacheSource,
        }),
        ttft: timing.ttft,
        completionTime: timing.completionTime,
        prefillSpeed: timing.ttft > 0 ? Math.round((prefillSource / timing.ttft) * 10) / 10 : 0,
        generationSpeed:
          timing.completionTime > 0 ? Math.round((completionTokens / timing.completionTime) * 10) / 10 : 0,
        totalTime: Math.round((timing.ttft + timing.completionTime) * 10) / 10,
        timestamp: new Date().toISOString(),
        ...(this.modelParams.temperature !== undefined && { temperature: this.modelParams.temperature }),
        ...(this.modelParams.topP !== undefined && { topP: this.modelParams.topP }),
        ...(this.modelParams.topK !== undefined && { topK: this.modelParams.topK }),
        ...(this.modelParams.maxTokens !== undefined && { maxTokens: this.modelParams.maxTokens }),
      },
    ]
  }

  /** Set model parameters for tracking */
  setModelParams(params: ModelParams): void {
    this.modelParams = params
  }

  /** Add tool execution time (in milliseconds) */
  addToolTime(durationMs: number): void {
    this.totalToolTime += durationMs / 1000
  }

  /** Add wall-clock thinking time (in milliseconds) */
  addThinkingTime(durationMs: number): void {
    this.totalThinkingTime += durationMs
  }

  /** Build final stats object */
  buildStats(identity: StatsIdentity, mode: string): MessageStats {
    return computeAggregatedStats({
      identity,
      mode,
      totalPrefillTokens: this.totalPrefillTokens,
      ...(this.hasPrefillIncrement && { totalPrefillIncrement: this.totalPrefillIncrement }),
      totalGenTokens: this.totalGenTokens,
      totalPrefillTime: this.totalPrefillTime,
      totalGenTime: this.totalGenTime,
      totalToolTime: this.totalToolTime,
      ...(this.totalThinkingTime > 0 && { thinkingDuration: Math.round(this.totalThinkingTime / 100) / 10 }),
      totalTime: (performance.now() - this.startTime) / 1000,
      llmCalls: this.llmCalls.map((call) => ({
        ...identity,
        ...call,
      })),
    })
  }
}

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Create a message.start event
 */
export function createMessageStartEvent(
  messageId: string,
  role: 'user' | 'assistant' | 'system',
  content?: string,
  options?: {
    contextWindowId?: string
    subAgentId?: string
    subAgentType?: string
    isSystemGenerated?: boolean
    messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
    metadata?: { type: string; name: string; color: string }
  },
): TurnEvent {
  return {
    type: 'message.start',
    data: {
      messageId,
      role,
      ...(content !== undefined && { content }),
      ...(options?.contextWindowId && { contextWindowId: options.contextWindowId }),
      ...(options?.subAgentId && { subAgentId: options.subAgentId }),
      ...(options?.subAgentType && { subAgentType: options.subAgentType }),
      ...(options?.isSystemGenerated && { isSystemGenerated: options.isSystemGenerated }),
      ...(options?.messageKind && { messageKind: options.messageKind }),
      ...(options?.metadata && { metadata: options.metadata }),
    },
  }
}

/**
 * Create a message.done event
 */
export function createMessageDoneEvent(
  messageId: string,
  options?: {
    stats?: MessageStats
    segments?: MessageSegment[]
    partial?: boolean
  },
): TurnEvent {
  return {
    type: 'message.done',
    data: {
      messageId,
      ...(options?.stats && { stats: options.stats }),
      ...(options?.segments && { segments: options.segments }),
      ...(options?.partial && { partial: options.partial }),
    },
  }
}

/**
 * Create a tool.call event
 */
export function createToolCallEvent(messageId: string, toolCall: ToolCall): TurnEvent {
  return {
    type: 'tool.call',
    data: { messageId, toolCall },
  }
}

/**
 * Create a tool.result event
 */
export function createToolResultEvent(messageId: string, toolCallId: string, result: ToolResult): TurnEvent {
  return {
    type: 'tool.result',
    data: { messageId, toolCallId, result },
  }
}

/**
 * Create a chat.done event
 */
export function createChatDoneEvent(
  messageId: string,
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' | 'truncated' | 'step_done',
  stats?: MessageStats,
  agentType?: 'sub-agent',
): TurnEvent {
  return {
    type: 'chat.done',
    data: {
      messageId,
      reason,
      ...(stats && { stats }),
      ...(agentType && { agentType }),
    },
  }
}

// ============================================================================
// Consumer Helper
// ============================================================================

/**
 * Consume a pure stream generator, yielding events and returning the final result.
 * This properly extracts the return value from the async generator.
 */
export async function consumeStreamGenerator(
  gen: AsyncGenerator<TurnEvent, PureStreamResult>,
  onEvent: (event: TurnEvent) => void | Promise<void>,
): Promise<PureStreamResult> {
  let result: IteratorResult<TurnEvent, PureStreamResult>

  while (true) {
    result = await gen.next()
    if (result.done) {
      return result.value
    }
    await onEvent(result.value)
  }
}
