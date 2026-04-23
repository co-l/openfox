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
  PromptContext,
  Attachment,
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
  // Session lifecycle
  // ----------------------------------------------------------------------------
  | {
      type: 'session.initialized'
      data: {
        projectId: string
        workdir: string
        title?: string
        contextWindowId: string // First window created with session
        maxTokens?: number // Initial max context from provider
      }
    }

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
        subAgentType?: string
        isSystemGenerated?: boolean
        messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
        isCompactionSummary?: boolean // True if this is the summary message after compaction
        tokenCount?: number // Known upfront for user messages
        attachments?: Attachment[] // Optional image attachments
        metadata?: { type: string; name: string; color: string } // For auto-prompt messages
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
        promptContext?: PromptContext // What was sent to LLM (assistant messages only)
        tokenCount?: number // Final token count for assistant messages
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
  | {
      type: 'session.name_generated'
      data: {
        name: string
      }
    }

  // ----------------------------------------------------------------------------
  // Queue events (EventSourcing pattern)
  // ----------------------------------------------------------------------------
  | {
      type: 'queue.added'
      data: {
        queueId: string
        mode: 'asap' | 'completion'
        content: string
        attachments?: Attachment[]
        messageKind?: string
        queuedAt: string
      }
    }
  | {
      type: 'queue.drained'
      data: {
        queueId: string
      }
    }
  | {
      type: 'queue.cancelled'
      data: {
        queueId: string
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
      data: ContextState & { subAgentId?: string }
    }
  | {
      type: 'context.compacted'
      data: {
        closedWindowId: string // Window being closed
        newWindowId: string // New window being created
        beforeTokens: number
        afterTokens: number // Should be ~0 for new window
        summary: string
      }
    }
  | {
      type: 'file.read'
      data: {
        path: string
        tokenCount: number
        contextWindowId: string // Scoped to window for cache invalidation
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
  // Task completion
  // ----------------------------------------------------------------------------
  | {
      type: 'task.completed'
      data: {
        summary: string | null
        iterations: number
        totalTimeSeconds: number
        totalToolCalls: number
        totalTokensGenerated: number
        avgGenerationSpeed: number
        responseCount: number
        llmCallCount: number
        criteria: Array<{
          id: string
          description: string
          status: string
        }>
        workflowName?: string
        workflowId?: string
        workflowColor?: string
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
      type: 'chat.ask_user'
      data: {
        callId: string
        question: string
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
  // Vision fallback (image description by fallback model)
  // ----------------------------------------------------------------------------
  | {
      type: 'vision_fallback.start'
      data: {
        messageId: string
        attachmentId: string
        filename?: string
      }
    }
  | {
      type: 'vision_fallback.done'
      data: {
        messageId: string
        attachmentId: string
        description: string
      }
    }

  // ----------------------------------------------------------------------------
  // Path confirmation (permission requests that persist across reloads)
  // ----------------------------------------------------------------------------
  | {
      type: 'path.confirmation_pending'
      data: {
        callId: string
        tool: string
        paths: string[]
        workdir: string
        reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command'
      }
    }
  | {
      type: 'path.confirmation_responded'
      data: {
        callId: string
        approved: boolean
        alwaysAllow: boolean
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
  mode: SessionMode
  phase: SessionPhase
  isRunning: boolean

  messages: SnapshotMessage[]
  criteria: Criterion[]
  contextState: ContextState
  currentContextWindowId: string
  todos: Todo[]
  readFiles?: ReadFileEntry[]
  lastModeWithReminder?: SessionMode
  snapshotSeq: number
  snapshotAt: number

  sessionInit?: {
    projectId: string
    workdir: string
    contextWindowId: string
    maxTokens?: number
  }
  sessionTitle?: string
  preparingToolCalls?: PreparingToolCall[]
  visionFallbacks?: VisionFallback[]
  formatRetries?: FormatRetry[]
  pendingUserInput?: PendingUserInput
  taskStats?: TaskStats
  messageStats?: MessageStatsEntry[]
  pendingConfirmations?: PendingPathConfirmation[]
  contextWindows?: ContextWindow[]
}

/**
 * Entry in the file read cache
 */
export interface ReadFileEntry {
  path: string
  tokenCount: number
}

export interface PreparingToolCall {
  index: number
  name: string
}

export interface FormatRetry {
  attempt: number
  maxAttempts: number
  timestamp: number
}

export interface VisionFallback {
  messageId: string
  attachmentId: string
  filename?: string
  description?: string
  startedAt?: number
}

export interface PendingUserInput {
  callId: string
  question: string
}

export interface TaskStats {
  summary: string | null
  iterations: number
  totalTimeSeconds: number
  totalToolCalls: number
  totalTokensGenerated: number
  avgGenerationSpeed: number
  responseCount: number
  llmCallCount: number
  criteria: Array<{ id: string; description: string; status: string }>
  workflowName?: string
  workflowId?: string
  workflowColor?: string
}

export interface MessageStatsEntry {
  messageId: string
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
  stats?: MessageStats
}

export interface PendingPathConfirmation {
  callId: string
  tool: string
  paths: string[]
  workdir: string
  reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command'
}

export interface ContextWindow {
  closedWindowId: string
  newWindowId: string
  beforeTokens: number
  afterTokens: number
  summary: string
  timestamp: number
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
  preparingToolCalls?: PreparingToolCall[]
  formatRetries?: FormatRetry[]
  isComplete?: boolean
  completeReason?: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
  segments?: MessageSegment[]
  stats?: MessageStats
  timestamp: number
  tokenCount?: number
  isStreaming?: boolean
  partial?: boolean
  subAgentId?: string
  subAgentType?: string
  isSystemGenerated?: boolean
  messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
  contextWindowId?: string
  isCompactionSummary?: boolean
  promptContext?: PromptContext
  attachments?: Attachment[] // Optional image attachments
  metadata?: { type: string; name: string; color: string } // For auto-prompt messages
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
