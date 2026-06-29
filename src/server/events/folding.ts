/**
 * Event Folding Functions
 *
 * Pure functions that reconstruct state from events.
 * All state is derived from events - no external data sources.
 *
 * This module re-exports from domain-specific sub-modules:
 * - fold-types.ts: Shared types
 * - fold-messages.ts: Message-related folding
 * - fold-state.ts: Session state folding (criteria, todos, mode, phase, etc.)
 */

export type {
  ContextMessage,
  ContextMessageBuildOptions,
  EventLike,
  FoldedSessionState,
  MessageWithId,
} from './fold-types.js'

export {
  spreadOptionalMessageFields,
  buildMessagesFromStoredEvents,
  buildContextMessagesFromStoredEvents,
  handleMessageThinking,
  handleMessageDelta,
  handleToolCall,
  handleToolResult,
  stripOrphanedToolCalls,
  buildContextMessagesFromEventHistory,
  foldTurnEventsToSnapshotMessages,
  foldTurnEventsToSnapshotMessagesFromInitial,
  getMessagesForWindow,
  buildContextMessagesFromMessages,
} from './fold-messages.js'

export {
  foldCriteria,
  foldTodos,
  foldMetadata,
  foldContextState,
  foldMode,
  foldPhase,
  foldIsRunning,
  foldPendingConfirmations,
  foldSessionState,
  buildSnapshot,
  buildSnapshotFromSessionState,
} from './fold-state.js'
