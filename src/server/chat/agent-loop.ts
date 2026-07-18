/**
 * Unified Agent Execution Loop
 *
 * Extracts the shared execution logic from runPlannerTurn, runBuilderTurn,
 * and executeSubAgent into reusable helpers.
 *
 * - executeToolBatch(): shared tool execution (used by all agent types)
 * - runTopLevelAgentLoop(): replaces duplicated planner/builder turns
 */

import type { InjectedFile, StatsIdentity, ToolCall, ToolMode, ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { RequestContextMessage, MinimalMessage } from './request-context.js'
import type { RetryPatternConfig } from './auto-patterns.js'
import {
  streamLLMPure,
  consumeStreamGenerator,
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createChatDoneEvent,
} from './stream-pure.js'
import { getCurrentContextWindowId, getCurrentWindowMessageOptions } from '../events/index.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { createChatMessageUpdatedMessage, createChatDoneMessage } from '../ws/protocol.js'
import { executeTools, type ToolBatchContext } from './execute-tools.js'
import { createRetryLimiter, type RetryLimiter } from './retry-limiter.js'
import { drainQueue } from './drain-queue.js'
import { COMPACTION_PROMPT } from './prompts.js'
import { logger } from '../utils/logger.js'

function emitPartialDoneEvents(
  _sessionId: string,
  assistantMsgId: string,
  statsIdentity: import('../../shared/types.js').StatsIdentity,
  mode: import('../../shared/types.js').ToolMode,
  turnMetrics: TurnMetrics,
  append: (event: import('../events/types.js').TurnEvent) => void,
  agentType?: 'sub-agent',
): void {
  const stats = turnMetrics.buildStats(statsIdentity, mode)
  append(
    createMessageDoneEvent(assistantMsgId, {
      stats,
      partial: true,
    }),
  )
  append(createChatDoneEvent(assistantMsgId, 'stopped', stats, agentType))
}

function emitDoneAndBreak(
  assistantMsgId: string,
  segments: import('../../shared/types.js').MessageSegment[] | undefined,
  statsIdentity: import('../../shared/types.js').StatsIdentity,
  mode: import('../../shared/types.js').ToolMode,
  turnMetrics: TurnMetrics,
  append: (event: import('../events/types.js').TurnEvent) => void,
  onMessage: ((msg: ServerMessage) => void) | undefined,
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' | 'truncated' | 'step_done',
  agentType?: 'sub-agent',
): void {
  const stats = turnMetrics.buildStats(statsIdentity, mode)
  append(
    createMessageDoneEvent(assistantMsgId, {
      ...(segments ? { segments } : {}),
      stats,
    }),
  )
  append(createChatDoneEvent(assistantMsgId, reason, stats, agentType))
  if (onMessage) {
    onMessage(
      createChatMessageUpdatedMessage(assistantMsgId, {
        isStreaming: false,
        stats,
      }),
    )
    onMessage(createChatDoneMessage(assistantMsgId, reason, stats, agentType))
  }
}

// ============================================================================
// Types
// ============================================================================

export interface TopLevelLoopConfig {
  mode: ToolMode
  retryPatterns?: RetryPatternConfig[]
  maxRetriesPerTurn?: number
  /** Function to append events (provided by orchestrator) */
  append: (event: import('../events/types.js').TurnEvent) => void
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
  }) => Promise<{
    systemPrompt: string
    messages: MinimalMessage[]
    tools: LLMToolDefinition[]
  }>
  getToolRegistry: () => ToolRegistry
  onToolExecuted?: ((toolCall: ToolCall, result: ToolResult) => void) | undefined
  injectKickoff?: (() => void | Promise<void>) | undefined
  /** Called after auto-compaction completes within the loop, before the next iteration.
   *  Reinjects the agent definition reminder into the new context window. */
  injectAgentReminder?: (() => void) | undefined
  /** When set, assistant messages are tagged with sub-agent metadata for scope isolation. */
  subAgentMetadata?: { subAgentId: string; subAgentType: string }
  /** When set and return_value tool is called, emit done events and break immediately. */
  breakOnReturnValue?: boolean
  /** When set, if the loop would normally break without return_value being called,
   *  inject a nudge and continue. Retries up to maxReturnValueNudges times.
   *  Prevents sub-agents from finishing without passing their result back. */
  requireReturnValue?: boolean
  /** Maximum number of return_value nudges before giving up. Default 10. */
  maxReturnValueNudges?: number
  /** Build conversation messages for the LLM, with image processing applied.
   *  Called each iteration to get fresh context. */
  getConversationMessages: () => Promise<RequestContextMessage[]>
  /** When true, the loop starts in compacting mode (used for manual compaction).
   *  After compaction completes, the loop breaks instead of continuing. */
  initialCompacting?: boolean
  /** When true, only warm up the LLM cache by sending system prompt + tools.
   *  Skips message creation, event emission, tool execution — just prefills the KV cache. */
  warmup?: boolean
}

// ============================================================================
// Top-Level Agent Loop (replaces runPlannerTurn / runBuilderTurn)
// ============================================================================

const MAX_TRUNCATION_RETRIES = 3
const CONTINUE_PROMPT = 'Continue your previous response. Do NOT repeat what you already wrote.'

export async function runTopLevelAgentLoop(
  config: TopLevelLoopConfig,
  turnMetrics: TurnMetrics,
): Promise<{ returnValueContent?: string; returnValueResult?: string }> {
  const { mode, sessionManager, sessionId, llmClient, signal, onMessage, statsIdentity } = config
  const append = config.append
  const agentType = config.subAgentMetadata ? ('sub-agent' as const) : undefined

  const retryLimiter: RetryLimiter = createRetryLimiter(config.maxRetriesPerTurn ?? 10)
  let truncationRetryCount = 0
  let returnValueContent: string | undefined
  let returnValueResult: string | undefined
  let currentMaxTokensOverride: number | undefined
  let lastPatternMatch: { pattern: string; field: string; matchedContent: string } | undefined
  let compacting = config.initialCompacting ?? false
  let returnValueNudgeCount = 0

  for (;;) {
    if (signal?.aborted) throw new Error('Aborted')

    // Warmup mode: just assemble the request to populate the cache, then fire a
    // minimal LLM call to prefill the KV cache. No events, no messages, no tools.
    if (config.warmup) {
      const session = sessionManager.requireSession(sessionId)
      const runtimeConfig = getRuntimeConfig()
      const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
      const skills = await getEnabledSkillMetadata(configDir, runtimeConfig.workdir)
      const { content: instructionContent } = await getAllInstructions(session.workdir, session.projectId)
      const toolRegistry = config.getToolRegistry()

      const assembledRequest = await config.assembleRequest({
        workdir: session.workdir,
        messages: [],
        injectedFiles: [],
        promptTools: toolRegistry.definitions,
        toolChoice: 'none',
        ...(instructionContent ? { customInstructions: instructionContent } : {}),
        ...(skills.length > 0 ? { skills } : {}),
      })

      const modelSettings = sessionManager.getCurrentModelSettings(sessionId)

      await llmClient.complete({
        messages: [{ role: 'system', content: assembledRequest.systemPrompt }],
        tools: assembledRequest.tools,
        maxTokens: 1,
        temperature: 0,
        ...(modelSettings ? { modelSettings } : {}),
      })

      return {}
    }

    const session = sessionManager.requireSession(sessionId)

    // Inject kickoff prompt (e.g., builder kickoff) on first iteration
    if (retryLimiter.count() === 0) {
      await config.injectKickoff?.()
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

    const requestMessages = await config.getConversationMessages()

    if (retryLimiter.count() > 0) {
      const continueMsgId = crypto.randomUUID()
      const continueContent = lastPatternMatch
        ? `Your previous response was interrupted because it matched pattern "${lastPatternMatch.pattern}" in ${lastPatternMatch.field}.\nMatched content:\n${lastPatternMatch.matchedContent}\n\n${CONTINUE_PROMPT}`
        : CONTINUE_PROMPT
      append(
        createMessageStartEvent(continueMsgId, 'user', continueContent, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        }),
      )
      append({ type: 'message.done', data: { messageId: continueMsgId } })
      requestMessages.push({ role: 'user', content: continueContent, source: 'history' })
    }

    const runtimeConfig = getRuntimeConfig()
    const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
    const skills = await getEnabledSkillMetadata(configDir, runtimeConfig.workdir)
    if (signal?.aborted) throw new Error('Aborted')

    const assembledRequest = await config.assembleRequest({
      workdir: session.workdir,
      messages: requestMessages,
      injectedFiles,
      promptTools: toolRegistry.definitions,
      toolChoice: 'auto',
      ...(instructionContent ? { customInstructions: instructionContent } : {}),
      ...(skills.length > 0 ? { skills } : {}),
    })

    const assistantMsgId = crypto.randomUUID()
    append(
      createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
        ...(currentWindowMessageOptions ?? {}),
        ...(config.subAgentMetadata
          ? { subAgentId: config.subAgentMetadata.subAgentId, subAgentType: config.subAgentMetadata.subAgentType }
          : {}),
      }),
    )

    const contextState = sessionManager.getContextState(sessionId)
    const previousContextTokens = contextState.currentTokens

    const contextWindow = sessionManager.getCurrentModelContext()
    const availableForOutput = Math.max(256, contextWindow - contextState.currentTokens)

    let modelSettings =
      currentMaxTokensOverride !== undefined
        ? { ...sessionManager.getCurrentModelSettings(sessionId), maxTokens: currentMaxTokensOverride }
        : sessionManager.getCurrentModelSettings(sessionId)

    if (modelSettings) {
      const requestedMaxTokens = modelSettings.maxTokens ?? 16384
      modelSettings = { ...modelSettings, maxTokens: Math.min(requestedMaxTokens, availableForOutput) }
    }

    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt,
      llmClient,
      messages: assembledRequest.messages,
      tools: assembledRequest.tools,
      toolChoice: 'auto',
      signal,
      ...(config.retryPatterns ? { retryPatterns: config.retryPatterns } : {}),
      ...(modelSettings && { modelSettings }),
    })

    const result = await consumeStreamGenerator(streamGen, (event) => {
      append(event)
    })

    // Check if a retry pattern matched mid-stream
    if (result.patternMatch) {
      if (!retryLimiter.canRetry()) {
        append({
          type: 'chat.error',
          data: { error: `Auto-retry limit exceeded after ${retryLimiter.maxRetries()} retries`, recoverable: false },
        })
        append(createChatDoneEvent(assistantMsgId, 'error', undefined, agentType))
        throw new Error('Auto-retry limit exceeded')
      }
      retryLimiter.increment()
      lastPatternMatch = {
        pattern: result.patternMatch.pattern,
        field: result.patternMatch.field,
        matchedContent: result.patternMatch.matchedContent,
      }

      // Emit pattern.retry event
      append({
        type: 'pattern.retry',
        data: {
          messageId: assistantMsgId,
          pattern: result.patternMatch.pattern,
          field: result.patternMatch.field,
          attempt: retryLimiter.count(),
          maxAttempts: retryLimiter.maxRetries(),
          matchedContent: result.patternMatch.matchedContent,
        },
      })

      // Emit system message showing what matched
      const matchMsgId = crypto.randomUUID()
      const matchMessage = `Pattern "${result.patternMatch.pattern}" matched — auto-retry #${retryLimiter.count()}`
      append(
        createMessageStartEvent(matchMsgId, 'user', matchMessage, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        }),
      )
      append({ type: 'message.done', data: { messageId: matchMsgId } })

      continue
    }

    if (result.aborted) {
      emitPartialDoneEvents(sessionId, assistantMsgId, statsIdentity, mode, turnMetrics, append, agentType)
      throw new Error('Aborted')
    }

    turnMetrics.addLLMCall(
      result.timing,
      result.usage.promptTokens,
      result.usage.completionTokens,
      previousContextTokens,
      result.modelParams,
    )
    sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens, config.subAgentMetadata?.subAgentId)

    // Check compaction threshold with fresh promptTokens from LLM.
    // When exceeded, append compaction prompt and let the next iteration
    // handle summarization — same agent, same loop, no nested call.
    if (!compacting) {
      const contextState = sessionManager.getContextState(sessionId)
      const { shouldCompact, appendCompactionPrompt } = await import('../context/compactor.js')
      if (
        shouldCompact(contextState.currentTokens, contextState.maxTokens, runtimeConfig.context.compactionThreshold)
      ) {
        appendCompactionPrompt(sessionId, append)
        compacting = true
        continue
      }
    }

    if (!compacting && result.finishReason === 'length' && result.toolCalls.length === 0) {
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
          }),
        )
        append(createChatDoneEvent(assistantMsgId, 'truncated', stats, agentType))
        break
      }
    }

    if (result.toolCalls.length > 0) {
      if (compacting) {
        const rejectionMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            rejectionMsgId,
            'user',
            `Tool calls are not possible at this stage. STOP and produce a summary for compaction purposes NOW:

${COMPACTION_PROMPT}`,
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: rejectionMsgId } })
        retryLimiter.reset()
        continue
      }

      append(
        createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
        }),
      )

      try {
        const batchContext: ToolBatchContext = {
          toolRegistry,
          sessionManager,
          sessionId,
          workdir: session.worktree ?? session.workdir,
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
        if (config.subAgentMetadata) {
          batchContext.isSubAgent = true
        }
        batchContext.agentTimeout = getRuntimeConfig().agent.toolTimeout
        const batchResult = await executeTools(assistantMsgId, result.toolCalls, batchContext, append)
        if (batchResult.stepDoneCalled) {
          emitDoneAndBreak(
            assistantMsgId,
            result.segments,
            statsIdentity,
            mode,
            turnMetrics,
            append,
            onMessage,
            'step_done',
            agentType,
          )
          break
        }
        if (batchResult.returnValueContent) {
          returnValueContent = batchResult.returnValueContent
          returnValueResult = batchResult.returnValueResult
          if (config.breakOnReturnValue) {
            emitDoneAndBreak(
              assistantMsgId,
              result.segments,
              statsIdentity,
              mode,
              turnMetrics,
              append,
              onMessage,
              'complete',
              agentType,
            )
            break
          }
        }
        if (batchResult.returnValueResult) {
          returnValueResult = batchResult.returnValueResult
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Aborted') {
          emitPartialDoneEvents(sessionId, assistantMsgId, statsIdentity, mode, turnMetrics, append, agentType)
          throw error
        }
        throw error
      }

      if (signal?.aborted) {
        emitPartialDoneEvents(sessionId, assistantMsgId, statsIdentity, mode, turnMetrics, append, agentType)
        throw new Error('Aborted')
      }

      void drainQueue(sessionManager, sessionId, append, onMessage)

      retryLimiter.reset()
      continue
    }

    if (compacting) {
      const summary = result.content?.trim() || result.thinkingContent?.trim() || ''
      if (!summary) {
        append({
          type: 'chat.error',
          data: { error: 'Compaction produced empty summary, continuing with full context', recoverable: true },
        })
        logger.warn('Compaction produced empty summary, continuing', { sessionId })
        compacting = false
        if (config.initialCompacting) break
        continue
      }

      const closedWindowId = getCurrentContextWindowId(sessionId) ?? ''
      const newWindowId = crypto.randomUUID()
      const tokenCountAtClose = result.usage.promptTokens

      append({
        type: 'context.compacted',
        data: { closedWindowId, newWindowId, beforeTokens: tokenCountAtClose, afterTokens: 0, summary },
      })

      append({
        type: 'message.start',
        data: {
          messageId: assistantMsgId,
          role: 'assistant',
          content: summary,
          contextWindowId: newWindowId,
          isCompactionSummary: true,
        },
      })
      append(createMessageDoneEvent(assistantMsgId, { stats: turnMetrics.buildStats(statsIdentity, mode) }))
      append(createChatDoneEvent(assistantMsgId, 'complete', undefined, agentType))

      // Reinject the agent reminder into the new window
      config.injectAgentReminder?.()
      compacting = false

      // Manual compaction (initialCompacting) is a one-shot operation — break after done.
      // Auto-compaction continues the loop for subsequent user messages.
      if (config.initialCompacting) break
      continue
    }

    // If sub-agent finished without calling return_value, nudge and retry
    if (config.requireReturnValue && !returnValueContent) {
      const maxNudges = config.maxReturnValueNudges ?? 10
      if (returnValueNudgeCount < maxNudges) {
        returnValueNudgeCount++
        const nudgeMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            nudgeMsgId,
            'user',
            'You must call return_value with a summary of your findings before finishing. Call return_value now.',
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
              ...(config.subAgentMetadata
                ? { subAgentId: config.subAgentMetadata.subAgentId, subAgentType: config.subAgentMetadata.subAgentType }
                : {}),
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: nudgeMsgId } })
        continue
      }
    }

    const stats = turnMetrics.buildStats(statsIdentity, mode)
    append(
      createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
      }),
    )
    append(createChatDoneEvent(assistantMsgId, 'complete', stats, agentType))

    break
  }

  return {
    ...(returnValueContent ? { returnValueContent } : {}),
    ...(returnValueResult ? { returnValueResult } : {}),
  }
}
