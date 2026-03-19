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

import type { ToolCall, ToolResult, Criterion, ContextState, Todo, MessageStats, ToolMode, InjectedFile, PromptContext, Attachment } from '../../shared/types.js'
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
import { getAllInstructions } from '../context/instructions.js'
import { logger } from '../utils/logger.js'
import { assembleBuilderRequest, assemblePlannerRequest, assembleVerifierRequest, type RequestContextMessage } from './request-context.js'

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
const VERIFIER_STALL_REASON = 'Verifier stopped repeatedly without using verification tools after repeated nudges.'

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorOptions {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  /** Optional callback for WebSocket forwarding (temporary, until WS layer is refactored) */
  onMessage?: (msg: ServerMessage) => void
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
    const snapshot = buildSnapshot(sessionManager, sessionId, turnMetrics.buildStats(llmClient.getModel(), mode))
    eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })

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
    const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
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
        const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

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
      const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
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
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
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

  const session = sessionManager.requireSession(sessionId)

  // Add builder kickoff prompt on first entry (if not already present)
  // This tells the LLM to start implementing the criteria
  if (formatRetryCount === 0) {
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
    criteria: session.criteria,
    modifiedFiles: session.executionState?.modifiedFiles ?? [],
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
    const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
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
        const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

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
      const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
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
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
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
 * Run a verifier turn with fresh context.
 * Unlike builder/planner, verifier uses only summary + criteria, not full conversation.
 */
export async function runVerifierTurn(
  options: OrchestratorOptions,
  turnMetrics: TurnMetrics
): Promise<VerifierResult> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const subAgentId = crypto.randomUUID()

  let session = sessionManager.requireSession(sessionId)

  // Check if there's anything to verify
  const toVerify = session.criteria.filter(c => c.status.type === 'completed')
  if (toVerify.length === 0) {
    logger.debug('Nothing to verify', { sessionId })
    return { allPassed: true, failed: [] }
  }

  // Build fresh context for verifier
  const summary = session.summary ?? 'No summary available'
  const modifiedFiles = session.executionState?.modifiedFiles ?? []

  const criteriaList = session.criteria
    .map(c => {
      const status = c.status.type === 'passed' ? '[PASSED]'
        : c.status.type === 'completed' ? '[NEEDS VERIFICATION]'
        : c.status.type === 'failed' ? '[FAILED]'
        : '[NOT COMPLETED]'
      return `- **${c.id}** ${status}: ${c.description}`
    })
    .join('\n')

  const contextContent = `## Task Summary
${summary}

## Criteria
${criteriaList}

## Modified Files
${modifiedFiles.length > 0 ? modifiedFiles.map(f => `- ${f}`).join('\n') : '(none)'}`

  logger.debug('Verifier starting', { sessionId, subAgentId, criteriaCount: session.criteria.length })
  const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

  // Emit context reset marker (visible in UI)
  const resetMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(resetMsgId, 'user', 'Fresh Context', {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'context-reset',
    subAgentId,
    subAgentType: 'verifier',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: resetMsgId } })

  // Emit context content
  const contextMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(contextMsgId, 'user', contextContent, {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType: 'verifier',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: contextMsgId } })

  // Emit verifier kickoff prompt
  const kickoffMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(kickoffMsgId, 'user', VERIFIER_KICKOFF_PROMPT, {
    ...(currentWindowMessageOptions ?? {}),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType: 'verifier',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: kickoffMsgId } })

  // Load instructions
  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = files.map(file => ({
    path: file.path,
    content: file.content ?? '',
    source: file.source,
  }))

  const toolRegistry = getToolRegistryForMode('verifier')

  // Build fresh context messages (not from EventStore - verifier has isolated context)
  let customMessages: RequestContextMessage[] = [
    { role: 'user', content: contextContent, source: 'runtime' },
    { role: 'user', content: VERIFIER_KICKOFF_PROMPT, source: 'runtime' },
  ]

  const maxIterations = 20
  let lastAssistantMsgId = ''
  let nudgesSinceLastProgress = 0
  let emittedTerminalDone = false

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    // Create assistant message with current context window ID
    const assistantMsgId = crypto.randomUUID()
    lastAssistantMsgId = assistantMsgId
    eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      ...(currentWindowMessageOptions ?? {}),
      subAgentId,
      subAgentType: 'verifier',
    }))

    const assembledRequest = assembleVerifierRequest({
      workdir: session.workdir,
      messages: customMessages,
      injectedFiles,
      promptTools: toolRegistry.definitions,
      toolChoice: 'auto',
      enableThinking: false,
      ...(instructionContent ? { customInstructions: instructionContent } : {}),
    })

    // Stream LLM response (no thinking for verifier)
    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt,
      llmClient,
      messages: assembledRequest.messages,
      tools: toolRegistry.definitions,
      toolChoice: 'auto',
      signal,
      enableThinking: false,
    })

    const result = await consumeStreamGenerator(streamGen, event => {
      eventStore.append(sessionId, event)
    })

    if (result.aborted) {
      const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Track metrics (verifier uses fresh context, so don't update main context size)
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)

    // Add assistant response to custom context
    customMessages.push({
      role: 'assistant',
      content: result.content,
      source: 'history',
      ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    })

    session = sessionManager.requireSession(sessionId)
    const criteriaAwaitingVerification = getCriteriaAwaitingVerification(session.criteria)

    // If no tool calls, verifier is done or needs a nudge
    if (result.toolCalls.length === 0) {
      if (criteriaAwaitingVerification.length > 0) {
        if (nudgesSinceLastProgress < MAX_CONSECUTIVE_VERIFIER_NUDGES) {
          nudgesSinceLastProgress += 1
          const nudgeContent = buildVerifierNudgeContent(criteriaAwaitingVerification)
          const nudgeMsgId = crypto.randomUUID()

          eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            promptContext: assembledRequest.promptContext,
          }))
          eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', nudgeContent, {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
            subAgentId,
            subAgentType: 'verifier',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
          customMessages = [...customMessages, { role: 'user', content: nudgeContent, source: 'runtime' }]
          continue
        }

        markCriteriaFailedAfterVerifierStall(sessionManager, sessionId, criteriaAwaitingVerification)
        session = sessionManager.requireSession(sessionId)

        const stalledMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(stalledMsgId, 'user', `${VERIFIER_STALL_REASON} Marking remaining criteria as failed: ${criteriaAwaitingVerification.map(c => c.id).join(', ')}.`, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
          subAgentId,
          subAgentType: 'verifier',
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: stalledMsgId } })
      }

      const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
        promptContext: assembledRequest.promptContext,
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      emittedTerminalDone = true
      break
    }

    // Emit message done (intermediate, no stats)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: result.segments,
      promptContext: assembledRequest.promptContext,
    }))

    // Execute tool calls
    for (const toolCall of result.toolCalls) {
      // Check abort before each tool execution
      if (signal?.aborted) {
        const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          stats,
          partial: true,
          promptContext: assembledRequest.promptContext,
        }))
        eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
        throw new Error('Aborted')
      }

      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

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

      // Add tool result to custom context
      customMessages.push({
        role: 'tool',
        content: toolResult.success ? (toolResult.output ?? 'Success') : `Error: ${toolResult.error}`,
        source: 'history',
        toolCallId: toolCall.id,
      })

      // Check criteria changes
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        eventStore.append(sessionId, { type: 'criteria.set', data: { criteria: updatedSession.criteria } })
        session = updatedSession
      }
    }

    session = sessionManager.requireSession(sessionId)
    const remainingCriteriaAfterTools = getCriteriaAwaitingVerification(session.criteria)

    if (remainingCriteriaAfterTools.length < criteriaAwaitingVerification.length) {
      nudgesSinceLastProgress = 0
      continue
    }

    if (remainingCriteriaAfterTools.length === 0) {
      nudgesSinceLastProgress = 0
      continue
    }

    // Tool calls were made - this IS progress, even if criteria didn't change.
    // The model needs to see tool results before calling pass_criterion/fail_criterion.
    // Reset the nudge counter since the model is actively working.
    nudgesSinceLastProgress = 0
  }

  session = sessionManager.requireSession(sessionId)
  const remainingCriteriaAfterLoop = getCriteriaAwaitingVerification(session.criteria)

  if (remainingCriteriaAfterLoop.length > 0) {
    markCriteriaFailedAfterVerifierStall(sessionManager, sessionId, remainingCriteriaAfterLoop)
    session = sessionManager.requireSession(sessionId)

    const stalledMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(stalledMsgId, 'user', `${VERIFIER_STALL_REASON} Marking remaining criteria as failed: ${remainingCriteriaAfterLoop.map((criterion) => criterion.id).join(', ')}.`, {
      ...(currentWindowMessageOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'correction',
      subAgentId,
      subAgentType: 'verifier',
    }))
    eventStore.append(sessionId, { type: 'message.done', data: { messageId: stalledMsgId } })

    if (!emittedTerminalDone && lastAssistantMsgId) {
      const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(lastAssistantMsgId, { stats }))
      eventStore.append(sessionId, createChatDoneEvent(lastAssistantMsgId, 'complete', stats))
      emittedTerminalDone = true
    }
  }

  if (!emittedTerminalDone && lastAssistantMsgId) {
    const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
    eventStore.append(sessionId, createMessageDoneEvent(lastAssistantMsgId, { stats }))
    eventStore.append(sessionId, createChatDoneEvent(lastAssistantMsgId, 'complete', stats))
  }

  // Check results
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
