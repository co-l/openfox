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

import type { PromptContext, ToolCall, MessageSegment, MessageStats, StatsIdentity, ToolResult, Attachment } from '../../shared/types.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition } from '../llm/types.js'
import { buildModelParams } from '../llm/client-pure.js'
import type { StreamTiming } from '../llm/streaming.js'
import type { TurnEvent } from '../events/types.js'
import { buildStreamRequest } from './stream-utils.js'
import { computeAggregatedStats } from './stats.js'
import { FORMAT_CORRECTION_PROMPT } from './prompts.js'
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
    toolCalls?: ToolCall[]
    toolCallId?: string
    attachments?: Attachment[]
  }>
  tools?: LLMToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
  signal?: AbortSignal | undefined
  disableThinking?: boolean
  onVisionFallbackStart?: (attachmentId: string, filename?: string) => void
  onVisionFallbackDone?: (attachmentId: string, description: string) => void
  /** User-configured model settings (temperature, topP, topK, maxTokens, supportsVision) */
  modelSettings?: ModelParams & { supportsVision?: boolean }
}

export interface PureStreamResult {
  content: string
  thinkingContent?: string
  toolCalls: ToolCall[]
  segments: MessageSegment[]
  usage: { promptTokens: number; completionTokens: number }
  timing: StreamTiming
  aborted: boolean
  xmlFormatError: boolean
  modelParams?: ModelParams
}

// ============================================================================
// Helpers
// ============================================================================

function createEmptyStreamResult(
  aborted: boolean,
  xmlFormatError: boolean,
  modelParams: ModelParams
): PureStreamResult {
  return {
    content: '',
    toolCalls: [],
    segments: [],
    usage: { promptTokens: 0, completionTokens: 0 },
    timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
    aborted,
    xmlFormatError,
    modelParams,
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
 * - Return the final result with content, tool calls, usage stats
 *
 * @example
 * ```typescript
 * const gen = streamLLMPure(options)
 * for await (const event of gen) {
 *   eventStore.append(sessionId, event)
 * }
 * const result = gen.value // Available after iteration completes
 * ```
 */
export async function* streamLLMPure(
  options: PureStreamOptions
): AsyncGenerator<TurnEvent, PureStreamResult> {
  const { messageId, systemPrompt, llmClient, messages, tools, toolChoice, signal, disableThinking, onVisionFallbackStart, onVisionFallbackDone } = options

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

  // Start streaming
  const stream = buildStreamRequest(llmClient, {
    messages: llmMessages,
    tools,
    toolChoice,
    disableThinking: disableThinking ?? false,
    signal,
    modelSettings: options.modelSettings,
    onVisionFallbackStart,
    onVisionFallbackDone,
  })

  // Track tool call indices we've emitted preparing events for
  const seenToolIndices = new Set<number>()
  const toolNames = new Map<number, string>()
  const toolIds = new Map<number, string>()
  // Accumulate raw JSON arguments for return_value to extract content
  const returnValueArgs = new Map<number, string>()

  let result: Awaited<ReturnType<typeof stream.next>>['value'] = null
  let aborted = false
  let xmlFormatError = false

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
          yield {
            type: 'message.delta',
            data: { messageId, content: value.content },
          }
          break

        case 'thinking_delta':
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

          // Emit preparing event on first delta for this index (when we have a complete name)
          const fullName = toolNames.get(value.index)
          if (!seenToolIndices.has(value.index) && fullName) {
            seenToolIndices.add(value.index)
            yield {
              type: 'tool.preparing',
              data: { messageId, index: value.index, name: fullName },
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
                    const prevContent = prevRaw.length > valueStart + 1
                      ? prevRaw.slice(valueStart + 1).replace(/"\s*\}\s*$/, '')
                      : ''
                    const currentContent = newRaw.slice(valueStart + 1).replace(/"\s*\}\s*$/, '')
                    // Emit only the new delta
                    const delta = currentContent.slice(prevContent.length)
                    if (delta) {
                      // Unescape JSON string escapes
                      const unescaped = delta.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                      yield {
                        type: 'tool.output',
                        data: { toolCallId, stream: 'stdout' as const, content: unescaped },
                      }
                    }
                  }
                }
              }
            }
          }
          break
        }

        case 'xml_tool_abort':
          xmlFormatError = true
          break

        case 'error':
          yield {
            type: 'chat.error',
            data: { error: value.error, recoverable: true },
          }
          break
      }

      // If XML format error, break out
      if (xmlFormatError) {
        break
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Aborted') {
      aborted = true
    } else {
      throw error
    }
  }

  // Return result (available via generator.value after iteration)
  if (!result) {
    return createEmptyStreamResult(aborted, xmlFormatError, modelParams)
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
    xmlFormatError,
    modelParams,
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
  private totalPrefillTime = 0 // seconds
  private totalGenTokens = 0
  private totalGenTime = 0 // seconds
  private totalToolTime = 0 // seconds
  private llmCalls: Array<Omit<NonNullable<MessageStats['llmCalls']>[number], 'providerId' | 'providerName' | 'backend' | 'model'>> = []
  private modelParams: ModelParams = {}

  constructor() {
    this.startTime = performance.now()
  }

  /** Add metrics from an LLM call */
  addLLMCall(timing: StreamTiming, promptTokens: number, completionTokens: number, modelParams?: ModelParams): void {
    const callIndex = this.llmCalls.length + 1
    this.totalPrefillTokens += promptTokens
    this.totalPrefillTime += timing.ttft
    this.totalGenTokens += completionTokens
    this.totalGenTime += timing.completionTime
    if (modelParams) {
      this.modelParams = modelParams
    }
    this.llmCalls = [
      ...this.llmCalls,
      {
        callIndex,
        promptTokens,
        completionTokens,
        ttft: timing.ttft,
        completionTime: timing.completionTime,
        prefillSpeed: timing.ttft > 0 ? Math.round((promptTokens / timing.ttft) * 10) / 10 : 0,
        generationSpeed: timing.completionTime > 0 ? Math.round((completionTokens / timing.completionTime) * 10) / 10 : 0,
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
      totalGenTokens: this.totalGenTokens,
      totalPrefillTime: this.totalPrefillTime,
      totalGenTime: this.totalGenTime,
      totalToolTime: this.totalToolTime,
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
  }
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
    promptContext?: PromptContext
  }
): TurnEvent {
  return {
    type: 'message.done',
    data: {
      messageId,
      ...(options?.stats && { stats: options.stats }),
      ...(options?.segments && { segments: options.segments }),
      ...(options?.partial && { partial: options.partial }),
      ...(options?.promptContext && { promptContext: options.promptContext }),
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
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user',
  stats?: MessageStats
): TurnEvent {
  return {
    type: 'chat.done',
    data: {
      messageId,
      reason,
      ...(stats && { stats }),
    },
  }
}

/**
 * Create a format.retry event
 */
export function createFormatRetryEvent(attempt: number, maxAttempts: number): TurnEvent {
  return {
    type: 'format.retry',
    data: { attempt, maxAttempts },
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
  onEvent: (event: TurnEvent) => void
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

// ============================================================================
// Multi-Turn Stream Consumer with Tool Execution
// ============================================================================

const MAX_TOOL_LOOP_ITERATIONS = 10

export interface ConsumeStreamWithToolLoopOptions {
  messageId: string
  systemPrompt: string
  llmClient: LLMClientWithModel
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: ToolCall[]
    toolCallId?: string
  }>
  tools: LLMToolDefinition[]
  toolChoice: 'auto' | 'none' | 'required'
  disableThinking?: boolean
  signal?: AbortSignal
  turnMetrics: TurnMetrics
  toolRegistry: {
    execute: (name: string, args: Record<string, unknown>, ctx: {
      sessionId: string
      workdir: string
      signal?: AbortSignal
      llmClient: LLMClientWithModel
      statsIdentity: StatsIdentity
      dangerLevel?: 'normal' | 'dangerous'
      toolCallId: string
    }) => Promise<ToolResult>
  }
  sessionId: string
  workdir: string
  onEvent: (event: TurnEvent) => void
  statsIdentity: StatsIdentity
  dangerLevel?: 'normal' | 'dangerous'
}

export async function consumeStreamWithToolLoop(
  options: ConsumeStreamWithToolLoopOptions
): Promise<PureStreamResult> {
  const {
    messageId,
    systemPrompt,
    llmClient,
    messages,
    tools,
    toolChoice,
    disableThinking,
    signal,
    turnMetrics,
    toolRegistry,
    sessionId,
    workdir,
    onEvent,
    statsIdentity,
    dangerLevel,
  } = options

  let currentMessages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: ToolCall[]
    toolCallId?: string
  }> = [...messages]

  let iterations = 0

  for (;;) {
    if (signal?.aborted) {
      return createEmptyStreamResult(true, false, {})
    }

    if (++iterations > MAX_TOOL_LOOP_ITERATIONS) {
      throw new Error('Max tool loop iterations exceeded during compaction')
    }

    const streamGen = streamLLMPure({
      messageId,
      systemPrompt,
      llmClient,
      messages: currentMessages,
      tools,
      toolChoice,
      disableThinking: disableThinking ?? false,
      signal,
    })

    const result = await consumeStreamGenerator(streamGen, onEvent)

    if (result.aborted) {
      return result
    }

    if (result.xmlFormatError) {
      const correctionMsg = { role: 'user' as const, content: FORMAT_CORRECTION_PROMPT }
      currentMessages = [...currentMessages, correctionMsg]
      continue
    }

    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens, result.modelParams)

    if (result.toolCalls.length > 0) {
      const stats = turnMetrics.buildStats(statsIdentity, 'compaction')
      onEvent(createMessageDoneEvent(messageId, {
        segments: result.segments,
        stats,
      }))

      const toolContext = {
        sessionId,
        workdir,
        turnMetrics,
        signal: signal ?? undefined,
        llmClient,
        statsIdentity,
        dangerLevel,
        toolRegistry,
      }

      const toolResult = await executeToolBatchWithContext(messageId, result.toolCalls, toolContext, onEvent)

      for (const toolMsg of toolResult.toolMessages) {
        const msg: { role: 'tool'; content: string; toolCallId: string } = {
          role: 'tool' as const,
          content: toolMsg.content,
          toolCallId: toolMsg.toolCallId ?? '',
        }
        currentMessages.push(msg)
      }

      currentMessages.push({
        role: 'assistant' as const,
        content: result.content,
        toolCalls: result.toolCalls,
      })

      continue
    }

    if (!result.content && result.thinkingContent) {
      return {
        ...result,
        content: result.thinkingContent,
      }
    }

    return result
  }
}

interface ToolBatchExecutionContext {
  sessionId: string
  workdir: string
  turnMetrics: TurnMetrics
  signal: AbortSignal | undefined
  llmClient: LLMClientWithModel
  statsIdentity: StatsIdentity
  dangerLevel: 'normal' | 'dangerous' | undefined
  toolRegistry: ConsumeStreamWithToolLoopOptions['toolRegistry']
}

async function executeToolBatchWithContext(
  assistantMsgId: string,
  toolCalls: ToolCall[],
  ctx: ToolBatchExecutionContext,
  onEvent: (event: TurnEvent) => void
): Promise<{ toolMessages: Array<{ role: 'tool'; content: string; toolCallId?: string }>; criteriaChanged: boolean }> {
  const toolMessages: Array<{ role: 'tool'; content: string; toolCallId?: string }> = []
  const criteriaChanged = false

  for (const toolCall of toolCalls) {
    if (ctx.signal?.aborted) {
      throw new Error('Aborted')
    }

    onEvent(createToolCallEvent(assistantMsgId, toolCall))

    let toolResult: ToolResult
    try {
      toolResult = await ctx.toolRegistry.execute(toolCall.name, toolCall.arguments, {
        sessionId: ctx.sessionId,
        workdir: ctx.workdir,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        llmClient: ctx.llmClient,
        statsIdentity: ctx.statsIdentity,
        ...(ctx.dangerLevel ? { dangerLevel: ctx.dangerLevel } : {}),
        toolCallId: toolCall.id,
      })
    } catch (error) {
      toolResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: 0,
        truncated: false,
      }
    }

    ctx.turnMetrics.addToolTime(toolResult.durationMs)
    onEvent(createToolResultEvent(assistantMsgId, toolCall.id, toolResult))

    const content = toolResult.success
      ? (toolResult.output ?? 'Success')
      : toolResult.output
        ? `${toolResult.output}\n\nError: ${toolResult.error}`
        : `Error: ${toolResult.error}`

    toolMessages.push({
      role: 'tool',
      content,
      toolCallId: toolCall.id,
    })
  }

  return { toolMessages, criteriaChanged }
}
