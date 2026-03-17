import type {
  ClientMessage,
  ServerMessage,
  ProjectCreatePayload,
  ProjectLoadPayload,
  ProjectUpdatePayload,
  ProjectDeletePayload,
  SessionCreatePayload,
  SessionLoadPayload,
  ChatSendPayload,
  ModeSwitchPayload,
  CriteriaEditPayload,
  ProjectStatePayload,
  ProjectListPayload,
  SessionStatePayload,
  SessionListPayload,
  SessionRunningPayload,
  ChatDeltaPayload,
  ChatThinkingPayload,
  ChatToolPreparingPayload,
  ChatToolCallPayload,
  ChatToolOutputPayload,
  ChatToolResultPayload,
  ChatTodoPayload,
  ChatSummaryPayload,
  ChatProgressPayload,
  ChatFormatRetryPayload,
  ChatMessagePayload,
  ChatMessageUpdatedPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatPathConfirmationPayload,
  PathConfirmPayload,
  ModeChangedPayload,
  PhaseChangedPayload,
  CriteriaUpdatedPayload,
  ContextStatePayload,
  ErrorPayload,
  SettingsGetPayload,
  SettingsSetPayload,
  SettingsValuePayload,
} from '../../shared/protocol.js'
import { isClientMessage, createServerMessage } from '../../shared/protocol.js'
import type { Project, Session, SessionSummary, SessionMode, SessionPhase, Criterion, Todo, ToolResult, Message, ContextState, ToolCall } from '../../shared/types.js'

/**
 * Enrich messages by attaching tool results to their parent toolCalls.
 * This ensures frontend receives consistent data shape whether streaming or loading from DB.
 * 
 * Tool results are stored in separate 'tool' role messages, but for display purposes
 * the frontend expects results attached to the toolCall objects on assistant messages.
 */
function enrichMessagesWithToolResults(messages: Message[]): Message[] {
  // Build toolCallId → toolResult lookup from tool messages
  const resultMap = new Map<string, ToolResult>()
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId && msg.toolResult) {
      resultMap.set(msg.toolCallId, msg.toolResult)
    }
  }
  
  // If no tool results, return as-is
  if (resultMap.size === 0) return messages
  
  // Attach results to toolCalls on assistant messages
  return messages.map(msg => {
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) return msg
    
    // Check if any toolCalls need enrichment
    const needsEnrichment = msg.toolCalls.some(tc => !tc.result && resultMap.has(tc.id))
    if (!needsEnrichment) return msg
    
    return {
      ...msg,
      toolCalls: msg.toolCalls.map((tc): ToolCall => {
        if (tc.result) return tc
        const result = resultMap.get(tc.id)
        // Only add result if it exists (satisfies exactOptionalPropertyTypes)
        return result ? { ...tc, result } : tc
      })
    }
  })
}

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data)
    if (isClientMessage(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message)
}

// Error message
export function createErrorMessage(code: string, message: string, correlationId?: string): ServerMessage<ErrorPayload> {
  return createServerMessage('error', { code, message }, correlationId)
}

// Session messages
export function createSessionStateMessage(session: Session, messages: Message[], correlationId?: string): ServerMessage<SessionStatePayload> {
  // Enrich messages so toolCalls have their results attached
  const enrichedMessages = enrichMessagesWithToolResults(messages)
  return createServerMessage('session.state', { session, messages: enrichedMessages }, correlationId)
}

export function createSessionListMessage(sessions: SessionSummary[], correlationId?: string): ServerMessage<SessionListPayload> {
  return createServerMessage('session.list', { sessions }, correlationId)
}

export function createSessionRunningMessage(isRunning: boolean): ServerMessage<SessionRunningPayload> {
  return createServerMessage('session.running', { isRunning })
}

// Project messages
export function createProjectStateMessage(project: Project, correlationId?: string): ServerMessage<ProjectStatePayload> {
  return createServerMessage('project.state', { project }, correlationId)
}

export function createProjectListMessage(projects: Project[], correlationId?: string): ServerMessage<ProjectListPayload> {
  return createServerMessage('project.list', { projects }, correlationId)
}

// Chat messages - all include messageId to identify which message to update
export function createChatDeltaMessage(messageId: string, content: string): ServerMessage<ChatDeltaPayload> {
  return createServerMessage('chat.delta', { messageId, content })
}

export function createChatThinkingMessage(messageId: string, content: string): ServerMessage<ChatThinkingPayload> {
  return createServerMessage('chat.thinking', { messageId, content })
}

export function createChatToolPreparingMessage(messageId: string, index: number, name: string): ServerMessage<ChatToolPreparingPayload> {
  return createServerMessage('chat.tool_preparing', { messageId, index, name })
}

export function createChatToolCallMessage(messageId: string, callId: string, tool: string, args: Record<string, unknown>): ServerMessage<ChatToolCallPayload> {
  return createServerMessage('chat.tool_call', { messageId, callId, tool, args })
}

export function createChatToolResultMessage(messageId: string, callId: string, tool: string, result: ToolResult): ServerMessage<ChatToolResultPayload> {
  return createServerMessage('chat.tool_result', { messageId, callId, tool, result })
}

export function createChatToolOutputMessage(
  messageId: string,
  callId: string,
  output: string,
  stream: 'stdout' | 'stderr'
): ServerMessage<ChatToolOutputPayload> {
  return createServerMessage('chat.tool_output', { messageId, callId, output, stream })
}

export function createChatTodoMessage(todos: Todo[]): ServerMessage<ChatTodoPayload> {
  return createServerMessage('chat.todo', { todos })
}

export function createChatSummaryMessage(summary: string): ServerMessage<ChatSummaryPayload> {
  return createServerMessage('chat.summary', { summary })
}

export function createChatProgressMessage(
  message: string,
  phase?: 'summary' | 'mode_switch' | 'starting'
): ServerMessage<ChatProgressPayload> {
  return createServerMessage('chat.progress', { message, ...(phase ? { phase } : {}) })
}

export function createChatFormatRetryMessage(
  attempt: number,
  maxAttempts: number
): ServerMessage<ChatFormatRetryPayload> {
  return createServerMessage('chat.format_retry', { attempt, maxAttempts })
}

export function createChatMessageMessage(message: Message): ServerMessage<ChatMessagePayload> {
  return createServerMessage('chat.message', { message })
}

export function createChatMessageUpdatedMessage(
  messageId: string,
  updates: ChatMessageUpdatedPayload['updates']
): ServerMessage<ChatMessageUpdatedPayload> {
  return createServerMessage('chat.message_updated', { messageId, updates })
}

export function createChatDoneMessage(
  messageId: string,
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user',
  stats?: ChatDonePayload['stats']
): ServerMessage<ChatDonePayload> {
  return createServerMessage('chat.done', { messageId, reason, ...(stats ? { stats } : {}) })
}

export function createChatErrorMessage(error: string, recoverable: boolean): ServerMessage<ChatErrorPayload> {
  return createServerMessage('chat.error', { error, recoverable })
}

// Path confirmation messages
export function createChatPathConfirmationMessage(
  callId: string,
  tool: string,
  paths: string[],
  workdir: string,
  reason: ChatPathConfirmationPayload['reason']
): ServerMessage<ChatPathConfirmationPayload> {
  return createServerMessage('chat.path_confirmation', { callId, tool, paths, workdir, reason })
}

// Mode messages
export function createModeChangedMessage(mode: SessionMode, auto: boolean, reason?: string): ServerMessage<ModeChangedPayload> {
  return createServerMessage('mode.changed', { mode, auto, ...(reason ? { reason } : {}) })
}

// Phase messages
export function createPhaseChangedMessage(phase: SessionPhase): ServerMessage<PhaseChangedPayload> {
  return createServerMessage('phase.changed', { phase })
}

// Criteria messages
export function createCriteriaUpdatedMessage(criteria: Criterion[], changedId?: string): ServerMessage<CriteriaUpdatedPayload> {
  return createServerMessage('criteria.updated', { criteria, ...(changedId ? { changedId } : {}) })
}

// Context messages
export function createContextStateMessage(context: ContextState): ServerMessage<ContextStatePayload> {
  return createServerMessage('context.state', { context })
}

// Type guards for payloads

// Project payloads
export function isProjectCreatePayload(payload: unknown): payload is ProjectCreatePayload {
  return typeof payload === 'object' && payload !== null && 'name' in payload && 'workdir' in payload
}

export function isProjectLoadPayload(payload: unknown): payload is ProjectLoadPayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

export function isProjectUpdatePayload(payload: unknown): payload is ProjectUpdatePayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

export function isProjectDeletePayload(payload: unknown): payload is ProjectDeletePayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

// Session payloads
export function isSessionCreatePayload(payload: unknown): payload is SessionCreatePayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

export function isSessionLoadPayload(payload: unknown): payload is SessionLoadPayload {
  return typeof payload === 'object' && payload !== null && 'sessionId' in payload
}

// Chat payloads
export function isChatSendPayload(payload: unknown): payload is ChatSendPayload {
  return typeof payload === 'object' && payload !== null && 'content' in payload
}

export function isModeSwitchPayload(payload: unknown): payload is ModeSwitchPayload {
  return typeof payload === 'object' && payload !== null && 'mode' in payload
}

export function isCriteriaEditPayload(payload: unknown): payload is CriteriaEditPayload {
  return typeof payload === 'object' && payload !== null && 'criteria' in payload
}

// Path confirmation payloads
export function isPathConfirmPayload(payload: unknown): payload is PathConfirmPayload {
  return typeof payload === 'object' && payload !== null && 'callId' in payload && 'approved' in payload
}

// Settings payloads
export function isSettingsGetPayload(payload: unknown): payload is SettingsGetPayload {
  return typeof payload === 'object' && payload !== null && 'key' in payload
}

export function isSettingsSetPayload(payload: unknown): payload is SettingsSetPayload {
  return typeof payload === 'object' && payload !== null && 'key' in payload && 'value' in payload
}

export function createSettingsValueMessage(key: string, value: string | null, correlationId?: string): ServerMessage {
  return createServerMessage<SettingsValuePayload>('settings.value', { key, value }, correlationId)
}
