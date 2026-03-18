/**
 * Event Sourcing Types
 *
 * TurnEvents are the single source of truth for session state.
 * All session state (messages, criteria, phase, etc.) is derived from events.
 *
 * Design principles:
 * - Events are immutable and append-only
 * - Each event is self-contained (no joins needed)
 * - Same event shape for live streaming AND history replay
 * - Frontend folds events into state identically regardless of source
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
  ContextState,
} from '../../shared/types.js'

// ============================================================================
// Stored Event (what goes in the database)
// ============================================================================

export interface StoredEvent<T extends TurnEvent = TurnEvent> {
  seq: number // Per-session sequence number (1, 2, 3...)
  timestamp: number // Unix timestamp ms
  sessionId: string
  type: T['type']
  data: T['data']
}

// ============================================================================
// Turn Events (discriminated union)
// ============================================================================

export type TurnEvent =
  // ----------------------------------------------------------------------------
  // Message lifecycle
  // ----------------------------------------------------------------------------
  | {
      type: 'message.start'
      data: {
        messageId: string
        role: 'user' | 'assistant' | 'system'
        content?: string // For user/system messages, content is known upfront
        contextWindowId?: string
        subAgentId?: string
        subAgentType?: 'verifier'
        isSystemGenerated?: boolean
        messageKind?: 'correction' | 'auto-prompt' | 'context-reset'
      }
    }
  | {
      type: 'message.delta'
      data: {
        messageId: string
        content: string // Incremental content chunk
      }
    }
  | {
      type: 'message.thinking'
      data: {
        messageId: string
        content: string // Incremental thinking chunk
      }
    }
  | {
      type: 'message.done'
      data: {
        messageId: string
        stats?: MessageStats
        segments?: MessageSegment[]
        partial?: boolean // True if interrupted
      }
    }

  // ----------------------------------------------------------------------------
  // Tool lifecycle
  // ----------------------------------------------------------------------------
  | {
      type: 'tool.preparing'
      data: {
        messageId: string
        index: number // Tool call index (for parallel calls)
        name: string // Tool name (available early in stream)
      }
    }
  | {
      type: 'tool.call'
      data: {
        messageId: string
        toolCall: ToolCall // Full tool call with id, name, arguments
      }
    }
  | {
      type: 'tool.output'
      data: {
        toolCallId: string
        stream: 'stdout' | 'stderr'
        content: string
      }
    }
  | {
      type: 'tool.result'
      data: {
        messageId: string
        toolCallId: string
        result: ToolResult
      }
    }

  // ----------------------------------------------------------------------------
  // Session state changes
  // ----------------------------------------------------------------------------
  | {
      type: 'phase.changed'
      data: {
        phase: SessionPhase
      }
    }
  | {
      type: 'mode.changed'
      data: {
        mode: SessionMode
        auto: boolean // Was this an automatic switch?
        reason?: string
      }
    }
  | {
      type: 'running.changed'
      data: {
        isRunning: boolean
      }
    }

  // ----------------------------------------------------------------------------
  // Criteria
  // ----------------------------------------------------------------------------
  | {
      type: 'criteria.set'
      data: {
        criteria: Criterion[]
      }
    }
  | {
      type: 'criterion.updated'
      data: {
        criterionId: string
        status: CriterionStatus
      }
    }

  // ----------------------------------------------------------------------------
  // Context management
  // ----------------------------------------------------------------------------
  | {
      type: 'context.state'
      data: ContextState
    }
  | {
      type: 'context.compacted'
      data: {
        beforeTokens: number
        afterTokens: number
        newWindowId: string
        summary: string
      }
    }

  // ----------------------------------------------------------------------------
  // Builder-specific
  // ----------------------------------------------------------------------------
  | {
      type: 'todo.updated'
      data: {
        todos: Todo[]
      }
    }

  // ----------------------------------------------------------------------------
  // Errors and control flow
  // ----------------------------------------------------------------------------
  | {
      type: 'chat.done'
      data: {
        messageId: string
        reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
        stats?: MessageStats
      }
    }
  | {
      type: 'chat.error'
      data: {
        error: string
        recoverable: boolean
      }
    }
  | {
      type: 'format.retry'
      data: {
        attempt: number
        maxAttempts: number
      }
    }

  // ----------------------------------------------------------------------------
  // Snapshots (agent end-of-turn)
  // ----------------------------------------------------------------------------
  | {
      type: 'turn.snapshot'
      data: SessionSnapshot
    }

// ============================================================================
// Session Snapshot (full state at a point in time)
// ============================================================================

export interface SessionSnapshot {
  // Core session info
  mode: SessionMode
  phase: SessionPhase
  isRunning: boolean

  // Messages (fully reconstructed, with tool results attached)
  messages: SnapshotMessage[]

  // Criteria
  criteria: Criterion[]

  // Context state
  contextState: ContextState

  // Builder todos
  todos: Todo[]

  // Metadata
  snapshotSeq: number // The event seq this snapshot was taken at
  snapshotAt: number // Unix timestamp
}

/**
 * Message in a snapshot - fully resolved with tool results
 * This is what the frontend stores in state
 */
export interface SnapshotMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinkingContent?: string
  toolCalls?: ToolCallWithResult[]
  segments?: MessageSegment[]
  stats?: MessageStats
  timestamp: number
  isStreaming?: boolean
  partial?: boolean
  subAgentId?: string
  subAgentType?: 'verifier'
  isSystemGenerated?: boolean
  messageKind?: 'correction' | 'auto-prompt' | 'context-reset'
  contextWindowId?: string
}

export interface ToolCallWithResult extends ToolCall {
  result?: ToolResult
}

// ============================================================================
// Type Guards
// ============================================================================

export function isTurnEvent(event: unknown): event is TurnEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    'data' in event &&
    typeof (event as TurnEvent).type === 'string'
  )
}

export function isStoredEvent(event: unknown): event is StoredEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'seq' in event &&
    'timestamp' in event &&
    'sessionId' in event &&
    'type' in event &&
    'data' in event
  )
}

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Extract the event type from a TurnEvent for filtering
 */
export type EventType = TurnEvent['type']

/**
 * Get the data type for a specific event type
 */
export type EventData<T extends EventType> = Extract<TurnEvent, { type: T }>['data']

/**
 * Create a typed event (useful for event emission)
 */
export function createEvent<T extends EventType>(
  type: T,
  data: EventData<T>
): Extract<TurnEvent, { type: T }> {
  return { type, data } as Extract<TurnEvent, { type: T }>
}
