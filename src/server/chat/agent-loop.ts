/**
 * Unified Agent Execution Loop
 *
 * Extracts the shared execution logic from runPlannerTurn, runBuilderTurn,
 * and executeSubAgent into reusable helpers.
 *
 * - executeToolBatch(): shared tool execution (used by all agent types)
 * - runTopLevelAgentLoop(): replaces duplicated planner/builder turns
 */

import type { InjectedFile, PromptContext, StatsIdentity, ToolCall, ToolMode, ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { RequestContextMessage, MinimalMessage, AssemblyResult } from './request-context.js'
import { createAssemblyResult } from './request-context.js'
import {
  streamLLMPure,
  consumeStreamGenerator,
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createChatDoneEvent,
  createFormatRetryEvent,
} from './stream-pure.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import { getCurrentContextWindowId } from '../events/index.js'
import { maybeAutoCompactContext } from '../context/auto-compaction.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import {
  createQueueStateMessage,
  createChatVisionFallbackMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createChatMessageUpdatedMessage,
} from '../ws/protocol.js'
import { getConversationMessages } from './conversation-history.js'
import { modelSupportsVision } from '../llm/profiles.js'
import { executeTools, type ToolBatchContext } from './execute-tools.js'
import { matchAutoPatterns, type AutoPattern } from './auto-patterns.js'

function emitPartialDoneEvents(
  _sessionId: string,
  assistantMsgId: string,
  statsIdentity: import('../../shared/types.js').StatsIdentity,
  mode: import('../../shared/types.js').ToolMode,
  turnMetrics: TurnMetrics,
  promptContext: PromptContext,
  append: (event: import('../events/types.js').TurnEvent) => void,
): void {
  const stats = turnMetrics.buildStats(statsIdentity, mode)
  append(
    createMessageDoneEvent(assistantMsgId, {
      stats,
      partial: true,
      promptContext,
    }),
  )
  append(createChatDoneEvent(assistantMsgId, 'stopped', stats))
}

// ============================================================================
// Types
// ============================================================================

export interface TopLevelLoopConfig {
  mode: ToolMode
  loopMode?: 'normal' | 'compaction'
  autoPatterns?: AutoPattern[]
  /** Function to append events (provided by orchestrator) */
  append: (event: import('../events/types.js').TurnEvent) => void
  /** If provided, use this cached system prompt instead of assembling fresh */
  cachedSystemPrompt?: string
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
    messages: MinimalMessage[]
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

// ============================================================================
// Top-Level Agent Loop (replaces runPlannerTurn / runBuilderTurn)
// ============================================================================

const MAX_FORMAT_RETRIES = 10
const MAX_TRUNCATION_RETRIES = 3
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <function=>, <parameter=>, or <invoke=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

export async function runTopLevelAgentLoop(
  config: TopLevelLoopConfig,
  turnMetrics: TurnMetrics,
): Promise<{ returnValueContent?: string; returnValueResult?: string }> {
  const { mode, sessionManager, sessionId, llmClient, signal, onMessage, statsIdentity } = config
  const append = config.append

  let formatRetryCount = 0
  let truncationRetryCount = 0
  let returnValueContent: string | undefined
  let returnValueResult: string | undefined
  let currentMaxTokensOverride: number | undefined

  for (;;) {
    if (config.loopMode !== 'compaction') {
      await maybeAutoCompactContext({
        sessionManager,
        sessionId,
        llmClient,
        statsIdentity,
        ...(signal ? { signal } : {}),
      })
    }

    if (signal?.aborted) throw new Error('Aborted')

    const session = sessionManager.requireSession(sessionId)

    // Inject kickoff prompt (e.g., builder kickoff) on first iteration
    if (formatRetryCount === 0) {
      config.injectKickoff?.()
    }

    const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
    if (signal?.aborted) throw new Error('Aborted')

    const injectedFiles: InjectedFile[] = files.map((f) => ({
      path: f.path,
      content: f.content ?? '',
      source: f.source,
    }))

    const toolRegistry = config.getToolRegistry()
    const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

    const modelName = llmClient.getModel()
    const stripAttachments = !modelSupportsVision(modelName)
    const requestMessages = getConversationMessages(
      { type: 'toplevel', sessionId },
      stripAttachments ? { stripAttachments: true } : undefined,
    )

    if (formatRetryCount > 0) {
      const correctionMsgId = crypto.randomUUID()
      append(
        createMessageStartEvent(correctionMsgId, 'user', FORMAT_CORRECTION_PROMPT, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        }),
      )
      append(createFormatRetryEvent(formatRetryCount, MAX_FORMAT_RETRIES))
      // Add correction directly so the LLM sees it this iteration.
      // It's also emitted to the event store, so it appears in history on subsequent iterations.
      requestMessages.push({ role: 'user', content: FORMAT_CORRECTION_PROMPT, source: 'history' })
    }

    const runtimeConfig = getRuntimeConfig()
    const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
    const skills = await getEnabledSkillMetadata(configDir, runtimeConfig.workdir)
    if (signal?.aborted) throw new Error('Aborted')

    const isDynamicMode = getSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT) === 'true'

    const assembleFreshRequest = () =>
      config.assembleRequest({
        workdir: session.workdir,
        messages: requestMessages,
        injectedFiles,
        promptTools: toolRegistry.definitions,
        toolChoice: 'auto',
        ...(instructionContent ? { customInstructions: instructionContent } : {}),
        ...(skills.length > 0 ? { skills } : {}),
      })

    let assembledRequest: AssemblyResult

    if (config.cachedSystemPrompt && !isDynamicMode) {
      assembledRequest = createAssemblyResult({
        systemPrompt: config.cachedSystemPrompt,
        messages: requestMessages,
        injectedFiles,
        requestTools: toolRegistry.definitions,
        toolChoice: 'auto',
        disableThinking: false,
      })
    } else {
      assembledRequest = assembleFreshRequest()
    }

    const assistantMsgId = crypto.randomUUID()
    append(createMessageStartEvent(assistantMsgId, 'assistant', undefined, currentWindowMessageOptions))

    const doOnMessage = (msg: ServerMessage) => {
      onMessage?.(msg)
    }

    const onVisionFallbackStart = (attachmentId: string, filename?: string) => {
      const eventData: { messageId: string; attachmentId: string; filename?: string } = {
        messageId: assistantMsgId,
        attachmentId,
      }
      if (filename !== undefined) {
        eventData.filename = filename
      }
      append({
        type: 'vision_fallback.start',
        data: eventData,
      })
      const payload: { type: 'start'; messageId: string; attachmentId: string; filename?: string } = {
        type: 'start',
        messageId: assistantMsgId,
        attachmentId,
      }
      if (filename !== undefined) {
        payload.filename = filename
      }
      doOnMessage(createChatVisionFallbackMessage(payload))
    }
    const onVisionFallbackDone = (attachmentId: string, description: string) => {
      append({
        type: 'vision_fallback.done',
        data: { messageId: assistantMsgId, attachmentId, description },
      })
      doOnMessage(
        createChatVisionFallbackMessage({ type: 'done', messageId: assistantMsgId, attachmentId, description }),
      )
    }

    const previousContextTokens = sessionManager.getContextState(sessionId).currentTokens

    const modelSettings =
      currentMaxTokensOverride !== undefined
        ? { ...sessionManager.getCurrentModelSettings(), maxTokens: currentMaxTokensOverride }
        : sessionManager.getCurrentModelSettings()

    const disableXmlProtection = getSetting('llm.disableXmlProtection') === 'true'

    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt,
      llmClient,
      messages: assembledRequest.messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
      disableXmlProtection,
      onVisionFallbackStart,
      onVisionFallbackDone,
      ...(modelSettings && { modelSettings }),
    })

    const result = await consumeStreamGenerator(streamGen, (event) => {
      append(event)
    })

    // Check auto-loop patterns (configurable + default XML format protection)
    const autoPatterns: AutoPattern[] = [
      // Default XML format protection
      {
        match: (_content: string, _thinking?: string, context?: { xmlFormatError?: boolean }) =>
          context?.xmlFormatError === true,
        response: FORMAT_CORRECTION_PROMPT,
      },
      ...(config.autoPatterns ?? []),
    ]
    const matches = matchAutoPatterns(result.content, result.thinkingContent, autoPatterns, {
      xmlFormatError: result.xmlFormatError,
    })
    if (matches.length > 0) {
      if (result.xmlFormatError) {
        if (formatRetryCount >= MAX_FORMAT_RETRIES) {
          append({
            type: 'chat.error',
            data: { error: 'Model repeatedly used XML tool format after 10 retries', recoverable: false },
          })
          append(createChatDoneEvent(assistantMsgId, 'error'))
          throw new Error('XML tool format retry limit exceeded')
        }
        formatRetryCount += 1
        append(createFormatRetryEvent(formatRetryCount, MAX_FORMAT_RETRIES))
      } else {
        formatRetryCount = 0
      }
      for (const match of matches) {
        const autoMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(autoMsgId, 'user', match.response, {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          }),
        )
        append({ type: 'message.done', data: { messageId: autoMsgId } })
      }
      continue
    }

    if (result.aborted) {
      emitPartialDoneEvents(
        sessionId,
        assistantMsgId,
        statsIdentity,
        mode,
        turnMetrics,
        assembledRequest.promptContext,
        append,
      )
      throw new Error('Aborted')
    }

    turnMetrics.addLLMCall(
      result.timing,
      result.usage.promptTokens,
      result.usage.completionTokens,
      previousContextTokens,
      result.modelParams,
    )
    sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens)

    // Check compaction threshold with fresh promptTokens from LLM
    if (config.loopMode !== 'compaction') {
      const contextState = sessionManager.getContextState(sessionId)
      const runtimeConfig = getRuntimeConfig()
      const { shouldCompact } = await import('../context/compactor.js')
      if (
        shouldCompact(contextState.currentTokens, contextState.maxTokens, runtimeConfig.context.compactionThreshold)
      ) {
        const { maybeAutoCompactContext } = await import('../context/auto-compaction.js')
        await maybeAutoCompactContext({
          sessionManager,
          sessionId,
          llmClient,
          statsIdentity,
          ...(signal ? { signal } : {}),
        })
      }
    }

    if (result.finishReason === 'length' && result.toolCalls.length === 0) {
      if (truncationRetryCount < MAX_TRUNCATION_RETRIES) {
        truncationRetryCount += 1
        const currentMaxTokens = result.modelParams?.maxTokens ?? 16384
        const promptTokens = result.usage.promptTokens
        const contextWindow = sessionManager.getCurrentModelContext()
        const newMaxTokens = Math.min(Math.floor(currentMaxTokens * 1.5), contextWindow - promptTokens - 2048)
        currentMaxTokensOverride = newMaxTokens
        // Finalize the truncated assistant message so the frontend properly closes it
        const interimStats = turnMetrics.buildStats(statsIdentity, mode)
        append(
          createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            stats: interimStats,
            promptContext: assembledRequest.promptContext,
          }),
        )
        // Tell the frontend to fold the streaming message back into messages
        onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false }))
        // Emit continue message to event store so getConversationMessages picks it up next iteration
        // We don't broadcast it via WebSocket, so the frontend won't see it
        const continueMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            continueMsgId,
            'user',
            'Continue your previous response exactly where you left off.',
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: continueMsgId } })
        continue
      } else {
        // Exhausted retries, emit truncated
        const stats = turnMetrics.buildStats(statsIdentity, mode)
        append(
          createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            stats,
            partial: true,
            promptContext: assembledRequest.promptContext,
          }),
        )
        append(createChatDoneEvent(assistantMsgId, 'truncated', stats))
        break
      }
    }

    if (result.toolCalls.length > 0) {
      if (config.loopMode === 'compaction') {
        const rejectionMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            rejectionMsgId,
            'user',
            'Compaction in progress — tool calls are not possible at this stage. Only produce a summary for compaction purposes.',
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: rejectionMsgId } })
        formatRetryCount = 0
        continue
      }

      append(
        createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
          promptContext: assembledRequest.promptContext,
        }),
      )

      try {
        const batchContext: ToolBatchContext = {
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
        }
        if (session.dangerLevel) {
          batchContext.dangerLevel = session.dangerLevel
        }
        batchContext.agentTimeout = getRuntimeConfig().agent.toolTimeout
        const batchResult = await executeTools(assistantMsgId, result.toolCalls, batchContext, append)
        if (batchResult.returnValueContent) {
          returnValueContent = batchResult.returnValueContent
        }
        if (batchResult.returnValueResult) {
          returnValueResult = batchResult.returnValueResult
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Aborted') {
          emitPartialDoneEvents(
            sessionId,
            assistantMsgId,
            statsIdentity,
            mode,
            turnMetrics,
            assembledRequest.promptContext,
            append,
          )
          throw error
        }
        throw error
      }

      if (signal?.aborted) {
        emitPartialDoneEvents(
          sessionId,
          assistantMsgId,
          statsIdentity,
          mode,
          turnMetrics,
          assembledRequest.promptContext,
          append,
        )
        throw new Error('Aborted')
      }

      const asapMessages = sessionManager.drainAsapMessages(sessionId)
      for (const asap of asapMessages) {
        const asapMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(asapMsgId, 'user', asap.content, {
            ...getCurrentWindowMessageOptions(sessionId),
            ...(asap.attachments ? { attachments: asap.attachments } : {}),
          }),
        )
        append({ type: 'message.done', data: { messageId: asapMsgId } })

        // Broadcast message events to frontend so it knows about the user message
        // before tool.preparing events arrive for the assistant response
        const message: import('../../shared/types.js').Message = {
          id: asapMsgId,
          role: 'user',
          content: asap.content,
          timestamp: new Date().toISOString(),
          ...(asap.attachments ? { attachments: asap.attachments } : {}),
        }
        onMessage?.(createChatMessageMessage(message))
        onMessage?.(createChatDoneMessage(asapMsgId, 'complete'))
      }
      if (asapMessages.length > 0) {
        onMessage?.(createQueueStateMessage(sessionManager.getQueueState(sessionId)))
      }

      formatRetryCount = 0
      continue
    }

    if (config.loopMode === 'compaction') {
      const summary = result.content?.trim() || result.thinkingContent?.trim() || ''
      if (!summary) {
        append({
          type: 'chat.error',
          data: { error: 'Compaction produced empty summary', recoverable: false },
        })
        append(createChatDoneEvent(assistantMsgId, 'error'))
        throw new Error('Compaction produced empty summary')
      }

      const closedWindowId = getCurrentContextWindowId(sessionId) ?? ''
      const newWindowId = crypto.randomUUID()
      const tokenCountAtClose = result.usage.promptTokens

      append({
        type: 'context.compacted',
        data: { closedWindowId, newWindowId, beforeTokens: tokenCountAtClose, afterTokens: 0, summary },
      })

      append(createMessageStartEvent(assistantMsgId, 'assistant', summary, currentWindowMessageOptions))
      append(createMessageDoneEvent(assistantMsgId, { stats: turnMetrics.buildStats(statsIdentity, mode) }))
      append(createChatDoneEvent(assistantMsgId, 'complete'))

      break
    }

    const stats = turnMetrics.buildStats(statsIdentity, mode)
    append(
      createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
        promptContext: assembledRequest.promptContext,
      }),
    )
    append(createChatDoneEvent(assistantMsgId, 'complete', stats))

    const currentWindowMessages = sessionManager.getCurrentWindowMessages(sessionId)
    const lastUserMessage = [...currentWindowMessages].reverse().find((m) => m.role === 'user')
    if (lastUserMessage) {
      sessionManager.updateMessage(sessionId, lastUserMessage.id, { promptContext: assembledRequest.promptContext })
    }

    break
  }

  return {
    ...(returnValueContent ? { returnValueContent } : {}),
    ...(returnValueResult ? { returnValueResult } : {}),
  }
}
