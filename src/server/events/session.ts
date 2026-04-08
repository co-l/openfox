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

import { updateSessionMessageCount } from '../db/sessions.js'
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
  Attachment,
} from '../../shared/types.js'
import type { SessionSnapshot, SnapshotMessage, ReadFileEntry } from './types.js'
import { getEventStore } from './store.js'
import { getRuntimeConfig } from '../runtime-config.js'
import {
  foldSessionState,
  foldTurnEventsToSnapshotMessages,
  foldCriteria,
  foldTodos,
  foldMode,
  foldPhase,
  foldIsRunning,
  foldContextState,
  buildContextMessagesFromEventHistory,
  buildContextMessagesFromStoredEvents,
  buildMessagesFromStoredEvents,
  type ContextMessage,
  type FoldedSessionState,
} from './folding.js'

function toSnapshotMessage(message: import('../../shared/types.js').Message): SnapshotMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.timestamp).getTime(),
    ...(message.thinkingContent !== undefined && { thinkingContent: message.thinkingContent }),
    ...(message.toolCalls !== undefined && { toolCalls: message.toolCalls }),
    ...(message.segments !== undefined && { segments: message.segments }),
    ...(message.stats !== undefined && { stats: message.stats }),
    ...(message.tokenCount !== undefined && { tokenCount: message.tokenCount }),
    ...(message.isStreaming !== undefined && { isStreaming: message.isStreaming }),
    ...(message.partial !== undefined && { partial: message.partial }),
    ...(message.subAgentId !== undefined && { subAgentId: message.subAgentId }),
    ...(message.subAgentType !== undefined && { subAgentType: message.subAgentType }),
    ...(message.isSystemGenerated !== undefined && { isSystemGenerated: message.isSystemGenerated }),
    ...(message.messageKind !== undefined && { messageKind: message.messageKind }),
    ...(message.contextWindowId !== undefined && { contextWindowId: message.contextWindowId }),
    ...(message.isCompactionSummary !== undefined && { isCompactionSummary: message.isCompactionSummary }),
    ...(message.promptContext !== undefined && { promptContext: message.promptContext }),
    ...(message.attachments !== undefined && { attachments: message.attachments }),
    ...(message.metadata !== undefined && { metadata: message.metadata }),
  }
}

// ============================================================================
// Session State Retrieval
// ============================================================================

/**
 * Get full session state by folding all events.
 * Returns undefined if no session.initialized event exists.
 * 
 * If a snapshot exists, messages are loaded from the snapshot instead of
 * reconstructing from individual events (which may have been deleted).
 * 
 * maxTokens should come from providerManager.getCurrentModelContext()
 */
export function getSessionState(
  sessionId: string,
  maxTokens?: number
): FoldedSessionState | undefined {
  const eventStore = getEventStore()
  
  // Check for the latest snapshot first
  const latestSnapshotEvent = eventStore.getLatestSnapshot(sessionId)
  
  // Get all events (snapshots + current window events)
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

  // Get maxTokens from parameter or fall back to config default
  const config = getRuntimeConfig()
  const effectiveMaxTokens = maxTokens ?? config.context.maxTokens

  // If we have a snapshot, use it as the base for messages and replay newer events
  if (latestSnapshotEvent) {
    const state = foldSessionState(events, initialWindowId, effectiveMaxTokens)
    
    // Override folded messages with the latest snapshot plus replayed events.
    return {
      ...state,
      messages: buildMessagesFromStoredEvents(events).map(toSnapshotMessage),
    }
  }

  return foldSessionState(events, initialWindowId, effectiveMaxTokens)
}

/**
 * Get messages for the current context window (for LLM context building)
 * 
 * If a snapshot exists, messages are loaded from the snapshot.
 * Otherwise, they're built from events.
 */
export function getCurrentWindowMessages(sessionId: string): SnapshotMessage[] {
  // Get current context window ID from events (not from snapshot, as snapshot may be stale)
  const currentWindowId = getCurrentContextWindowId(sessionId)
  if (!currentWindowId) return []

  const state = getSessionState(sessionId)
  if (!state) return []
  
  return state.messages.filter((m) => m.contextWindowId === currentWindowId)
}

/**
 * Get context messages for LLM from current window
 * 
 * If a snapshot exists, messages are loaded from the snapshot.
 * Otherwise, they're built from events.
 */
export function getContextMessages(sessionId: string): ContextMessage[] {
  const eventStore = getEventStore()
  // Get current context window ID from events (not from snapshot, as snapshot may be stale)
  const currentWindowId = getCurrentContextWindowId(sessionId)
  if (!currentWindowId) return []

  const events = eventStore.getEvents(sessionId)
  if (events.length === 0) return []

  return buildContextMessagesFromEventHistory(events, currentWindowId, { includeVerifier: false })
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
 * Note: maxTokens is no longer stored here - it's a property of the model, not the session
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
    messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
    isCompactionSummary?: boolean
    tokenCount?: number
    attachments?: Attachment[] // Optional image attachments
    subAgentId?: string
    subAgentType?: string
    metadata?: { type: string; name: string; color: string }
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
      ...(options?.isCompactionSummary !== undefined && { isCompactionSummary: options.isCompactionSummary }),
      ...(options?.tokenCount !== undefined && { tokenCount: options.tokenCount }),
      ...(options?.attachments !== undefined && { attachments: options.attachments }),
      ...(options?.subAgentId !== undefined && { subAgentId: options.subAgentId }),
      ...(options?.subAgentType !== undefined && { subAgentType: options.subAgentType }),
      ...(options?.metadata !== undefined && { metadata: options.metadata }),
    },
  })

  eventStore.append(sessionId, {
    type: 'message.done',
    data: { messageId },
  })

  updateSessionMessageCount(sessionId, 1)

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
    subAgentType?: string
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

  updateSessionMessageCount(sessionId, 1)

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
 * Emit vision fallback started (image being delegated to vision model)
 */
export function emitVisionFallbackStart(
  sessionId: string,
  messageId: string,
  attachmentId: string,
  filename?: string
): void {
  const eventStore = getEventStore()
  const data: { messageId: string; attachmentId: string; filename?: string } = {
    messageId,
    attachmentId,
  }
  if (filename !== undefined) {
    data.filename = filename
  }
  eventStore.append(sessionId, {
    type: 'vision_fallback.start',
    data,
  })
}

/**
 * Emit vision fallback done (image description complete)
 */
export function emitVisionFallbackDone(
  sessionId: string,
  messageId: string,
  attachmentId: string,
  description: string
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'vision_fallback.done',
    data: { messageId, attachmentId, description },
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

// ============================================================================
// Recent User Prompts
// ============================================================================

/**
 * Get the most recent user prompts for a session.
 * Queries the events table directly for efficiency, returning only necessary fields.
 * 
 * @param sessionId - The session ID
 * @param limit - Maximum number of prompts to return (default: 10)
 * @returns Array of recent user prompts with id, content, and timestamp
 */
export function getRecentUserPromptsForSession(sessionId: string, limit: number = 10): { id: string, content: string, timestamp: string }[] {
  try {
    const eventStore = getEventStore()
    const db = (eventStore as any).db as import('better-sqlite3').Database | undefined

    // If no db available (e.g., in tests), return empty array
    if (!db) {
      return []
    }

    const isRealUserMessage = (msg: { role: string, isSystemGenerated?: boolean, messageKind?: string, subAgentType?: string }) =>
      msg.role === 'user' && !msg.isSystemGenerated && !msg.messageKind && !msg.subAgentType

    // Collect user prompts from both snapshots and message.start events.
    // After a snapshot is created, older message.start events may be deleted,
    // so we must extract messages from the latest snapshot as well.
    const promptMap = new Map<string, { id: string, content: string, timestamp: string }>()

    // 1. Extract user messages from the latest snapshot (if any)
    const snapshotRow = db
      .prepare(`
        SELECT payload, timestamp
        FROM events
        WHERE session_id = ? AND event_type = 'turn.snapshot'
        ORDER BY timestamp DESC
        LIMIT 1
      `)
      .get(sessionId) as { payload: string, timestamp: number } | undefined

    if (snapshotRow) {
      const snapshot = JSON.parse(snapshotRow.payload) as { messages: Array<{ id: string, role: string, content: string, timestamp: number, isSystemGenerated?: boolean, messageKind?: string, subAgentType?: string }> }
      for (const msg of snapshot.messages) {
        if (isRealUserMessage(msg)) {
          promptMap.set(msg.id, {
            id: msg.id,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
          })
        }
      }
    }

    // 2. Add/override with message.start events (these may be newer than the snapshot)
    const rows = db
      .prepare(`
        SELECT payload, timestamp
        FROM events
        WHERE session_id = ? AND event_type = 'message.start'
          AND json_extract(payload, '$.role') = 'user'
          AND json_extract(payload, '$.isSystemGenerated') IS NULL
          AND json_extract(payload, '$.messageKind') IS NULL
          AND json_extract(payload, '$.subAgentType') IS NULL
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(sessionId, limit) as { payload: string, timestamp: number }[]

    for (const row of rows) {
      const message = JSON.parse(row.payload) as { messageId: string, content: string }
      promptMap.set(message.messageId, {
        id: message.messageId,
        content: message.content,
        timestamp: new Date(row.timestamp).toISOString(),
      })
    }

    // Sort by timestamp descending (newest first) and take top N
    return [...promptMap.values()]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)
  } catch (error) {
    // If any error occurs (e.g., in tests), return empty array
    return []
  }
}
