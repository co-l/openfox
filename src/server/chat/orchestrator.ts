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

import type { ToolCall, ToolResult, Criterion, ContextState, Todo, MessageStats, ToolMode, InjectedFile, PromptContext } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { TurnEvent, SessionSnapshot, SnapshotMessage, ToolCallWithResult } from '../events/types.js'
import { getEventStore } from '../events/index.js'
import { sessionManager } from '../session/index.js'
import { getToolRegistryForMode, AskUserInterrupt, PathAccessDeniedError } from '../tools/index.js'
import { buildPlannerPrompt, buildBuilderPrompt, buildVerifierPrompt, BUILDER_KICKOFF_PROMPT, VERIFIER_KICKOFF_PROMPT } from './prompts.js'
import { streamLLMPure, consumeStreamGenerator, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent, createFormatRetryEvent } from './stream-pure.js'
import { createToolProgressHandler } from './tool-streaming.js'
import { estimateTokens } from '../context/tokenizer.js'
import { getAllInstructions } from '../context/instructions.js'
import { logger } from '../utils/logger.js'

// Re-export for runner orchestrator
export { TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createToolCallEvent, createToolResultEvent, createChatDoneEvent }

// ============================================================================
// Constants
// ============================================================================

const MAX_FORMAT_RETRIES = 10
const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorOptions {
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
  const { sessionId, llmClient, signal, onMessage } = options
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
    const snapshot = buildSnapshot(sessionId, turnMetrics.buildStats(llmClient.getModel(), mode))
    eventStore.append(sessionId, { type: 'turn.snapshot', data: snapshot })

  } catch (error) {
    if (error instanceof AskUserInterrupt) {
      // Emit waiting for user event
      const waitMsgId = crypto.randomUUID()
      eventStore.append(sessionId, createMessageStartEvent(waitMsgId, 'user', 'Waiting for user input...', {
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
  const { sessionId, llmClient, signal, onMessage } = options
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
  const systemPrompt = buildPlannerPrompt(session.workdir, toolRegistry.definitions, instructionContent || undefined)

  // Build messages from current context
  const contextMessages = buildContextMessages(sessionId)

  // Handle format retry
  if (formatRetryCount > 0) {
    const correctionMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(correctionMsgId, 'user', FORMAT_CORRECTION_PROMPT, {
      isSystemGenerated: true,
      messageKind: 'correction',
    }))
    eventStore.append(sessionId, createFormatRetryEvent(formatRetryCount, MAX_FORMAT_RETRIES))
    contextMessages.push({ role: 'user' as const, content: FORMAT_CORRECTION_PROMPT })
  }

  // Create assistant message
  const assistantMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant'))

  // Stream LLM response using pure generator
  const streamGen = streamLLMPure({
    messageId: assistantMsgId,
    systemPrompt,
    llmClient,
    messages: contextMessages,
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
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { stats, partial: true }))
    eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
    throw new Error('Aborted')
  }

  // Track metrics and update context size for frontend display
  turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
  sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens)

  // Execute tool calls (if any)
  if (result.toolCalls.length > 0) {
    // Emit message done WITHOUT stats (intermediate message)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments }))
    
    for (const toolCall of result.toolCalls) {
      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

      // Create progress handler for streaming output (run_command only)
      const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

      let toolResult: ToolResult
      try {
        toolResult = await toolRegistry.execute(toolCall.name, toolCall.arguments, {
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

    // Continue with another response
    return runPlannerTurn(options, turnMetrics)
  }

  // Final response - emit message.done WITH stats and chat.done
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
  eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments, stats }))
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
  const { sessionId, llmClient, signal, onMessage } = options
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
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
      }))
      eventStore.append(sessionId, { type: 'message.done', data: { messageId: kickoffMsgId } })
    }
  }

  // Load instructions
  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)

  const toolRegistry = getToolRegistryForMode('builder')
  const systemPrompt = buildBuilderPrompt(
    session.workdir,
    session.criteria,
    toolRegistry.definitions,
    session.executionState?.modifiedFiles ?? [],
    instructionContent || undefined
  )

  // Build messages from current context
  const contextMessages = buildContextMessages(sessionId)

  // Handle format retry
  if (formatRetryCount > 0) {
    const correctionMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(correctionMsgId, 'user', FORMAT_CORRECTION_PROMPT, {
      isSystemGenerated: true,
      messageKind: 'correction',
    }))
    eventStore.append(sessionId, createFormatRetryEvent(formatRetryCount, MAX_FORMAT_RETRIES))
    contextMessages.push({ role: 'user' as const, content: FORMAT_CORRECTION_PROMPT })
  }

  // Create assistant message
  const assistantMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant'))

  // Stream LLM response using pure generator
  const streamGen = streamLLMPure({
    messageId: assistantMsgId,
    systemPrompt,
    llmClient,
    messages: contextMessages,
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
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { stats, partial: true }))
    eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
    throw new Error('Aborted')
  }

  // Track metrics and update context size for frontend display
  turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
  sessionManager.setCurrentContextSize(sessionId, result.usage.promptTokens)

  // Execute tool calls (if any)
  if (result.toolCalls.length > 0) {
    // Emit message done WITHOUT stats (intermediate message)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments }))
    
    for (const toolCall of result.toolCalls) {
      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

      // Create progress handler for streaming output (run_command only)
      const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

      let toolResult: ToolResult
      try {
        toolResult = await toolRegistry.execute(toolCall.name, toolCall.arguments, {
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

    // Continue with another response
    return runBuilderTurn(options, turnMetrics)
  }

  // Final response - emit message.done WITH stats and chat.done
  const stats = turnMetrics.buildStats(llmClient.getModel(), 'builder')
  eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments, stats }))
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
  const { sessionId, llmClient, signal, onMessage } = options
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

  // Emit context reset marker (visible in UI)
  const resetMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(resetMsgId, 'user', 'Fresh Context', {
    isSystemGenerated: true,
    messageKind: 'context-reset',
    subAgentId,
    subAgentType: 'verifier',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: resetMsgId } })

  // Emit context content
  const contextMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(contextMsgId, 'user', contextContent, {
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType: 'verifier',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: contextMsgId } })

  // Emit verifier kickoff prompt
  const kickoffMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(kickoffMsgId, 'user', VERIFIER_KICKOFF_PROMPT, {
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    subAgentId,
    subAgentType: 'verifier',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: kickoffMsgId } })

  // Load instructions
  const { content: instructionContent } = await getAllInstructions(session.workdir, session.projectId)

  const toolRegistry = getToolRegistryForMode('verifier')
  const systemPrompt = buildVerifierPrompt(session.workdir, toolRegistry.definitions, instructionContent || undefined)

  // Build fresh context messages (not from EventStore - verifier has isolated context)
  let customMessages: Array<{
    role: 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: ToolCall[]
    toolCallId?: string
  }> = [
    { role: 'user', content: contextContent },
    { role: 'user', content: VERIFIER_KICKOFF_PROMPT },
  ]

  const maxIterations = 20
  let lastAssistantMsgId = ''

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    // Create assistant message
    const assistantMsgId = crypto.randomUUID()
    lastAssistantMsgId = assistantMsgId
    eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      subAgentId,
      subAgentType: 'verifier',
    }))

    // Stream LLM response (no thinking for verifier)
    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt,
      llmClient,
      messages: customMessages,
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
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { stats, partial: true }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    // Track metrics (verifier uses fresh context, so don't update main context size)
    turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)

    // Add assistant response to custom context
    customMessages.push({
      role: 'assistant',
      content: result.content,
      ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    })

    // If no tool calls, verifier is done
    if (result.toolCalls.length === 0) {
      const stats = turnMetrics.buildStats(llmClient.getModel(), 'verifier')
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments, stats }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      break
    }

    // Emit message done (intermediate, no stats)
    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments }))

    // Execute tool calls
    for (const toolCall of result.toolCalls) {
      eventStore.append(sessionId, createToolCallEvent(assistantMsgId, toolCall))

      // Create progress handler for streaming output (run_command only)
      const onProgress = onMessage ? createToolProgressHandler(assistantMsgId, toolCall.id, onMessage) : undefined

      let toolResult: ToolResult
      try {
        toolResult = await toolRegistry.execute(toolCall.name, toolCall.arguments, {
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
        toolCallId: toolCall.id,
      })

      // Check criteria changes
      const updatedSession = sessionManager.requireSession(sessionId)
      if (JSON.stringify(updatedSession.criteria) !== JSON.stringify(session.criteria)) {
        eventStore.append(sessionId, { type: 'criteria.set', data: { criteria: updatedSession.criteria } })
        session = updatedSession
      }
    }
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

/**
 * Build context messages for LLM from EventStore.
 * Folds events into messages suitable for LLM context.
 */
function buildContextMessages(sessionId: string): Array<{
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}> {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)
  
  // If no events in EventStore, fall back to old system
  if (events.length === 0) {
    const messages = sessionManager.getCurrentWindowMessages(sessionId)
    return messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.toolCalls && { toolCalls: m.toolCalls }),
      ...(m.toolCallId && { toolCallId: m.toolCallId }),
    }))
  }
  
  // Build messages from events
  const messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'tool'
    content: string
    toolCalls?: ToolCall[]
    toolCallId?: string
  }> = []
  
  const messageMap = new Map<string, typeof messages[0]>()
  
  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as { messageId: string; role: 'user' | 'assistant' | 'system'; content?: string }
        if (data.role !== 'system') { // Skip system messages for LLM context
          const msg = {
            id: data.messageId,
            role: data.role as 'user' | 'assistant',
            content: data.content ?? '',
          }
          messageMap.set(data.messageId, msg)
          messages.push(msg)
        }
        break
      }
      
      case 'message.delta': {
        const data = event.data as { messageId: string; content: string }
        const msg = messageMap.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      
      case 'tool.call': {
        const data = event.data as { messageId: string; toolCall: ToolCall }
        const msg = messageMap.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall)
        }
        break
      }
      
      case 'tool.result': {
        const data = event.data as { messageId: string; toolCallId: string; result: ToolResult }
        // Create a tool result message
        const toolMsg = {
          id: `tool-${data.toolCallId}`,
          role: 'tool' as const,
          content: data.result.success ? (data.result.output ?? 'Success') : `Error: ${data.result.error}`,
          toolCallId: data.toolCallId,
        }
        messages.push(toolMsg)
        break
      }
    }
  }
  
  return messages.map(m => ({
    role: m.role,
    content: m.content,
    ...(m.toolCalls && { toolCalls: m.toolCalls }),
    ...(m.toolCallId && { toolCallId: m.toolCallId }),
  }))
}

/**
 * Build a snapshot of current session state.
 */
function buildSnapshot(sessionId: string, lastStats?: MessageStats): SessionSnapshot {
  const eventStore = getEventStore()
  const session = sessionManager.requireSession(sessionId)

  // Get all events and fold them into messages
  const events = eventStore.getEvents(sessionId)
  const messages = foldEventsToMessages(events)

  // Get latest seq
  const latestSeq = eventStore.getLatestSeq(sessionId) ?? 0

  return {
    mode: session.mode,
    phase: session.phase,
    isRunning: session.isRunning,
    messages,
    criteria: session.criteria,
    contextState: {
      currentTokens: session.executionState?.currentTokenCount ?? 0,
      maxTokens: 200000, // TODO: Get from config
      compactionCount: session.executionState?.compactionCount ?? 0,
      dangerZone: false,
      canCompact: false,
    },
    todos: [], // TODO: Get from session state
    snapshotSeq: latestSeq,
    snapshotAt: Date.now(),
  }
}

// Type helpers for event data extraction
type MessageStartData = Extract<TurnEvent, { type: 'message.start' }>['data']
type MessageDeltaData = Extract<TurnEvent, { type: 'message.delta' }>['data']
type MessageThinkingData = Extract<TurnEvent, { type: 'message.thinking' }>['data']
type MessageDoneData = Extract<TurnEvent, { type: 'message.done' }>['data']
type ToolCallData = Extract<TurnEvent, { type: 'tool.call' }>['data']
type ToolResultData = Extract<TurnEvent, { type: 'tool.result' }>['data']

/**
 * Fold events into messages.
 * This reconstructs the message list from events.
 */
function foldEventsToMessages(events: Array<{ type: string; data: unknown }>): SnapshotMessage[] {
  const messages: Map<string, SnapshotMessage> = new Map()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as MessageStartData
        messages.set(data.messageId, {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp: Date.now(),
          isStreaming: true,
          ...(data.contextWindowId ? { contextWindowId: data.contextWindowId } : {}),
          ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
          ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
          ...(data.isSystemGenerated ? { isSystemGenerated: data.isSystemGenerated } : {}),
          ...(data.messageKind ? { messageKind: data.messageKind } : {}),
        })
        break
      }

      case 'message.delta': {
        const data = event.data as MessageDeltaData
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }

      case 'message.thinking': {
        const data = event.data as MessageThinkingData
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
        }
        break
      }

      case 'message.done': {
        const data = event.data as MessageDoneData
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.isStreaming = false
          if (data.stats) msg.stats = data.stats
          if (data.partial) msg.partial = data.partial
        }
        break
      }

      case 'tool.call': {
        const data = event.data as ToolCallData
        const msg = messages.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall as ToolCallWithResult)
        }
        break
      }

      case 'tool.result': {
        const data = event.data as ToolResultData
        // Attach result to tool call
        const msg = messages.get(data.messageId)
        if (msg?.toolCalls) {
          const tc = msg.toolCalls.find(t => t.id === data.toolCallId)
          if (tc) {
            tc.result = data.result
          }
        }
        break
      }
    }
  }

  return Array.from(messages.values())
}
