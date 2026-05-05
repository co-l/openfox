/**
 * Event Sourcing Module
 *
 * This module provides the event store - the single source of truth
 * for all session state in OpenFox.
 *
 * Usage:
 * ```typescript
 * import { getEventStore, getSessionState, emitUserMessage } from './events/index.js'
 * import type { TurnEvent, StoredEvent, SessionSnapshot } from './events/index.js'
 *
 * // Initialize (once, at app startup)
 * initEventStore(db)
 *
 * // Emit events (preferred API)
 * const messageId = emitUserMessage(sessionId, 'Hello')
 * emitModeChanged(sessionId, 'builder', false)
 *
 * // Get current session state
 * const state = getSessionState(sessionId)
 *
 * // Subscribe to live events
 * const { iterator, unsubscribe } = getEventStore().subscribe(sessionId)
 * for await (const event of iterator) {
 *   // Handle event
 * }
 * ```
 */

// Store
export { EventStore, initEventStore, getEventStore } from './store.js'

// Types
export type {
  TurnEvent,
  StoredEvent,
  SessionSnapshot,
  SnapshotMessage,
  ToolCallWithResult,
  ReadFileEntry,
  EventType,
  EventData,
} from './types.js'

// Type helpers
export { createEvent, isTurnEvent, isStoredEvent } from './types.js'

// Folding
export type { FoldedSessionState, ContextMessage } from './folding.js'
export {
  buildMessagesFromStoredEvents,
  buildContextMessagesFromStoredEvents,
  buildContextMessagesFromEventHistory,
  foldTurnEventsToSnapshotMessages,
  foldSessionState,
  foldCriteria,
  foldTodos,
  foldMode,
  foldPhase,
  foldIsRunning,
  foldContextState,
  buildSnapshot,
  buildSnapshotFromSessionState,
  getMessagesForWindow,
  buildContextMessagesFromMessages,
} from './folding.js'

// Session State API
export {
  getSessionState,
  getCurrentWindowMessages,
  getContextMessages,
  getCurrentContextWindowId,
  getReadFilesCache,
  isFileInCache,
  emitSessionInitialized,
  emitUserMessage,
  emitAssistantMessageStart,
  emitMessageDelta,
  emitMessageThinking,
  emitMessageDone,
  emitToolPreparing,
  emitToolCall,
  emitToolOutput,
  emitToolResult,
  emitModeChanged,
  emitPhaseChanged,
  emitRunningChanged,
  emitCriteriaSet,
  emitCriterionUpdated,
  emitTodosUpdated,
  emitFileRead,
  emitContextCompacted,
  emitContextState,
  emitChatDone,
  emitChatError,
  emitFormatRetry,
  emitTurnSnapshot,
  truncateSessionMessages,
  compactContext,
  getRecentUserPromptsForSession,
} from './session.js'
