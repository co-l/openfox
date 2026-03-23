/**
 * Chat Orchestrator
 *
 * Orchestrates chat turns by:
 * 1. Consuming pure generators that yield TurnEvents
 * 2. Appending events to EventStore
 * 3. Executing tools and yielding tool events
 * 4. Creating snapshots at end of turn
 *
 * This is the ONE place where events get appended to the store.
 */

import type { Attachment, ContextState, Criterion, InjectedFile, MessageStats, PromptContext, StatsIdentity, Todo, ToolCall, ToolMode, ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionSnapshot } from '../events/types.js'
import { getEventStore, getContextMessages, getCurrentContextWindowId } from '../events/index.js'
import { buildSnapshotFromSessionState } from '../events/folding.js'
import type { SessionManager } from '../session/index.js'
import { getToolRegistryForMode, AskUserInterrupt, PathAccessDeniedError } from '../tools/index.js'
import { BUILDER_KICKOFF_PROMPT, VERIFIER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMPure, consumeStreamGenerator, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent, createFormatRetryEvent } from './stream-pure.js'
import { createToolProgressHandler } from './tool-streaming.js'
import { maybeAutoCompactContext } from '../context/auto-compaction.js'
import { getAllInstructions } from '../context/instructions.js'
import { logger } from '../utils/logger.js'
import { assembleBuilderRequest, assemblePlannerRequest, assembleVerifierRequest, type RequestContextMessage } from './request-context.js'
import { createSubAgentManager } from '../sub-agents/manager.js'
import type { SubAgentType } from '../sub-agents/types.js'

// Re-export for runner orchestrator
export { TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent }

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

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
    source: 'history',
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map((toolCall) => ({ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments })) } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  }))
}

// ============================================================================
// Constants
// ============================================================================

const MAX_FORMAT_RETRIES = 10
const MAX_CONSECUTIVE_VERIFIER_NUDGES = 5
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`
const VERIFIER_STALL_REASON = 'Verifier stopped repeatedly before terminalizing verification after repeated nudges.'

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorOptions {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  statsIdentity?: StatsIdentity
  signal?: AbortSignal
  injectBuilderKickoff?: boolean
  /** Optional callback for WebSocket forwarding (temporary, until WS layer is refactored) */
  onMessage?: (msg: ServerMessage) => void
}

function resolveStatsIdentity(options: OrchestratorOptions): StatsIdentity {
  const model = options.llmClient.getModel()

  if (options.statsIdentity) {
    return {
      ...options.statsIdentity,
      model,
    }
  }

  return {
    providerId: `provider:${model}`,
    providerName: 'Unknown Provider',
    backend: 'unknown',
    model,
  }
}

// ============================================================================
// Core Orchestrator
// ============================================================================

/**
 * Run a chat turn in the current mode.
 * Appends all events to EventStore and creates a snapshot at end of turn.
 */
export async function runChatTurn(options: OrchestratorOptions): Promise<void> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const statsIdentity = resolveStatsIdentity(options)

  const session = sessionManager.requireSession(sessionId)
  const mode = session.mode

  logger.debug('Starting chat turn', { sessionId, mode })

  // Track metrics across the turn
  const turnMetrics = new TurnMetrics()

  try {
    // Run the appropriate handler based on mode
    switch (mode) {
      case 'planner':
        await runPlannerTurn(options, turnMetrics)
        break
      case 'builder':
        await runBuilderTurn(options, turnMetrics)
        break
    }

    // Create end-of-turn snapshot
    const snapshot = buildSnapshot(sessionManager, sessionId, turnMetrics.buildStats(statsIdentity, mode))
    const snapshotEvent = eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })

    // Clean up old events that are now contained in snapshots
    // This keeps the EventStore bounded while preserving full history in snapshots
    const deletedCount = eventStore.cleanupOldEvents(sessionId)
    if (deletedCount > 0) {
      logger.debug('Cleaned up old events after snapshot', { sessionId, deletedCount, snapshotSeq: snapshotEvent.seq })
    }

  } catch (error) {
    if (error instanceof AskUserInterrupt) {
      // Emit waiting for user event
      const waitMsgId = crypto.randomUUID()
      eventStore.append(sessionId, createMessageStartEvent(waitMsgId, 'user', 'Waiting for user input...', {
        ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
      }))
      eventStore.append(sessionId, createChatDoneEvent(waitMsgId, 'waiting_for_user'))
      return
    }

    if (error instanceof PathAccessDeniedError) {
      const errorMsgId = crypto.randomUUID()
      const reasonText = error.reason === 'sensitive_file' 
        ? 'sensitive files that may contain secrets'
        : error.reason === 'both'
        ? 'files outside the project and sensitive files'
        : 'files outside the project directory'
      eventStore.append(sessionId, {
        type: 'chat.error',
        data: {
          error: `User denied access to ${reasonText}.`,
          recoverable: false,
        },
      })
      eventStore.append(sessionId, createMessageStartEvent(errorMsgId, 'user', `Access denied: ${error.paths.join(', ')}. If you need this file, explain why and ask the user for permission.`, {
        ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
        isSystemGenerated: true,
        messageKind: 'correction',
      }))
      eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
      return
    }

    if (error instanceof Error && error.message === 'Aborted') {
      // User abort - handled gracefully
      return
    }

    // Unknown error
    logger.error('Chat turn error', { sessionId, mode, error })
    const errorMsgId = crypto.randomUUID()
    eventStore.append(sessionId, {
      type: 'chat.error',
      data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        recoverable: false,
      },
    })
    eventStore.append(sessionId, createMessageStartEvent(errorMsgId, 'user', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
      isSystemGenerated: true,
      messageKind: 'correction',
    }))
    eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
  } finally {
    eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
  }
}

// ============================================================================
// Planner Turn
// ============================================================================

async function runPlannerTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics,
  formatRetryCount = 0
): Promise<void> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const statsIdentity = resolveStatsIdentity(options)

  await maybeAutoCompactContext({
    sessionManager,
    sessionId,
    llmClient,
    statsIdentity,
    ...(signal ? { signal } : {}),
  })

  const session = sessionManager.requireSession(sessionId)

  // Load instructions
  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = files.map(f => ({
    path: f.path,
    content: f.content ?? '',
    source: f.source,
  }))

  const toolRegistry = getToolRegistryForMode('planner')
  const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

  // Build messages from current context window only
  const requestMessages = toRequestContextMessages(getContextMessages(sessionId))

  // Handle format retry
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

  const assembledRequest = assemblePlannerRequest({
    workdir: session.workdir,
    messages: requestMessages,
    injectedFiles,
    promptTools: toolRegistry.definitions,
    toolChoice: 'auto',
    ...(instructionContent ? { customInstructions: instructionContent } : {}),
  })

  // Create assistant message with current context window ID
  const assistantMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, currentWindowMessageOptions))

  // Stream LLM response using pure generator
  const streamGen = streamLLMPure({
    messageId: assistantMsgId,
    systemPrompt: assembledRequest.systemPrompt,
    llmClient,
    messages: assembledRequest.messages,
    tools: toolRegistry.definitions,
    toolChoice: 'auto',
    signal,
  })

  // Consume generator and append events
  const result = await consumeStreamGenerator(streamGen, event => {
    eventStore.append(sessionId, event)
  })

  // Handle XML format error
  if (result.xmlFormatError) {
    if (formatRetryCount < MAX_FORMAT_RETRIES) {
      return runPlannerTurn(options, turnMetrics, formatRetryCount + 1)
    } else {
      eventStore.append(sessionId, {
        type: 'chat.error',
        data: { error: 'Model repeatedly used XML tool format after 10 retries', recoverable: false },
      })
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'error'))
      throw new Error('XML tool format retry limit exceeded')
    }
  }

  // Handle abort
  if (result.aborted) {
    const stats = turnMetrics.buildStats(statsIdentity, 'planner')
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      stats,
      partial: true,
      promptContext: assembledRequest.promptContext,
    }))
    eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
    throw new Error('Aborted')
  }

  // Track metrics and update context size for frontend display
  turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
  sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens)

  // Execute tool calls (if any)
  if (result.toolCalls.length > 0) {
    // Emit message done WITHOUT stats (intermediate message)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: result.segments,
      promptContext: assembledRequest.promptContext,
    }))
    
    for (const toolCall of result.toolCalls) {
      // Check abort before each tool execution
      if (signal?.aborted) {
        const stats = turnMetrics.buildStats(statsIdentity, 'planner')
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

      // Check for parse error - return error result without executing
      if (toolCall.parseError) {
        const toolResult: ToolResult = {
          success: false,
          error: `Failed to parse tool call arguments: ${toolCall.parseError}. Please ensure your JSON function call arguments are valid.`,
          durationMs: 0,
          truncated: false,
        }
        turnMetrics.addToolTime(toolResult.durationMs)
        eventStore.append(sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
        continue
      }

      // Create progress handler for streaming output (run_command only)
      const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

      let toolResult: ToolResult
      try {
        toolResult = await toolRegistry.execute(toolCall.name, toolCall.arguments, {
          sessionManager,
          workdir: session.workdir,
          sessionId,
          signal,
          lspManager: sessionManager.getLspManager(sessionId),
          onEvent: onMessage,
          onProgress,
        })
      } catch (error) {
        if (error instanceof PathAccessDeniedError) {
          // User denied access - return as tool error with helpful message
          toolResult = {
            success: false,
            error: `User denied access to ${error.paths.join(', ')}. If you need this file, explain why and ask for permission.`,
            durationMs: 0,
            truncated: false,
          }
        } else {
          throw error  // Re-throw other errors
        }
      }

      turnMetrics.addToolTime(toolResult.durationMs)
      eventStore.append(sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))

      // Check criteria changes
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        eventStore.append(sessionId, { type: 'criteria.set', data: { criteria: updatedSession.criteria } })
      }
    }

    // Check abort before continuing with another LLM call
    if (signal?.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, 'planner')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Continue with another response
    return runPlannerTurn(options, turnMetrics)
  }

  // Final response - emit message.done WITH stats and chat.done
  const stats = turnMetrics.buildStats(statsIdentity, 'planner')
  eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
    segments: result.segments,
    stats,
    promptContext: assembledRequest.promptContext,
  }))
  eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
}

// ============================================================================
// Builder Turn
// ============================================================================

export async function runBuilderTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics,
  formatRetryCount = 0
): Promise<void> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const statsIdentity = resolveStatsIdentity(options)

  await maybeAutoCompactContext({
    sessionManager,
    sessionId,
    llmClient,
    statsIdentity,
    ...(signal ? { signal } : {}),
  })

  const session = sessionManager.requireSession(sessionId)

  // Add builder kickoff prompt on first entry (if not already present)
  // This tells the LLM to start implementing the criteria
  if (options.injectBuilderKickoff === true && formatRetryCount === 0) {
    const events = eventStore.getEvents(sessionId)
    const hasBuilderKickoff = events.some(e => {
      if (e.type !== 'message.start') return false
      const data = e.data as { messageKind?: string; content?: string }
      return data.messageKind === 'auto-prompt' && data.content?.includes('fulfil the')
    })

    if (!hasBuilderKickoff) {
      const kickoffMsgId = crypto.randomUUID()
      const kickoffContent = BUILDER_KICKOFF_PROMPT(session.criteria.length)
      eventStore.append(sessionId, createMessageStartEvent(kickoffMsgId, 'user', kickoffContent, {
        ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
      }))
      eventStore.append(sessionId, { type: 'message.done', data: { messageId: kickoffMsgId } })
    }
  }

  // Load instructions
  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = files.map(file => ({
    path: file.path,
    content: file.content ?? '',
    source: file.source,
  }))

  const toolRegistry = getToolRegistryForMode('builder')
  const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

  // Build messages from current context window only
  const requestMessages = toRequestContextMessages(getContextMessages(sessionId))

  // Handle format retry
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

  const assembledRequest = assembleBuilderRequest({
    workdir: session.workdir,
    messages: requestMessages,
    injectedFiles,
    promptTools: toolRegistry.definitions,
    toolChoice: 'auto',
    ...(instructionContent ? { customInstructions: instructionContent } : {}),
  })

  // Create assistant message with current context window ID
  const assistantMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, currentWindowMessageOptions))

  // Stream LLM response using pure generator
  const streamGen = streamLLMPure({
    messageId: assistantMsgId,
    systemPrompt: assembledRequest.systemPrompt,
    llmClient,
    messages: assembledRequest.messages,
    tools: toolRegistry.definitions,
    toolChoice: 'auto',
    signal,
  })

  // Consume generator and append events
  const result = await consumeStreamGenerator(streamGen, event => {
    eventStore.append(sessionId, event)
  })

  // Handle XML format error
  if (result.xmlFormatError) {
    if (formatRetryCount < MAX_FORMAT_RETRIES) {
      return runBuilderTurn(options, turnMetrics, formatRetryCount + 1)
    } else {
      eventStore.append(sessionId, {
        type: 'chat.error',
        data: { error: 'Model repeatedly used XML tool format after 10 retries', recoverable: false },
      })
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'error'))
      throw new Error('XML tool format retry limit exceeded')
    }
  }

  // Handle abort
  if (result.aborted) {
    const stats = turnMetrics.buildStats(statsIdentity, 'builder')
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      stats,
      partial: true,
      promptContext: assembledRequest.promptContext,
    }))
    eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
    throw new Error('Aborted')
  }

  // Track metrics and update context size for frontend display
  turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
  sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens)

  // Execute tool calls (if any)
  if (result.toolCalls.length > 0) {
    // Emit message done WITHOUT stats (intermediate message)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: result.segments,
      promptContext: assembledRequest.promptContext,
    }))
    
    for (const toolCall of result.toolCalls) {
      // Check abort before each tool execution
      if (signal?.aborted) {
        const stats = turnMetrics.buildStats(statsIdentity, 'builder')
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

      // Check for parse error - return error result without executing
      if (toolCall.parseError) {
        const toolResult: ToolResult = {
          success: false,
          error: `Failed to parse tool call arguments: ${toolCall.parseError}. Please ensure your JSON function call arguments are valid.`,
          durationMs: 0,
          truncated: false,
        }
        turnMetrics.addToolTime(toolResult.durationMs)
        eventStore.append(sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
        continue
      }

      // Create progress handler for streaming output (run_command only)
      const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

      let toolResult: ToolResult
      try {
        toolResult = await toolRegistry.execute(toolCall.name, toolCall.arguments, {
          sessionManager,
          workdir: session.workdir,
          sessionId,
          signal,
          lspManager: sessionManager.getLspManager(sessionId),
          onEvent: onMessage,
          onProgress,
        })
      } catch (error) {
        if (error instanceof PathAccessDeniedError) {
          // User denied access - return as tool error with helpful message
          toolResult = {
            success: false,
            error: `User denied access to ${error.paths.join(', ')}. If you need this file, explain why and ask for permission.`,
            durationMs: 0,
            truncated: false,
          }
        } else {
          throw error  // Re-throw other errors
        }
      }

      turnMetrics.addToolTime(toolResult.durationMs)
      eventStore.append(sessionId, createToolResultEvent(assistantMsgId, toolCall.id, toolResult))

      // Track modified files
      if (toolResult.success && ['write_file', 'edit_file'].includes(toolCall.name)) {
        const path = toolCall.arguments['path'] as string
        sessionManager.addModifiedFile(sessionId, path)
      }

      // Check criteria changes
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        eventStore.append(sessionId, { type: 'criteria.set', data: { criteria: updatedSession.criteria } })
      }
    }

    // Check abort before continuing with another LLM call
    if (signal?.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, 'builder')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Continue with another response
    return runBuilderTurn(options, turnMetrics)
  }

  // Final response - emit message.done WITH stats and chat.done
  const stats = turnMetrics.buildStats(statsIdentity, 'builder')
  eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
    segments: result.segments,
    stats,
    promptContext: assembledRequest.promptContext,
  }))
  eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
}

// ============================================================================
// Verifier Turn (Fresh Context)
// ============================================================================

export interface VerifierResult {
  allPassed: boolean
  failed: Array<{ id: string; reason: string }>
}

/**
 * Run a verifier turn with fresh context using Sub-Agent framework.
 * Unlike builder/planner, verifier uses only summary + criteria, not full conversation.
 */
export async function runVerifierTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics
): Promise<VerifierResult> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const statsIdentity = resolveStatsIdentity(options)

  let session = sessionManager.requireSession(sessionId)

  // Check if there's anything to verify
  const toVerify = session.criteria.filter(c => c.status.type === 'completed')
  if (toVerify.length === 0) {
    logger.debug('Nothing to verify', { sessionId })
    return { allPassed: true, failed: [] }
  }

  // Use SubAgentManager to execute verifier
  const subAgentManager = createSubAgentManager()
  const toolRegistry = getToolRegistryForMode('verifier')

  try {
    const result = await subAgentManager.executeSubAgent(
      'verifier' as SubAgentType,
      VERIFIER_KICKOFF_PROMPT,
      sessionManager,
      sessionId,
      llmClient,
      toolRegistry
    )

    // Track metrics (sub-agent execution)
    turnMetrics.addLLMCall({ ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 }, 0, 0)

    logger.debug('Verifier sub-agent completed', { sessionId, resultLength: result.length })

    // Check results from session state
    session = sessionManager.requireSession(sessionId)
    const failed = session.criteria
      .filter(c => c.status.type === 'failed')
      .map(c => ({
        id: c.id,
        reason: c.status.type === 'failed' ? c.status.reason : 'unknown',
      }))

    if (failed.length > 0) {
      logger.warn('Verification failed', { sessionId, failed: failed.length })
    } else {
      logger.debug('All criteria verified', { sessionId })
    }

    return { allPassed: failed.length === 0, failed }
  } catch (error) {
    logger.error('Verifier sub-agent error', { sessionId, error })
    throw error
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getCriteriaAwaitingVerification(criteria: Criterion[]): Criterion[] {
  return criteria.filter((criterion) => criterion.status.type === 'completed')
}

function buildVerifierNudgeContent(criteria: Criterion[]): string {
  const ids = criteria.map((criterion) => criterion.id).join(', ')
  return `You stopped before finalizing verification. ${criteria.length} criteria still need a terminal verification result. Use pass_criterion or fail_criterion for each remaining criterion: ${ids}.`
}

function markCriteriaFailedAfterVerifierStall(
  sessionManager: SessionManager,
  sessionId: string,
  criteria: Criterion[],
): void {
  const timestamp = new Date().toISOString()

  for (const criterion of criteria) {
    sessionManager.updateCriterionStatus(sessionId, criterion.id, {
      type: 'failed',
      failedAt: timestamp,
      reason: VERIFIER_STALL_REASON,
    })

    sessionManager.addCriterionAttempt(sessionId, criterion.id, {
      attemptNumber: criterion.attempts.length + 1,
      status: 'failed',
      timestamp,
      details: VERIFIER_STALL_REASON,
    })
  }
}

/**
 * Build a snapshot of current session state.
 */
function buildSnapshot(sessionManager: SessionManager, sessionId: string, lastStats?: MessageStats): SessionSnapshot {
  const eventStore = getEventStore()
  const session = sessionManager.requireSession(sessionId)
  const events = eventStore.getEvents(sessionId)
  const latestSeq = eventStore.getLatestSeq(sessionId) ?? 0

  return buildSnapshotFromSessionState({
    session,
    events,
    latestSeq,
  })
}
