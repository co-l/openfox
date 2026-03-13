import type {
  Project,
  Session,
  SessionSummary,
  Criterion,
  Message,
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
  | 'project.create'
  | 'project.list'
  | 'project.load'
  | 'project.update'
  | 'project.delete'
  | 'session.create'
  | 'session.load'
  | 'session.list'
  | 'session.delete'
  | 'plan.message'
  | 'plan.accept'
  | 'plan.edit_criteria'
  | 'agent.start'
  | 'agent.pause'
  | 'agent.resume'
  | 'agent.intervene'
  | 'agent.stop'
  | 'validate.start'
  | 'criterion.human_verify'

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

export interface PlanMessagePayload {
  content: string
}

export interface PlanEditCriteriaPayload {
  criteria: Criterion[]
}

export interface AgentIntervenePayload {
  response: string
}

export interface CriterionHumanVerifyPayload {
  criterionId: string
  passed: boolean
  reason?: string
}

// ============================================================================
// Server → Client Messages
// ============================================================================

export type ServerMessageType =
  | 'project.state'
  | 'project.list'
  | 'project.deleted'
  | 'session.state'
  | 'session.list'
  | 'session.deleted'
  | 'plan.delta'
  | 'plan.tool_call'
  | 'plan.tool_result'
  | 'plan.criteria'
  | 'plan.done'
  | 'agent.event'
  | 'validation.result'
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

export interface PlanDeltaPayload {
  content: string
  isThinking?: boolean
}

export interface PlanCriteriaPayload {
  criteria: Criterion[]
}

export interface PlanToolCallPayload {
  tool: string
  args: Record<string, unknown>
}

export interface PlanToolResultPayload {
  tool: string
  result: string
}

export interface AgentEventPayload {
  event: AgentEvent
}

export interface ValidationResultPayload {
  result: ValidationResult
}

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
// Agent Events
// ============================================================================

export type AgentEvent =
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentToolErrorEvent
  | AgentCriterionUpdateEvent
  | AgentContextCompactionEvent
  | AgentStuckEvent
  | AgentDoneEvent
  | AgentErrorEvent
  | AgentAskUserEvent
  | AgentTextDeltaEvent
  | AgentAbortedEvent

export interface AgentThinkingEvent {
  type: 'thinking'
  content: string
}

export interface AgentTextDeltaEvent {
  type: 'text_delta'
  content: string
}

export interface AgentToolCallEvent {
  type: 'tool_call'
  callId: string
  tool: string
  args: Record<string, unknown>
}

export interface AgentToolResultEvent {
  type: 'tool_result'
  callId: string
  tool: string
  result: ToolResult
}

export interface AgentToolErrorEvent {
  type: 'tool_error'
  callId: string
  tool: string
  error: string
  willRetry: boolean
}

export interface AgentCriterionUpdateEvent {
  type: 'criterion_update'
  criterionId: string
  status: CriterionStatus
}

export interface AgentContextCompactionEvent {
  type: 'context_compaction'
  beforeTokens: number
  afterTokens: number
}

export interface AgentStuckEvent {
  type: 'stuck'
  reason: string
  failedAttempts: number
  criterionId?: string
}

export interface AgentDoneEvent {
  type: 'done'
  allCriteriaPassed: boolean
  summary: string
  stats?: {
    model: string
    prefillSpeed: number  // tokens/sec
    generationSpeed: number  // tokens/sec
  }
}

export interface AgentErrorEvent {
  type: 'error'
  error: string
  recoverable: boolean
}

export interface AgentAskUserEvent {
  type: 'ask_user'
  question: string
  callId: string
}

export interface AgentAbortedEvent {
  type: 'aborted'
}

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
