import type {
  ClientMessage,
  ServerMessage,
  SessionLoadPayload,
  ChatSendPayload,
  ModeSwitchPayload,
  CriteriaEditPayload,
  AskAnswerPayload,
  ProjectStatePayload,
  ProjectListPayload,
  SessionStatePayload,
  SessionListPayload,
  SessionRunningPayload,
  SessionNameGeneratedPayload,
  PendingPathConfirmationPayload,
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
  ChatAskUserPayload,
  ChatVisionFallbackPayload,
  PathConfirmPayload,
  ModeChangedPayload,
  PhaseChangedPayload,
  CriteriaUpdatedPayload,
  ContextStatePayload,
  ErrorPayload,
  QueueAsapPayload,
  QueueCompletionPayload,
  QueueCancelPayload,
  QueueStatePayload,
  QueuedMessage,
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
export function createSessionStateMessage(
  session: Session,
  messages: Message[],
  pendingConfirmations: PendingPathConfirmationPayload[] = [],
  correlationId?: string
): ServerMessage<SessionStatePayload> {
  // Enrich messages so toolCalls have their results attached
  const enrichedMessages = enrichMessagesWithToolResults(messages)
  return createServerMessage('session.state', { session, messages: enrichedMessages, pendingConfirmations }, correlationId)
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
  phase?: 'summary' | 'mode_switch' | 'starting' | 'context_warning' | 'context_error'
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
  stats?: ChatDonePayload['stats'],
  agentType?: 'sub-agent'
): ServerMessage<ChatDonePayload> {
  return createServerMessage('chat.done', { messageId, reason, ...(stats ? { stats } : {}), ...(agentType ? { agentType } : {}) })
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

// Ask user messages
export function createChatAskUserMessage(
  callId: string,
  question: string
): ServerMessage<ChatAskUserPayload> {
  return createServerMessage('chat.ask_user', { callId, question })
}

// Vision fallback messages
export function createChatVisionFallbackMessage(
  payload: ChatVisionFallbackPayload
): ServerMessage<ChatVisionFallbackPayload> {
  return createServerMessage('chat.vision_fallback', payload)
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

// Session name messages
export function createSessionNameGeneratedMessage(name: string, sessionId?: string): ServerMessage<SessionNameGeneratedPayload> {
  const msg: ServerMessage<SessionNameGeneratedPayload> = {
    type: 'session.name_generated',
    payload: { name },
  }
  if (sessionId) {
    msg.sessionId = sessionId
  }
  return msg
}

// Type guards for payloads

// Session payloads
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

// Ask user payloads
export function isAskAnswerPayload(payload: unknown): payload is AskAnswerPayload {
  return typeof payload === 'object' && payload !== null && 'callId' in payload && 'answer' in payload
}

// Queue messages
export function createQueueStateMessage(messages: QueuedMessage[]): ServerMessage<QueueStatePayload> {
  return createServerMessage('queue.state', { messages })
}

// Queue payload type guards
export function isQueueAsapPayload(payload: unknown): payload is QueueAsapPayload {
  return typeof payload === 'object' && payload !== null && 'content' in payload && typeof (payload as QueueAsapPayload).content === 'string'
}

export function isQueueCompletionPayload(payload: unknown): payload is QueueCompletionPayload {
  return typeof payload === 'object' && payload !== null && 'content' in payload && typeof (payload as QueueCompletionPayload).content === 'string'
}

export function isQueueCancelPayload(payload: unknown): payload is QueueCancelPayload {
  return typeof payload === 'object' && payload !== null && 'queueId' in payload && typeof (payload as QueueCancelPayload).queueId === 'string'
}

// ============================================================================
// Event Store → Server Message Conversion
// ============================================================================

import type { StoredEvent, TurnEvent } from '../events/types.js'

/**
 * Convert a StoredEvent from EventStore to a ServerMessage for WebSocket.
 * This bridges the new event sourcing layer with the existing frontend protocol.
 * 
 * Returns null for events that don't have a direct WebSocket equivalent
 * (e.g., turn.snapshot events are used for efficient loading, not streaming).
 */
export function storedEventToServerMessage(event: StoredEvent): ServerMessage | null {
  switch (event.type) {
    case 'message.start': {
      const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
      // Create a minimal Message object for chat.message
      // User messages have content upfront and are not streaming
      // Assistant messages start streaming (content builds up via deltas)
      const isUserOrSystem = data.role === 'user' || data.role === 'system'
      const message: Message = {
        id: data.messageId,
        role: data.role,
        content: data.content ?? '',
        timestamp: new Date(event.timestamp).toISOString(),
        tokenCount: 0,
        isStreaming: !isUserOrSystem, // Only assistant messages stream
        ...(data.contextWindowId ? { contextWindowId: data.contextWindowId } : {}),
        ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
        ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
        ...(data.isSystemGenerated ? { isSystemGenerated: data.isSystemGenerated } : {}),
        ...(data.messageKind ? { messageKind: data.messageKind } : {}),
        ...(data.isCompactionSummary ? { isCompactionSummary: data.isCompactionSummary } : {}),
        ...(data.attachments ? { attachments: data.attachments } : {}),
      }
      return createChatMessageMessage(message)
    }

    case 'message.delta': {
      const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
      return createChatDeltaMessage(data.messageId, data.content)
    }

    case 'message.thinking': {
      const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
      return createChatThinkingMessage(data.messageId, data.content)
    }

    case 'message.done': {
      const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
      // This maps to chat.message_updated with isStreaming: false and optionally stats
      const updates: {
        isStreaming: false
        partial?: true
        stats?: typeof data.stats
        promptContext?: typeof data.promptContext
      } = { isStreaming: false }
      if (data.partial) {
        updates.partial = true
      }
      if (data.stats) {
        updates.stats = data.stats
      }
      if (data.promptContext) {
        updates.promptContext = data.promptContext
      }
      return createChatMessageUpdatedMessage(data.messageId, updates)
    }

    case 'tool.preparing': {
      const data = event.data as Extract<TurnEvent, { type: 'tool.preparing' }>['data']
      return createChatToolPreparingMessage(data.messageId, data.index, data.name)
    }

    case 'tool.call': {
      const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
      return createChatToolCallMessage(
        data.messageId,
        data.toolCall.id,
        data.toolCall.name,
        data.toolCall.arguments
      )
    }

    case 'tool.output': {
      const data = event.data as Extract<TurnEvent, { type: 'tool.output' }>['data']
      return createChatToolOutputMessage('', data.toolCallId, data.content, data.stream)
    }

    case 'tool.result': {
      const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
      // Need messageId for the result - we include it in the event
      return createChatToolResultMessage(
        data.messageId,
        data.toolCallId,
        '', // Tool name not available in event, but not used by frontend for matching
        data.result
      )
    }

    case 'phase.changed': {
      const data = event.data as Extract<TurnEvent, { type: 'phase.changed' }>['data']
      return createPhaseChangedMessage(data.phase)
    }

    case 'task.completed': {
      const data = event.data as Extract<TurnEvent, { type: 'task.completed' }>['data']
      return createServerMessage('task.completed', data)
    }

    case 'mode.changed': {
      const data = event.data as Extract<TurnEvent, { type: 'mode.changed' }>['data']
      return createModeChangedMessage(data.mode, data.auto, data.reason)
    }

    case 'running.changed': {
      const data = event.data as Extract<TurnEvent, { type: 'running.changed' }>['data']
      return createSessionRunningMessage(data.isRunning)
    }

    case 'criteria.set': {
      const data = event.data as Extract<TurnEvent, { type: 'criteria.set' }>['data']
      return createCriteriaUpdatedMessage(data.criteria)
    }

    case 'criterion.updated': {
      // No direct equivalent - would need to fetch full criteria list
      // For now, skip this event in streaming (frontend gets full state on load)
      return null
    }

    case 'context.state': {
      const data = event.data as ContextState
      return createContextStateMessage(data)
    }

    case 'session.name_generated': {
      const data = event.data as { name: string }
      return {
        type: 'session.name_generated',
        payload: { name: data.name },
        sessionId: event.sessionId,
      }
    }

    case 'todo.updated': {
      const data = event.data as Extract<TurnEvent, { type: 'todo.updated' }>['data']
      return createChatTodoMessage(data.todos)
    }

    case 'chat.done': {
      const data = event.data as Extract<TurnEvent, { type: 'chat.done' }>['data']
      return createChatDoneMessage(data.messageId, data.reason, data.stats)
    }

    case 'chat.error': {
      const data = event.data as Extract<TurnEvent, { type: 'chat.error' }>['data']
      return createChatErrorMessage(data.error, data.recoverable)
    }

    case 'chat.ask_user': {
      const data = event.data as Extract<TurnEvent, { type: 'chat.ask_user' }>['data']
      return createChatAskUserMessage(data.callId, data.question)
    }

    case 'format.retry': {
      const data = event.data as Extract<TurnEvent, { type: 'format.retry' }>['data']
      return createChatFormatRetryMessage(data.attempt, data.maxAttempts)
    }

    case 'turn.snapshot':
    case 'context.compacted':
      // These are internal events, not sent to frontend in real-time
      return null

    default:
      // Unknown event type - log and skip
      return null
  }
}
