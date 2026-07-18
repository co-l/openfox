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
} from '../../shared/types.js'
import type { RequestContextMessage } from '../chat/request-context.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition, ReasoningEffort } from '../llm/types.js'
import { buildModelParams } from '../llm/client-pure.js'
import type { StreamTiming } from '../llm/streaming.js'
import type { TurnEvent } from '../events/types.js'
import type { RetryPatternConfig, RetryPatternMatch } from './auto-patterns.js'
import { matchRetryPatterns } from './auto-patterns.js'
import { buildStreamRequest } from './stream-utils.js'
import { computeAggregatedStats } from './stats.js'
import { getModelProfile } from '../llm/profiles.js'
import { getBackendCapabilities } from '../llm/backend.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface PureStreamOptions {
  messageId: string
  systemPrompt: string
  llmClient: LLMClientWithModel
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
  /** User-configured model settings (temperature, topP, topK, maxTokens, supportsVision) */
  modelSettings?: ModelParams & { supportsVision?: boolean }
  maxTokensLimit?: number
  /** Retry patterns to check mid-stream */
  retryPatterns?: RetryPatternConfig[]
  messageContext?: {
    contextWindowId?: string
    subAgentId?: string
    subAgentType?: string
  }
}

export interface PureStreamResult {
  content: string
  thinkingContent?: string
  toolCalls: ToolCall[]
  segments: MessageSegment[]
  usage: { promptTokens: number; completionTokens: number }
  timing: StreamTiming
  aborted: boolean
  modelParams?: ModelParams
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter'
  /** Set when a retry pattern matched mid-stream */
  patternMatch?: RetryPatternMatch
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
  }
}

// ============================================================================
// Pure Streaming Generator
// ============================================================================

/**
 * Pure generator that streams an LLM response and yields TurnEvents.
 *
 * Does NOT:
 * - Create or update messages in database
 * - Emit WebSocket messages
 * - Execute tools
 *
 * DOES:
 * - Yield events for message deltas, thinking, tool preparation
 * - Check retry patterns mid-stream and abort on match
 * - Return the final result with content, tool calls, usage stats
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
  const modelParams = buildModelParams({ temperature, topP, topK, maxTokens })

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
  const combinedSignal = signal
    ? AbortSignal.any([signal, patternAbortController.signal])
    : patternAbortController.signal

  // Start streaming
  const stream = buildStreamRequest(llmClient, {
    messages: llmMessages,
    tools,
    toolChoice,
    reasoningEffort,
    signal: combinedSignal,
    modelSettings: options.modelSettings,
    maxTokensLimit: options.maxTokensLimit,
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
  let accumulatedContent = ''
  let accumulatedThinking = ''
  let patternMatch: RetryPatternMatch | undefined
  let streamError: string | undefined

  const activePatterns = retryPatterns?.filter((p) => p.active) ?? []

  try {
    while (true) {
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
            const accumulatedArgs = toolArgs.get(value.index)
            yield {
              type: 'tool.preparing',
              data: {
                messageId,
                index: value.index,
                name: fullName,
                ...(accumulatedArgs ? { arguments: accumulatedArgs } : {}),
              },
            }
          } else if (seenToolIndices.has(value.index) && value.arguments) {
            // Only stream partial arguments for tools that display them live
            // (run_command shows the command text, return_value shows sub-agent output)
            const name = toolNames.get(value.index)
            if (name === 'run_command' || name === 'return_value') {
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
          break
        }

        case 'model_cascade_fallback': {
          const fallbackMessageId = crypto.randomUUID()
          yield createMessageStartEvent(fallbackMessageId, 'system', JSON.stringify(value.fallback), {
            ...options.messageContext,
            isSystemGenerated: true,
            messageKind: 'model-fallback',
          })
          yield createMessageDoneEvent(fallbackMessageId)
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

  if (streamError) throw new Error(streamError)

  // Pattern match took precedence over normal result
  if (patternMatch) {
    return createEmptyStreamResult(false, modelParams, patternMatch)
  }

  // Return result (available via generator.value after iteration)
  if (!result) {
    return createEmptyStreamResult(aborted, modelParams)
  }

  const baseResult: PureStreamResult = {
    content: result.content,
    toolCalls: result.toolCalls,
    segments: result.segments,
    usage: {
      promptTokens: result.response.usage.promptTokens,
      completionTokens: result.response.usage.completionTokens,
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

  return baseResult
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
  private totalPrefillTime = 0 // seconds
  private totalGenTokens = 0
  private totalGenTime = 0 // seconds
  private totalToolTime = 0 // seconds
  private llmCalls: Array<
    Omit<NonNullable<MessageStats['llmCalls']>[number], 'providerId' | 'providerName' | 'backend' | 'model'> &
      Partial<StatsIdentity>
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
    identity?: StatsIdentity,
  ): void {
    const callIndex = this.llmCalls.length + 1
    this.totalPrefillTokens += promptTokens
    this.totalPrefillTime += timing.ttft
    this.totalGenTokens += completionTokens
    this.totalGenTime += timing.completionTime
    if (modelParams) {
      this.modelParams = modelParams
    }
    const prefTokenIncrement =
      previousContextTokens !== undefined ? Math.max(0, promptTokens - previousContextTokens) : undefined
    if (prefTokenIncrement !== undefined) {
      this.totalPrefillIncrement += prefTokenIncrement
    }
    const prefillSource = prefTokenIncrement ?? promptTokens
    this.llmCalls = [
      ...this.llmCalls,
      {
        ...(identity ?? {}),
        callIndex,
        promptTokens,
        completionTokens,
        ...(prefTokenIncrement !== undefined && { prefTokenIncrement }),
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

  /** Build final stats object */
  buildStats(identity: StatsIdentity, mode: string): MessageStats {
    return computeAggregatedStats({
      identity,
      mode,
      totalPrefillTokens: this.totalPrefillTokens,
      ...(this.totalPrefillIncrement > 0 && { totalPrefillIncrement: this.totalPrefillIncrement }),
      totalGenTokens: this.totalGenTokens,
      totalPrefillTime: this.totalPrefillTime,
      totalGenTime: this.totalGenTime,
      totalToolTime: this.totalToolTime,
      totalTime: (performance.now() - this.startTime) / 1000,
      llmCalls: this.llmCalls.map((call) => ({ ...identity, ...call })),
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
    messageKind?:
      | 'correction'
      | 'auto-prompt'
      | 'context-reset'
      | 'task-completed'
      | 'workflow-started'
      | 'command'
      | 'model-fallback'
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
  onEvent: (event: TurnEvent) => void,
): Promise<PureStreamResult> {
  let result: IteratorResult<TurnEvent, PureStreamResult>

  while (true) {
    result = await gen.next()
    if (result.done) {
      return result.value
    }
    onEvent(result.value)
  }
}
