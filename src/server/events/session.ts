/**
 * Session State API (Event-Sourced)
 *
 * This module provides the primary API for interacting with session state.
 * All state changes go through EventStore - this is the single source of truth.
 *
 * Usage:
 * ```typescript
 * import { emitUserMessage, emitModeChanged, getSessionState } from './events/session.js'
 *
 * // Emit events
 * const messageId = emitUserMessage(sessionId, 'Hello')
 * emitModeChanged(sessionId, 'builder', false, 'User switched to builder')
 *
 * // Get current state
 * const state = getSessionState(sessionId)
 * ```
 */

import type {
  SessionMode,
  SessionPhase,
  Criterion,
  CriterionStatus,
  ToolCall,
  ToolResult,
  MessageStats,
  Todo,
  MessageSegment,
  PromptContext,
} from '../../shared/types.js'
import type { SessionSnapshot, SnapshotMessage, ReadFileEntry } from './types.js'
import { getEventStore } from './store.js'
import {
  foldSessionState,
  foldTurnEventsToSnapshotMessages,
  foldCriteria,
  foldTodos,
  foldMode,
  foldPhase,
  foldIsRunning,
  foldContextState,
  buildContextMessagesFromMessages,
  type ContextMessage,
  type FoldedSessionState,
} from './folding.js'

// ============================================================================
// Session State Retrieval
// ============================================================================

/**
 * Get full session state by folding all events.
 * Returns undefined if no session.initialized event exists.
 */
export function getSessionState(sessionId: string): FoldedSessionState | undefined {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)

  if (events.length === 0) {
    return undefined
  }

  // Find initial context window ID from session.initialized event
  let initialWindowId: string | undefined
  for (const event of events) {
    if (event.type === 'session.initialized') {
      const data = event.data as { contextWindowId: string }
      initialWindowId = data.contextWindowId
      break
    }
  }

  if (!initialWindowId) {
    return undefined
  }

  return foldSessionState(events, initialWindowId)
}

/**
 * Get messages for the current context window (for LLM context building)
 */
export function getCurrentWindowMessages(sessionId: string): SnapshotMessage[] {
  const state = getSessionState(sessionId)
  if (!state) return []

  return state.messages.filter((m) => m.contextWindowId === state.currentContextWindowId)
}

/**
 * Get context messages for LLM from current window
 */
export function getContextMessages(sessionId: string): ContextMessage[] {
  const state = getSessionState(sessionId)
  if (!state) return []

  return buildContextMessagesFromMessages(state.messages, state.currentContextWindowId)
}

/**
 * Get current context window ID
 */
export function getCurrentContextWindowId(sessionId: string): string | undefined {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)

  const contextResult = foldContextState(events, '')
  return contextResult.currentContextWindowId || undefined
}

/**
 * Get read files cache for current window
 */
export function getReadFilesCache(sessionId: string): ReadFileEntry[] {
  const state = getSessionState(sessionId)
  return state?.readFiles ?? []
}

/**
 * Check if a file is in the read cache for current window
 */
export function isFileInCache(sessionId: string, path: string): boolean {
  const cache = getReadFilesCache(sessionId)
  return cache.some((f) => f.path === path)
}

// ============================================================================
// Event Emission Helpers
// ============================================================================

/**
 * Emit session.initialized event (called once when session is created)
 */
export function emitSessionInitialized(
  sessionId: string,
  projectId: string,
  workdir: string,
  contextWindowId: string,
  title?: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'session.initialized',
    data: {
      projectId,
      workdir,
      contextWindowId,
      ...(title !== undefined && { title }),
    },
  })
}

/**
 * Emit a user message. Returns the message ID.
 */
export function emitUserMessage(
  sessionId: string,
  content: string,
  options?: {
    contextWindowId?: string
    isSystemGenerated?: boolean
    messageKind?: 'correction' | 'auto-prompt' | 'context-reset'
    tokenCount?: number
  }
): string {
  const eventStore = getEventStore()
  const messageId = crypto.randomUUID()

  eventStore.append(sessionId, {
    type: 'message.start',
    data: {
      messageId,
      role: 'user',
      content,
      ...(options?.contextWindowId !== undefined && { contextWindowId: options.contextWindowId }),
      ...(options?.isSystemGenerated !== undefined && { isSystemGenerated: options.isSystemGenerated }),
      ...(options?.messageKind !== undefined && { messageKind: options.messageKind }),
      ...(options?.tokenCount !== undefined && { tokenCount: options.tokenCount }),
    },
  })

  eventStore.append(sessionId, {
    type: 'message.done',
    data: { messageId },
  })

  return messageId
}

/**
 * Emit assistant message start. Returns the message ID.
 */
export function emitAssistantMessageStart(
  sessionId: string,
  options?: {
    contextWindowId?: string
    subAgentId?: string
    subAgentType?: 'verifier'
  }
): string {
  const eventStore = getEventStore()
  const messageId = crypto.randomUUID()

  eventStore.append(sessionId, {
    type: 'message.start',
    data: {
      messageId,
      role: 'assistant',
      ...(options?.contextWindowId !== undefined && { contextWindowId: options.contextWindowId }),
      ...(options?.subAgentId !== undefined && { subAgentId: options.subAgentId }),
      ...(options?.subAgentType !== undefined && { subAgentType: options.subAgentType }),
    },
  })

  return messageId
}

/**
 * Emit message content delta (streaming)
 */
export function emitMessageDelta(sessionId: string, messageId: string, content: string): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'message.delta',
    data: { messageId, content },
  })
}

/**
 * Emit message thinking content (streaming)
 */
export function emitMessageThinking(sessionId: string, messageId: string, content: string): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'message.thinking',
    data: { messageId, content },
  })
}

/**
 * Emit message done
 */
export function emitMessageDone(
  sessionId: string,
  messageId: string,
  options?: {
    stats?: MessageStats
    segments?: MessageSegment[]
    partial?: boolean
    promptContext?: PromptContext
    tokenCount?: number
  }
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'message.done',
    data: {
      messageId,
      ...(options?.stats !== undefined && { stats: options.stats }),
      ...(options?.segments !== undefined && { segments: options.segments }),
      ...(options?.partial !== undefined && { partial: options.partial }),
      ...(options?.promptContext !== undefined && { promptContext: options.promptContext }),
      ...(options?.tokenCount !== undefined && { tokenCount: options.tokenCount }),
    },
  })
}

/**
 * Emit tool preparing (early in stream when tool name is known but args not complete)
 */
export function emitToolPreparing(
  sessionId: string,
  messageId: string,
  index: number,
  name: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'tool.preparing',
    data: { messageId, index, name },
  })
}

/**
 * Emit tool call (when tool call is complete and ready to execute)
 */
export function emitToolCall(sessionId: string, messageId: string, toolCall: ToolCall): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'tool.call',
    data: { messageId, toolCall },
  })
}

/**
 * Emit tool output (streaming stdout/stderr from run_command)
 */
export function emitToolOutput(
  sessionId: string,
  toolCallId: string,
  stream: 'stdout' | 'stderr',
  content: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'tool.output',
    data: { toolCallId, stream, content },
  })
}

/**
 * Emit tool result
 */
export function emitToolResult(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  result: ToolResult
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'tool.result',
    data: { messageId, toolCallId, result },
  })
}

/**
 * Emit mode changed
 */
export function emitModeChanged(
  sessionId: string,
  mode: SessionMode,
  auto: boolean,
  reason?: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'mode.changed',
    data: {
      mode,
      auto,
      ...(reason !== undefined && { reason }),
    },
  })
}

/**
 * Emit phase changed
 */
export function emitPhaseChanged(sessionId: string, phase: SessionPhase): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'phase.changed',
    data: { phase },
  })
}

/**
 * Emit running state changed
 */
export function emitRunningChanged(sessionId: string, isRunning: boolean): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'running.changed',
    data: { isRunning },
  })
}

/**
 * Emit criteria set (replace all criteria)
 */
export function emitCriteriaSet(sessionId: string, criteria: Criterion[]): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'criteria.set',
    data: { criteria },
  })
}

/**
 * Emit criterion updated
 */
export function emitCriterionUpdated(
  sessionId: string,
  criterionId: string,
  status: CriterionStatus
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'criterion.updated',
    data: { criterionId, status },
  })
}

/**
 * Emit todos updated
 */
export function emitTodosUpdated(sessionId: string, todos: Todo[]): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'todo.updated',
    data: { todos },
  })
}

/**
 * Emit file read (for cache tracking)
 */
export function emitFileRead(
  sessionId: string,
  path: string,
  tokenCount: number,
  contextWindowId: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'file.read',
    data: { path, tokenCount, contextWindowId },
  })
}

/**
 * Emit context compacted (closes current window, creates new one)
 */
export function emitContextCompacted(
  sessionId: string,
  closedWindowId: string,
  newWindowId: string,
  beforeTokens: number,
  afterTokens: number,
  summary: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'context.compacted',
    data: {
      closedWindowId,
      newWindowId,
      beforeTokens,
      afterTokens,
      summary,
    },
  })
}

/**
 * Emit context state update
 */
export function emitContextState(
  sessionId: string,
  currentTokens: number,
  maxTokens: number,
  compactionCount: number,
  dangerZone: boolean,
  canCompact: boolean
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'context.state',
    data: {
      currentTokens,
      maxTokens,
      compactionCount,
      dangerZone,
      canCompact,
    },
  })
}

/**
 * Emit chat done
 */
export function emitChatDone(
  sessionId: string,
  messageId: string,
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user',
  stats?: MessageStats
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'chat.done',
    data: {
      messageId,
      reason,
      ...(stats !== undefined && { stats }),
    },
  })
}

/**
 * Emit chat error
 */
export function emitChatError(sessionId: string, error: string, recoverable: boolean): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'chat.error',
    data: { error, recoverable },
  })
}

/**
 * Emit format retry
 */
export function emitFormatRetry(sessionId: string, attempt: number, maxAttempts: number): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'format.retry',
    data: { attempt, maxAttempts },
  })
}

/**
 * Emit turn snapshot
 */
export function emitTurnSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'turn.snapshot',
    data: snapshot,
  })
}

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Create a compaction summary message and emit context compaction
 */
export function compactContext(
  sessionId: string,
  summary: string,
  beforeTokens: number
): { newWindowId: string; summaryMessageId: string } {
  const state = getSessionState(sessionId)
  if (!state) {
    throw new Error('Session not found')
  }

  const closedWindowId = state.currentContextWindowId
  const newWindowId = crypto.randomUUID()
  const summaryMessageId = crypto.randomUUID()

  // Emit summary message
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'message.start',
    data: {
      messageId: summaryMessageId,
      role: 'assistant',
      content: summary,
      contextWindowId: closedWindowId,
      isCompactionSummary: true,
    },
  })
  eventStore.append(sessionId, {
    type: 'message.done',
    data: { messageId: summaryMessageId },
  })

  // Emit compaction event
  emitContextCompacted(sessionId, closedWindowId, newWindowId, beforeTokens, 0, summary)

  return { newWindowId, summaryMessageId }
}
