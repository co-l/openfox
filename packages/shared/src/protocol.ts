import type {
  Project,
  Session,
  SessionSummary,
  SessionMode,
  Criterion,
  Message,
  Todo,
  ValidationResult,
  Diagnostic,
  ToolCall,
  ToolResult,
  CriterionStatus,
} from './types.js'

// ============================================================================
// Client → Server Messages
// ============================================================================

export type ClientMessageType =
  // Project management
  | 'project.create'
  | 'project.list'
  | 'project.load'
  | 'project.update'
  | 'project.delete'
  // Session management
  | 'session.create'
  | 'session.load'
  | 'session.list'
  | 'session.delete'
  // Unified chat (replaces plan.message, agent.start, etc.)
  | 'chat.send'           // Send a message (works in any mode)
  | 'chat.stop'           // Stop current generation
  | 'chat.continue'       // Continue generation (after user interruption)
  // Mode switching
  | 'mode.switch'         // Switch to a different mode
  | 'mode.accept'         // Accept criteria and switch to builder (generates summary)
  // Criteria editing (from UI)
  | 'criteria.edit'

export interface ClientMessage<T = unknown> {
  id: string
  type: ClientMessageType
  payload: T
}

// Payload types for client messages

// Project payloads
export interface ProjectCreatePayload {
  name: string
  workdir: string
}

export interface ProjectLoadPayload {
  projectId: string
}

export interface ProjectUpdatePayload {
  projectId: string
  name: string
}

export interface ProjectDeletePayload {
  projectId: string
}

// Session payloads
export interface SessionCreatePayload {
  projectId: string
  title?: string
}

export interface SessionLoadPayload {
  sessionId: string
}

// Chat payloads (unified)
export interface ChatSendPayload {
  content: string
}

export interface ModeSwitchPayload {
  mode: SessionMode
}

// Criteria payloads
export interface CriteriaEditPayload {
  criteria: Criterion[]
}

// ============================================================================
// Server → Client Messages
// ============================================================================

export type ServerMessageType =
  // Project events
  | 'project.state'
  | 'project.list'
  | 'project.deleted'
  // Session events
  | 'session.state'
  | 'session.list'
  | 'session.deleted'
  // Unified chat events (replaces plan.delta, agent.event, etc.)
  | 'chat.delta'          // Text streaming
  | 'chat.thinking'       // Thinking block content
  | 'chat.tool_call'      // Tool being called
  | 'chat.tool_result'    // Tool result
  | 'chat.todo'           // Todo list update (displayed in chat)
  | 'chat.summary'        // Summary block (displayed in chat)
  | 'chat.progress'       // Progress update (e.g., "Generating summary...")
  | 'chat.format_retry'   // Model used wrong format (XML tools), retrying
  | 'chat.done'           // Current generation complete
  | 'chat.error'          // Error during generation
  // Mode events
  | 'mode.changed'        // Mode was changed
  // Criteria events
  | 'criteria.updated'    // Criteria changed
  // Other
  | 'lsp.diagnostics'
  | 'error'
  | 'ack'

export interface ServerMessage<T = unknown> {
  id?: string // Correlation ID if response to client message
  type: ServerMessageType
  payload: T
}

// Payload types for server messages

// Project payloads
export interface ProjectStatePayload {
  project: Project
}

export interface ProjectListPayload {
  projects: Project[]
}

export interface ProjectDeletedPayload {
  projectId: string
}

// Session payloads
export interface SessionStatePayload {
  session: Session
}

export interface SessionListPayload {
  sessions: SessionSummary[]
}

// Chat payloads (unified streaming)
export interface ChatDeltaPayload {
  content: string
}

export interface ChatThinkingPayload {
  content: string
}

export interface ChatToolCallPayload {
  callId: string
  tool: string
  args: Record<string, unknown>
}

export interface ChatToolResultPayload {
  callId: string
  tool: string
  result: ToolResult
}

export interface ChatTodoPayload {
  todos: Todo[]
}

export interface ChatSummaryPayload {
  summary: string
}

export interface ChatProgressPayload {
  message: string
  phase?: 'summary' | 'mode_switch' | 'starting'
}

export interface ChatFormatRetryPayload {
  attempt: number
  maxAttempts: number
}

export interface ChatDonePayload {
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
  stats?: {
    model: string
    mode: SessionMode
    totalTime: number
    toolTime: number
    prefillTokens: number
    prefillSpeed: number
    generationTokens: number
    generationSpeed: number
  }
}

export interface ChatErrorPayload {
  error: string
  recoverable: boolean
}

// Mode payloads
export interface ModeChangedPayload {
  mode: SessionMode
  auto: boolean  // Was this an automatic switch?
  reason?: string
}

// Criteria payloads
export interface CriteriaUpdatedPayload {
  criteria: Criterion[]
  changedId?: string  // Which criterion changed, if specific
}

// Other payloads
export interface LspDiagnosticsPayload {
  path: string
  diagnostics: Diagnostic[]
}

export interface ErrorPayload {
  code: string
  message: string
  details?: unknown
}

// ============================================================================
// Chat Events (unified streaming events)
// ============================================================================

// All chat events use the server message types above (chat.delta, chat.tool_call, etc.)
// These are sent via ServerMessage with the corresponding payload types.

// Special events that may trigger mode changes or UI updates:
export interface ContextCompactionEvent {
  beforeTokens: number
  afterTokens: number
}

export interface AskUserEvent {
  question: string
  callId: string
}

// Agent events (used by runAgent in agent/runner.ts)
export type AgentEvent =
  | { type: 'aborted' }
  | { type: 'text_delta'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'error'; error: string; recoverable: boolean }
  | { type: 'context_compaction'; beforeTokens: number; afterTokens: number }
  | { type: 'done'; allCriteriaPassed: boolean; summary: string; stats: ChatDonePayload['stats'] }
  | { type: 'stuck'; reason: string; failedAttempts: number }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; tool: string; result: ToolResult }
  | { type: 'tool_error'; callId: string; tool: string; error: string; willRetry: boolean }
  | { type: 'ask_user'; question: string; callId: string }
  | { type: 'format_retry'; attempt: number; maxAttempts: number }

// ============================================================================
// Helper Functions
// ============================================================================

export function createClientMessage<T>(
  type: ClientMessageType,
  payload: T
): ClientMessage<T> {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
  }
}

export function createServerMessage<T>(
  type: ServerMessageType,
  payload: T,
  correlationId?: string
): ServerMessage<T> {
  const message: ServerMessage<T> = { type, payload }
  if (correlationId !== undefined) {
    message.id = correlationId
  }
  return message
}

// Type guards
export function isClientMessage(msg: unknown): msg is ClientMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    'type' in msg &&
    'payload' in msg
  )
}

export function isServerMessage(msg: unknown): msg is ServerMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    'payload' in msg
  )
}
