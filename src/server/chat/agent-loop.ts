/**
 * Unified Agent Execution Loop
 *
 * Extracts the shared execution logic from runPlannerTurn, runBuilderTurn,
 * and executeSubAgent into reusable helpers.
 *
 * - executeToolBatch(): shared tool execution (used by all agent types)
 * - runTopLevelAgentLoop(): replaces duplicated planner/builder turns
 */

import type { Attachment, InjectedFile, PromptContext, StatsIdentity, ToolCall, ToolMode, ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { RequestContextMessage } from './request-context.js'
import { PathAccessDeniedError } from '../tools/path-security.js'
import { createToolProgressHandler } from './tool-streaming.js'
import {
  streamLLMPure,
  consumeStreamGenerator,
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createToolCallEvent,
  createToolResultEvent,
  createChatDoneEvent,
  createFormatRetryEvent,
} from './stream-pure.js'
import type { PureStreamResult } from './stream-pure.js'
import { getEventStore, getContextMessages, getCurrentContextWindowId } from '../events/index.js'
import { maybeAutoCompactContext } from '../context/auto-compaction.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { createQueueStateMessage } from '../ws/protocol.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface ToolBatchContext {
  toolRegistry: ToolRegistry
  sessionManager: SessionManager
  sessionId: string
  workdir: string
  turnMetrics: TurnMetrics
  signal?: AbortSignal | undefined
  onMessage?: ((msg: ServerMessage) => void) | undefined
  llmClient?: LLMClientWithModel | undefined
  statsIdentity?: StatsIdentity | undefined
  onToolExecuted?: ((toolCall: ToolCall, result: ToolResult) => void) | undefined
}

export interface ToolBatchResult {
  toolMessages: RequestContextMessage[]
  criteriaChanged: boolean
  returnValueContent?: string | undefined
}

export interface TopLevelLoopConfig {
  mode: ToolMode
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  statsIdentity: StatsIdentity
  signal?: AbortSignal | undefined
  onMessage?: ((msg: ServerMessage) => void) | undefined
  assembleRequest: (input: {
    workdir: string
    messages: RequestContextMessage[]
    injectedFiles: InjectedFile[]
    promptTools: LLMToolDefinition[]
    toolChoice: 'auto' | 'none' | 'required'
    customInstructions?: string
    skills?: import('../skills/types.js').SkillMetadata[]
  }) => {
    systemPrompt: string
    messages: Array<{
      role: 'user' | 'assistant' | 'tool'
      content: string
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      toolCallId?: string
      attachments?: Attachment[]
    }>
    promptContext: PromptContext
  }
  getToolRegistry: () => ToolRegistry
  onToolExecuted?: ((toolCall: ToolCall, result: ToolResult) => void) | undefined
  injectKickoff?: (() => void) | undefined
}

// ============================================================================
// Shared Tool Execution
// ============================================================================

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

export async function executeToolBatch(
  assistantMsgId: string,
  toolCalls: ToolCall[],
  ctx: ToolBatchContext,
): Promise<ToolBatchResult> {
  const eventStore = getEventStore()
  const toolMessages: RequestContextMessage[] = []
  let criteriaChanged = false
  let returnValueContent: string | undefined
  let session = ctx.sessionManager.requireSession(ctx.sessionId)

  for (const toolCall of toolCalls) {
    if (ctx.signal?.aborted) {
      throw new Error('Aborted')
    }

    eventStore.append(ctx.sessionId, createToolCallEvent(assistantMsgId, toolCall))

    if (toolCall.parseError) {
      const toolResult: ToolResult = {
        success: false,
        error: `Failed to parse tool call arguments: ${toolCall.parseError}. Please ensure your JSON function call arguments are valid.`,
        durationMs: 0,
        truncated: false,
      }
      ctx.turnMetrics.addToolTime(toolResult.durationMs)
      eventStore.append(ctx.sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
      toolMessages.push({
        role: 'tool',
        content: `Error: ${toolResult.error}`,
        source: 'history',
        toolCallId: toolCall.id,
      })
      continue
    }

    const onProgress = ctx.onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, ctx.onMessage) : undefined

    let toolResult: ToolResult
    try {
      toolResult = await ctx.toolRegistry.execute(toolCall.name, toolCall.arguments, {
        sessionManager: ctx.sessionManager,
        workdir: ctx.workdir,
        sessionId: ctx.sessionId,
        signal: ctx.signal,
        llmClient: ctx.llmClient,
        statsIdentity: ctx.statsIdentity,
        lspManager: ctx.sessionManager.getLspManager(ctx.sessionId),
        onEvent: ctx.onMessage,
        onProgress,
      })
    } catch (error) {
      if (error instanceof PathAccessDeniedError) {
        toolResult = {
          success: false,
          error: `User denied access to ${error.paths.join(', ')}. If you need this file, explain why and ask for permission.`,
          durationMs: 0,
          truncated: false,
        }
      } else {
        throw error
      }
    }

    ctx.turnMetrics.addToolTime(toolResult.durationMs)
    eventStore.append(ctx.sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))

    ctx.onToolExecuted?.(toolCall, toolResult)

    if (toolCall.name === 'return_value' && !toolCall.parseError) {
      returnValueContent = (toolCall.arguments as Record<string, unknown>)['content'] as string
    }

    toolMessages.push({
      role: 'tool',
      content: toolResult.success 
        ? (toolResult.output ?? 'Success')
        : toolResult.output 
          ? `${toolResult.output}\n\nError: ${toolResult.error}`
          : `Error: ${toolResult.error}`,
      source: 'history',
      toolCallId: toolCall.id,
    })

    const updatedSession = ctx.sessionManager.requireSession(ctx.sessionId)
    if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
      eventStore.append(ctx.sessionId, { type: 'criteria.set', data: { criteria: updatedSession.criteria } })
      session = updatedSession
      criteriaChanged = true
    }
  }

  return { toolMessages, criteriaChanged, returnValueContent }
}

// ============================================================================
// Top-Level Agent Loop (replaces runPlannerTurn / runBuilderTurn)
// ============================================================================

const MAX_FORMAT_RETRIES = 10
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

function toRequestContextMessages(messages: Array<{
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  attachments?: Attachment[]
}>): RequestContextMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    source: 'history' as const,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map((toolCall) => ({ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments })) } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  }))
}

export async function runTopLevelAgentLoop(
  config: TopLevelLoopConfig,
  turnMetrics: TurnMetrics,
): Promise<void> {
  const { mode, sessionManager, sessionId, llmClient, signal, onMessage, statsIdentity } = config
  const eventStore = getEventStore()

  let formatRetryCount = 0

  for (;;) {
    await maybeAutoCompactContext({
      sessionManager,
      sessionId,
      llmClient,
      statsIdentity,
      ...(signal ? { signal } : {}),
    })

    const session = sessionManager.requireSession(sessionId)

    // Inject kickoff prompt (e.g., builder kickoff) on first iteration
    if (formatRetryCount === 0) {
      config.injectKickoff?.()
    }

    const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
    const injectedFiles: InjectedFile[] = files.map(f => ({
      path: f.path,
      content: f.content ?? '',
      source: f.source,
    }))

    const toolRegistry = config.getToolRegistry()
    const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

    const requestMessages = toRequestContextMessages(getContextMessages(sessionId))

    if (formatRetryCount > 0) {
      const correctionMsgId = crypto.randomUUID()
      eventStore.append(sessionId, createMessageStartEvent(correctionMsgId, 'user', FORMAT_CORRECTION_PROMPT, {
        ...(currentWindowMessageOptions ?? {}),
        isSystemGenerated: true,
        messageKind: 'correction',
      }))
      eventStore.append(sessionId, createFormatRetryEvent(formatRetryCount, MAX_FORMAT_RETRIES))
      requestMessages.push({ role: 'user', content: FORMAT_CORRECTION_PROMPT, source: 'runtime' })
    }

    const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
    const skills = await getEnabledSkillMetadata(configDir)

    const assembledRequest = config.assembleRequest({
      workdir: session.workdir,
      messages: requestMessages,
      injectedFiles,
      promptTools: toolRegistry.definitions,
      toolChoice: 'auto',
      ...(instructionContent ? { customInstructions: instructionContent } : {}),
      ...(skills.length > 0 ? { skills } : {}),
    })

    const assistantMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, currentWindowMessageOptions))

    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt,
      llmClient,
      messages: assembledRequest.messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
    })

    const result = await consumeStreamGenerator(streamGen, event => {
      eventStore.append(sessionId, event)
    })

    if (result.xmlFormatError) {
      if (formatRetryCount < MAX_FORMAT_RETRIES) {
        formatRetryCount += 1
        continue
      } else {
        eventStore.append(sessionId, {
          type: 'chat.error',
          data: { error: 'Model repeatedly used XML tool format after 10 retries', recoverable: false },
        })
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'error'))
        throw new Error('XML tool format retry limit exceeded')
      }
    }

    if (result.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, mode)
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
    sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens)

    if (result.toolCalls.length > 0) {
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        promptContext: assembledRequest.promptContext,
      }))

      try {
        await executeToolBatch(assistantMsgId, result.toolCalls, {
          toolRegistry,
          sessionManager,
          sessionId,
          workdir: session.workdir,
          turnMetrics,
          signal,
          onMessage,
          llmClient,
          statsIdentity,
          onToolExecuted: config.onToolExecuted,
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'Aborted') {
          const stats = turnMetrics.buildStats(statsIdentity, mode)
          eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
            stats,
            partial: true,
            promptContext: assembledRequest.promptContext,
          }))
          eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
          throw error
        }
        throw error
      }

      if (signal?.aborted) {
        const stats = turnMetrics.buildStats(statsIdentity, mode)
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      const asapMessages = sessionManager.drainAsapMessages(sessionId)
      for (const asap of asapMessages) {
        const asapMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(asapMsgId, 'user', asap.content, {
          ...getCurrentWindowMessageOptions(sessionId),
          ...(asap.attachments ? { attachments: asap.attachments } : {}),
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: asapMsgId } })
      }
      if (asapMessages.length > 0) {
        onMessage?.(createQueueStateMessage(sessionManager.getQueueState(sessionId)))
      }

      formatRetryCount = 0
      continue
    }

    const stats = turnMetrics.buildStats(statsIdentity, mode)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: result.segments,
      stats,
      promptContext: assembledRequest.promptContext,
    }))
    eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
    break
  }
}
