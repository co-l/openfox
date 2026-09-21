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
  Attachment,
} from '../../shared/types.js'
import type { SessionSnapshot, SnapshotMessage, ReadFileEntry } from './types.js'
import { getEventStore } from './store.js'
import { getRuntimeConfig } from '../runtime-config.js'
import {
  foldSessionState,
  foldContextState,
  buildContextMessagesFromEventHistory,
  buildMessagesFromStoredEvents,
  spreadOptionalMessageFields,
  type ContextMessage,
  type FoldedSessionState,
} from './folding.js'

export function combineEventsWithSnapshot(
  sessionId: string,
  snapshot: import('./types.js').SessionSnapshot | undefined,
  events: import('./types.js').StoredEvent[],
): import('./types.js').StoredEvent[] {
  if (!snapshot) return events
  const snapshotEvent: import('./types.js').StoredEvent = {
    seq: 0,
    timestamp: snapshot.snapshotAt,
    sessionId,
    type: 'turn.snapshot',
    data: snapshot,
  }
  return [snapshotEvent, ...events]
}

function toSnapshotMessage(message: import('../../shared/types.js').Message): SnapshotMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.timestamp).getTime(),
    ...spreadOptionalMessageFields(message as unknown as SnapshotMessage),
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
  maxTokens?: number,
  defaultMode?: SessionMode,
): FoldedSessionState | undefined {
  const eventStore = getEventStore()

  // Check for the latest snapshot first
  // Use snapshot-optimized loading
  const { snapshot: latestSnapshot, events: rawEvents } = eventStore.getEventsSinceSnapshot(sessionId)
  const events = combineEventsWithSnapshot(sessionId, latestSnapshot, rawEvents)
  if (events.length === 0) {
    return undefined
  }
  let initialWindowId: string | undefined
  for (const event of events) {
    if (event.type === 'session.initialized') {
      const data = event.data as { contextWindowId: string }
      initialWindowId = data.contextWindowId
      break
    }
  }

  if (!initialWindowId) {
    for (const event of events) {
      if (event.type === 'turn.snapshot') {
        const snapshotData = event.data as { sessionInit?: { contextWindowId: string } }
        if (snapshotData.sessionInit?.contextWindowId) {
          initialWindowId = snapshotData.sessionInit.contextWindowId
          break
        }
      }
    }
  }

  if (!initialWindowId) {
    for (const event of events) {
      if (event.type === 'turn.snapshot') {
        const snapshotData = event.data as { currentContextWindowId?: string }
        if (snapshotData.currentContextWindowId) {
          initialWindowId = snapshotData.currentContextWindowId
          break
        }
      }
    }
  }

  if (!initialWindowId) {
    return undefined
  }

  // Get maxTokens from parameter or fall back to config default
  const config = getRuntimeConfig()
  const effectiveMaxTokens = maxTokens ?? config.context.maxTokens

  // If we have a snapshot, use it as the base for messages and replay newer events
  if (latestSnapshot) {
    const state = foldSessionState(events, initialWindowId, effectiveMaxTokens, undefined, defaultMode)

    // Override folded messages with the latest snapshot plus replayed events.
    return {
      ...state,
      messages: buildMessagesFromStoredEvents(events).messages.map(toSnapshotMessage),
    }
  }

  return foldSessionState(events, initialWindowId, effectiveMaxTokens, undefined, defaultMode)
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
  const { snapshot: ctxSnapshot, events: ctxRawEvents } = eventStore.getEventsSinceSnapshot(sessionId)
  const events = combineEventsWithSnapshot(sessionId, ctxSnapshot, ctxRawEvents)
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

export function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
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
  title?: string,
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
    metadata?: { type: string; name: string; color: string; kind?: 'definition' | 'reminder' }
  },
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
  },
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
    tokenCount?: number
  },
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'message.done',
    data: {
      messageId,
      ...(options?.stats !== undefined && { stats: options.stats }),
      ...(options?.segments !== undefined && { segments: options.segments }),
      ...(options?.partial !== undefined && { partial: options.partial }),
      ...(options?.tokenCount !== undefined && { tokenCount: options.tokenCount }),
    },
  })
}

/**
 * Emit tool preparing (early in stream when tool name is known but args not complete)
 */
export function emitToolPreparing(sessionId: string, messageId: string, index: number, name: string): void {
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
  messageId: string,
  toolCallId: string,
  stream: 'stdout' | 'stderr',
  content: string,
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'tool.output',
    data: { messageId, toolCallId, stream, content },
  })
}

/**
 * Emit tool result
 */
export function emitToolResult(sessionId: string, messageId: string, toolCallId: string, result: ToolResult): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'tool.result',
    data: { messageId, toolCallId, result },
  })
}

/**
 * Emit mode changed
 */
export function emitModeChanged(sessionId: string, mode: SessionMode, auto: boolean, reason?: string): void {
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
 * Emit workflow execution changed (lightweight sync event)
 */
export function emitWorkflowExecutionChanged(
  sessionId: string,
  executionId: string,
  workflowId: string,
  workflowName: string,
  workflowColor: string | undefined,
  status: import('../../shared/types.js').WorkflowExecutionStatus,
  currentStepId?: string,
  currentStepName?: string,
  pendingChoices?: import('../../shared/types.js').UserStepChoice[],
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'workflow.execution_changed',
    data: {
      executionId,
      workflowId,
      workflowName,
      ...(workflowColor ? { workflowColor } : {}),
      status,
      ...(currentStepId ? { currentStepId } : {}),
      ...(currentStepName ? { currentStepName } : {}),
      ...(pendingChoices !== undefined ? { pendingChoices } : {}),
    },
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
export function emitCriterionUpdated(sessionId: string, criterionId: string, status: CriterionStatus): void {
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
 * Emit metadata set
 */
export function emitMetadataSet(
  sessionId: string,
  key: string,
  entries: import('../../shared/types.js').MetadataEntry[],
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'metadata.set',
    data: { key, entries },
  })
}

/**
 * Emit file read (for cache tracking)
 */
export function emitFileRead(sessionId: string, path: string, tokenCount: number, contextWindowId: string): void {
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
  summary: string,
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
  canCompact: boolean,
  subAgentId?: string,
  dynamicContextChanged?: boolean,
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
      dynamicContextChanged: dynamicContextChanged ?? false,
      ...(subAgentId !== undefined && { subAgentId }),
    },
  })
}

/**
 * Emit chat done
 */
export function emitChatDone(
  sessionId: string,
  messageId: string,
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' | 'truncated' | 'step_done',
  stats?: MessageStats,
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
 * Emit pattern retry
 */
export function emitPatternRetry(
  sessionId: string,
  messageId: string,
  pattern: string,
  field: string,
  attempt: number,
  maxAttempts: number,
  matchedContent: string,
): void {
  const eventStore = getEventStore()
  eventStore.append(sessionId, {
    type: 'pattern.retry',
    data: { messageId, pattern, field, attempt, maxAttempts, matchedContent },
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

/**
 * Truncate session messages at a given index.
 * Keeps messages[0..messageIndex], removes everything after.
 * messageIndex is 0-based — the message at that index is kept.
 * Emits a new snapshot with the truncated messages and cleans up stale events.
 */
export function truncateSessionMessages(sessionId: string, messageIndex: number): void {
  const eventStore = getEventStore()

  const snapshotEvent = eventStore.getLatestSnapshot(sessionId)
  if (!snapshotEvent) return

  const snapshot = snapshotEvent.data
  const messages = snapshot.messages

  const lastKept = messageIndex + 1
  if (lastKept < 0 || lastKept >= messages.length) return

  // Clone before mutating: the snapshot object is shared with the in-memory
  // snapshot cache, and the cache is only invalidated by the append below.
  const truncatedSnapshot = { ...snapshot, messages: messages.slice(0, lastKept) }

  eventStore.deleteEventsAfterSeq(sessionId, snapshotEvent.seq)

  eventStore.append(sessionId, {
    type: 'turn.snapshot',
    data: truncatedSnapshot,
  })

  const removed = messages.length - lastKept
  updateSessionMessageCount(sessionId, -removed)
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
export function getRecentUserPromptsForSession(
  sessionId: string,
  limit: number = 10,
): { id: string; content: string; timestamp: string }[] {
  try {
    const eventStore = getEventStore()
    return eventStore.getRecentUserPrompts(sessionId, limit)
  } catch {
    // If any error occurs (e.g., in tests), return empty array
    return []
  }
}
