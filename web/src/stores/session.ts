import { create } from 'zustand'
import type {
  Session,
  SessionSummary,
  SessionMode,
  Criterion,
  Todo,
  Message,
  ContextState,
  Attachment,
} from '@shared/types.js'
import type {
  ServerMessage,
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
  ModeChangedPayload,
  PhaseChangedPayload,
  CriteriaUpdatedPayload,
  ContextStatePayload,
  QueuedMessage,
  QueueStatePayload,
} from '@shared/protocol.js'
import { wsClient, type ConnectionStatus } from '../lib/ws'
import { useConfigStore } from './config'
import { playNotification, playAchievement, playIntervention, playWaitingForUser } from '../lib/sound'
import type { AgentType } from './notifications'

// Track subscription to prevent duplicates
let isSubscribed = false

// --- Streaming update batching ---
// Buffer high-frequency streaming events and flush once per animation frame
// to reduce renders from 50+/sec to ~16/sec during fast streaming.
interface StreamingBuffer {
  messageId: string | null
  deltaContent: string
  thinkingContent: string
  toolOutput: { messageId: string; callId: string; stream: 'stdout' | 'stderr'; content: string }[]
}

const streamingBuffer: StreamingBuffer = {
  messageId: null,
  deltaContent: '',
  thinkingContent: '',
  toolOutput: [],
}
let streamingRafId: number | null = null
// Will be set once the store is created
let flushStreamingBuffer: (() => void) | null = null

function scheduleStreamingFlush() {
  if (streamingRafId !== null) return
  streamingRafId = requestAnimationFrame(() => {
    streamingRafId = null
    flushStreamingBuffer?.()
  })
}

function cancelStreamingFlush() {
  if (streamingRafId !== null) {
    cancelAnimationFrame(streamingRafId)
    streamingRafId = null
  }
}

function isMessageForCurrentSession(message: ServerMessage, currentSessionId: string | null): boolean {
  return currentSessionId !== null && message.sessionId === currentSessionId
}

function isSessionStateForCurrentView(message: ServerMessage, currentSessionId: string | null): boolean {
  return message.id !== undefined || isMessageForCurrentSession(message, currentSessionId)
}

function addUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.includes(sessionId)
    ? unreadSessionIds
    : [...unreadSessionIds, sessionId]
}

function removeUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.filter(id => id !== sessionId)
}

function mergeSessionIntoSummary(
  sessions: SessionSummary[],
  session: Session,
): SessionSummary[] {
  const existingSession = sessions.find(candidate => candidate.id === session.id)
  const nextSummary: SessionSummary = existingSession
    ? {
        ...existingSession,
        projectId: session.projectId,
        workdir: session.workdir,
        mode: session.mode,
        phase: session.phase,
        isRunning: session.isRunning,
      }
    : {
        id: session.id,
        projectId: session.projectId,
        workdir: session.workdir,
        mode: session.mode,
        phase: session.phase,
        isRunning: session.isRunning,
        createdAt: '',
        updatedAt: '',
        criteriaCount: session.criteria.length,
        criteriaCompleted: session.criteria.filter(criterion => criterion.status.type === 'passed').length,
      }

  return existingSession
    ? sessions.map(candidate => candidate.id === session.id ? nextSummary : candidate)
    : [nextSummary, ...sessions]
}

function mergeSessionList(
  incomingSessions: SessionSummary[],
  existingSessions: SessionSummary[],
  currentSession: Session | null,
): SessionSummary[] {
  return incomingSessions.map(incomingSession => {
    const currentSessionOverride = currentSession?.id === incomingSession.id
      ? currentSession
      : null
    const existingSession = existingSessions.find(candidate => candidate.id === incomingSession.id)

    return {
      ...incomingSession,
      title: incomingSession.title ?? existingSession?.title,
      mode: currentSessionOverride?.mode ?? existingSession?.mode ?? incomingSession.mode,
      phase: currentSessionOverride?.phase ?? existingSession?.phase ?? incomingSession.phase,
      isRunning: currentSessionOverride?.isRunning ?? existingSession?.isRunning ?? incomingSession.isRunning,
      // Preserve recentUserPrompts from incoming session (server source of truth)
      recentUserPrompts: incomingSession.recentUserPrompts,
    }
  })
}

// Pending path confirmation request from server
export interface PendingPathConfirmation {
  callId: string
  tool: string
  paths: string[]
  workdir: string
  reason: 'outside_workdir' | 'sensitive_file' | 'both'
}

interface SessionState {
  // Connection
  connectionStatus: ConnectionStatus
  
  // Sessions
  sessions: SessionSummary[]
  currentSession: Session | null
  unreadSessionIds: string[]
  
  // Messages: server-authoritative, includes streaming state
  // Each message has isStreaming flag to indicate if it's being streamed
  messages: Message[]
  
  // Track which message is currently streaming (for applying deltas)
  streamingMessageId: string | null

  // Separate streaming message object — updated independently from messages[]
  // to avoid O(n) array mapping on every delta. Folded back on chat.done.
  streamingMessage: Message | null
  
  // Current todos (displayed in chat)
  currentTodos: Todo[]
  
  // Context state (for header display)
  contextState: ContextState | null
  
  // Pending path confirmation (outside-workdir access request)
  pendingPathConfirmation: PendingPathConfirmation | null

  // Message queue (while agent is running)
  queuedMessages: QueuedMessage[]
  abortInProgress: boolean

  // Error state
  error: { code: string; message: string } | null
  
  // Actions
  connect: () => Promise<void>
  disconnect: () => void
  
  // Session management
  createSession: (projectId: string, title?: string) => void
  loadSession: (sessionId: string) => void
  listSessions: () => void
  deleteSession: (sessionId: string) => void
  deleteAllSessions: (projectId: string) => void
  clearSession: () => void
  
  // Unified chat (works in any mode)
  sendMessage: (content: string, attachments?: Attachment[]) => void
  stopGeneration: () => void
  continueGeneration: () => void
  
  // Runner (auto-loop)
  launchRunner: (content?: string, attachments?: Attachment[]) => void
  
  // Mode switching
  switchMode: (mode: SessionMode) => void
  acceptAndBuild: () => void
  
  // Criteria (from UI)
  editCriteria: (criteria: Criterion[]) => void
  
  // Context management
  compactContext: () => void
  
  // Per-session provider/model
  setSessionProvider: (providerId: string, model?: string) => void

  // Path confirmation
  confirmPath: (callId: string, approved: boolean) => void

  // Message queue
  queueAsap: (content: string, attachments?: Attachment[]) => void
  queueCompletion: (content: string, attachments?: Attachment[]) => void
  cancelQueued: (queueId: string) => void

  clearError: () => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
}

// Track last phase seen per session via phase.changed events only.
// This avoids races where session.state (direct WS) updates currentSession.phase
// to 'done' before the EventStore phase.changed event arrives.
const lastSeenPhase = new Map<string, string>()

function resolveAgentType(state: SessionState, sessionId?: string): AgentType | undefined {
  const session = sessionId === state.currentSession?.id
    ? state.currentSession
    : null
  const summary = state.sessions.find(s => s.id === sessionId)
  const mode = session?.mode ?? summary?.mode
  if (mode === 'planner') return 'planner'
  if (mode === 'builder') return 'build'
  return undefined
}

function handleGlobalSoundEffects(message: ServerMessage, state: SessionState): void {
  if (message.type === 'chat.done') {
    const payload = message.payload as ChatDonePayload
    const agent = resolveAgentType(state, message.sessionId)
    if (payload.reason === 'complete') {
      playNotification(agent)
    }
    if (payload.reason === 'waiting_for_user') {
      playWaitingForUser(agent)
    }
    return
  }

  // task.completed is emitted exactly once per orchestrator run — reliable trigger
  if (message.type === 'task.completed') {
    const agent = resolveAgentType(state, message.sessionId)
    playAchievement(agent)
    return
  }

  if (message.type === 'phase.changed' && message.sessionId) {
    const payload = message.payload as PhaseChangedPayload
    const previousPhase = lastSeenPhase.get(message.sessionId) ?? null
    lastSeenPhase.set(message.sessionId, payload.phase)

    if (previousPhase === payload.phase) {
      return
    }

    const agent = resolveAgentType(state, message.sessionId)
    if (payload.phase === 'blocked') {
      playIntervention(agent)
    }
  }
}

export const soundTestExports = {
  handleGlobalSoundEffects,
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Wire up the streaming buffer flush function with access to set/get
  flushStreamingBuffer = () => {
    const buf = streamingBuffer
    if (!buf.messageId) return

    const hasDelta = buf.deltaContent.length > 0
    const hasThinking = buf.thinkingContent.length > 0
    const hasToolOutput = buf.toolOutput.length > 0

    if (!hasDelta && !hasThinking && !hasToolOutput) return

    const delta = buf.deltaContent
    const thinking = buf.thinkingContent
    const toolOutputs = buf.toolOutput

    // Clear the buffer before set() to avoid reentrancy issues
    buf.deltaContent = ''
    buf.thinkingContent = ''
    buf.toolOutput = []

    // Update the separate streamingMessage object — no messages[] array mapping
    set(state => {
      const sm = state.streamingMessage
      if (!sm || sm.id !== buf.messageId) return state

      let updated = { ...sm }
      if (hasDelta) {
        updated.content = updated.content + delta
      }
      if (hasThinking) {
        updated.thinkingContent = (updated.thinkingContent ?? '') + thinking
      }
      if (hasToolOutput) {
        updated.toolCalls = updated.toolCalls?.map(tc => {
          const outputs = toolOutputs.filter(o => o.callId === tc.id)
          if (outputs.length === 0) return tc
          return {
            ...tc,
            streamingOutput: [
              ...(tc.streamingOutput ?? []),
              ...outputs.map(o => ({ stream: o.stream, content: o.content }))
            ]
          }
        })
      }
      return { streamingMessage: updated }
    })
  }

  return ({
  connectionStatus: 'disconnected',
  sessions: [],
  currentSession: null,
  unreadSessionIds: [],
  messages: [],
  streamingMessageId: null,
  streamingMessage: null,
  currentTodos: [],
  contextState: null,
  pendingPathConfirmation: null,
  queuedMessages: [],
  abortInProgress: false,
  error: null,

  connect: async () => {
    const status = get().connectionStatus
    if (status === 'connected' || status === 'reconnecting') return
    
    set({ connectionStatus: 'reconnecting' })
    
    wsClient.onStatusChange((newStatus) => {
      set({ connectionStatus: newStatus })
      if (newStatus === 'connected') {
        get().listSessions()
      }
    })
    
    try {
      await wsClient.connect()
      
      if (!isSubscribed) {
        isSubscribed = true
        wsClient.subscribe(get().handleServerMessage)
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      set({ connectionStatus: 'disconnected' })
    }
  },
  
  disconnect: () => {
    wsClient.disconnect()
    set({ connectionStatus: 'disconnected' })
  },
  
  createSession: (projectId, title) => {
    wsClient.send('session.create', { projectId, title })
  },
  
  loadSession: (sessionId) => {
    const currentSession = get().currentSession
    
    // Clear state when loading a different session
    if (!currentSession || currentSession.id !== sessionId) {
      cancelStreamingFlush()
      set({
        currentSession: null,
        unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, sessionId),
        messages: [],
        streamingMessageId: null,
        streamingMessage: null,
        currentTodos: [],
        contextState: null,
        pendingPathConfirmation: null,
        queuedMessages: [],
        abortInProgress: false,
        error: null,
      })
    } else {
      set({ unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, sessionId) })
    }
    wsClient.send('session.load', { sessionId })
  },
  
  listSessions: () => {
    wsClient.send('session.list', {})
  },
  
  deleteSession: (sessionId) => {
    wsClient.send('session.delete', { sessionId })
  },
  
  deleteAllSessions: (projectId) => {
    wsClient.send('session.deleteAll', { projectId })
  },
  
  clearSession: () => {
    cancelStreamingFlush()
    set(state => ({
      currentSession: null,
      messages: [],
      streamingMessageId: null,
      streamingMessage: null,
      currentTodos: [],
      contextState: null,
      unreadSessionIds: state.currentSession
        ? removeUnreadSessionId(state.unreadSessionIds, state.currentSession.id)
        : state.unreadSessionIds,
    }))
  },
  
  sendMessage: (content, attachments) => {
    // No optimistic update needed - server will send chat.message with user message
    set({ streamingMessageId: null })
    wsClient.send('chat.send', { content, attachments })
  },
  
  stopGeneration: () => {
    if (get().abortInProgress) return
    // Flush any buffered streaming content before stopping
    cancelStreamingFlush()
    flushStreamingBuffer?.()
    wsClient.send('chat.stop', {})
    set({ abortInProgress: true })
  },
  
  continueGeneration: () => {
    set({ streamingMessageId: null })
    wsClient.send('chat.continue', {})
  },
  
  launchRunner: (content?: string, attachments?: Attachment[]) => {
    set({ streamingMessageId: null })
    const payload: Record<string, unknown> = {}
    if (content?.trim()) {
      payload.content = content
      if (attachments && attachments.length > 0) payload.attachments = attachments
    }
    wsClient.send('runner.launch', payload)
  },
  
  switchMode: (mode) => {
    wsClient.send('mode.switch', { mode })
  },
  
  acceptAndBuild: () => {
    set({ streamingMessageId: null })
    wsClient.send('mode.accept', {})
  },
  
  editCriteria: (criteria) => {
    wsClient.send('criteria.edit', { criteria })
  },
  
  compactContext: () => {
    wsClient.send('context.compact', {})
  },
  
  setSessionProvider: (providerId, model) => {
    wsClient.send('session.setProvider', { providerId, ...(model ? { model } : {}) })
  },

  confirmPath: (callId, approved) => {
    wsClient.send('path.confirm', { callId, approved })
    set({ pendingPathConfirmation: null })
  },

  queueAsap: (content, attachments) => {
    wsClient.send('queue.asap', { content, attachments })
  },

  queueCompletion: (content, attachments) => {
    wsClient.send('queue.completion', { content, attachments })
  },

  cancelQueued: (queueId) => {
    wsClient.send('queue.cancel', { queueId })
  },

  clearError: () => {
    set({ error: null })
  },
  
  handleServerMessage: (message) => {
    const stateSnapshot = get()
    handleGlobalSoundEffects(message, stateSnapshot)

    const activeSessionId = stateSnapshot.currentSession?.id ?? null
    const markBackgroundSessionUnread = () => {
      const eventSessionId = message.sessionId
      if (!eventSessionId || eventSessionId === activeSessionId) {
        return
      }
      set(state => ({ unreadSessionIds: addUnreadSessionId(state.unreadSessionIds, eventSessionId) }))
    }

    switch (message.type) {
      case 'session.state': {
        const payload = message.payload as SessionStatePayload
        if (!isSessionStateForCurrentView(message, activeSessionId)) {
          break
        }
        // Server sends complete state: session + messages
        // This is the source of truth on load/reconnect
        cancelStreamingFlush()
        const streamingMsg = payload.messages.find(m => m.isStreaming) ?? null
        set({
          currentSession: payload.session,
          sessions: mergeSessionIntoSummary(get().sessions, payload.session),
          unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, payload.session.id),
          messages: payload.messages,
          streamingMessageId: streamingMsg?.id ?? null,
          streamingMessage: streamingMsg,
          currentTodos: [],
          pendingPathConfirmation: null,
          error: null,
        })

        // Sync config store with session's provider/model for header display
        if (payload.session.providerId && payload.session.providerModel) {
          const configStore = useConfigStore.getState()
          const sessionProvider = configStore.providers.find(p => p.id === payload.session.providerId)
          if (sessionProvider) {
            configStore.syncFromSession(payload.session.providerId, payload.session.providerModel)
          }
        }
        break
      }
      
      case 'session.list': {
        const payload = message.payload as SessionListPayload
        set(state => ({
          sessions: mergeSessionList(payload.sessions, state.sessions, state.currentSession),
        }))
        break
      }
      
      case 'session.deleted': {
        const payload = message.payload as { sessionId: string }
        set(state => ({ unreadSessionIds: removeUnreadSessionId(state.unreadSessionIds, payload.sessionId) }))
        get().listSessions()
        break
      }
      
      case 'session.deletedAll': {
        get().listSessions()
        break
      }
      
      case 'session.running': {
        const payload = message.payload as SessionRunningPayload
        const eventSessionId = message.sessionId
        const activeSessionId = get().currentSession?.id
        const isBackgroundSession = eventSessionId && eventSessionId !== activeSessionId
        
        // Always update sidebar running status
        set(state => ({
          sessions: state.sessions.map(s => 
            s.id === eventSessionId 
              ? { ...s, isRunning: payload.isRunning }
              : s
          ),
        }))
        
        // Only update currentSession if this is the active session
        if (!isBackgroundSession) {
          set(state => ({
            currentSession: state.currentSession
              ? { ...state.currentSession, isRunning: payload.isRunning }
              : null,
            pendingPathConfirmation: payload.isRunning ? state.pendingPathConfirmation : null,
            // Reset abort and queue state when agent stops running
            ...(!payload.isRunning ? { abortInProgress: false, queuedMessages: [] } : {}),
          }))
        }
        break
      }
      
      case 'chat.message': {
        // Server created a new message (user message or assistant message before streaming)
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatMessagePayload

        set(state => {
          // Don't add duplicates
          if (state.messages.some(m => m.id === payload.message.id)) {
            return state
          }
          return {
            messages: [...state.messages, payload.message],
            // Track streaming message if it's marked as streaming
            streamingMessageId: payload.message.isStreaming
              ? payload.message.id
              : state.streamingMessageId,
            // Initialize separate streaming message for independent updates
            streamingMessage: payload.message.isStreaming
              ? payload.message
              : state.streamingMessage,
          }
        })
        break
      }
      
      case 'chat.message_updated': {
        // Server updated a message (e.g., isStreaming changed after tool loop iteration)
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatMessageUpdatedPayload
        const isEndingStreaming =
          payload.updates.isStreaming === false &&
          get().streamingMessageId === payload.messageId

        // If streaming is ending, flush buffer and fold streamingMessage back
        if (isEndingStreaming) {
          cancelStreamingFlush()
          flushStreamingBuffer?.()
        }

        set(state => {
          const sm = state.streamingMessage
          const stoppedStreaming = isEndingStreaming

          // If we have a streamingMessage for this ID, fold it back with updates
          if (sm && sm.id === payload.messageId) {
            const finalMessage = { ...sm, ...payload.updates }
            return {
              messages: state.messages.map(m =>
                m.id === payload.messageId ? finalMessage : m
              ),
              streamingMessageId: stoppedStreaming ? null : state.streamingMessageId,
              streamingMessage: stoppedStreaming ? null : { ...sm, ...payload.updates },
            }
          }

          return {
            messages: state.messages.map(m =>
              m.id === payload.messageId
                ? { ...m, ...payload.updates }
                : m
            ),
            streamingMessageId: stoppedStreaming ? null : state.streamingMessageId,
          }
        })
        break
      }
      
      case 'chat.delta': {
        // Append text content — buffered and flushed once per animation frame
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatDeltaPayload
        streamingBuffer.messageId = payload.messageId
        streamingBuffer.deltaContent += payload.content
        scheduleStreamingFlush()
        break
      }
      
      case 'chat.thinking': {
        // Append thinking content — buffered and flushed once per animation frame
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatThinkingPayload
        streamingBuffer.messageId = payload.messageId
        streamingBuffer.thinkingContent += payload.content
        scheduleStreamingFlush()
        break
      }
      
      case 'chat.tool_preparing': {
        // Add preparing tool call indicator (temporary, replaced when full tool call arrives)
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatToolPreparingPayload
        set(state => {
          const sm = state.streamingMessage
          if (sm && sm.id === payload.messageId) {
            return {
              streamingMessage: {
                ...sm,
                preparingToolCalls: [
                  ...(sm.preparingToolCalls ?? []),
                  { index: payload.index, name: payload.name }
                ]
              }
            }
          }
          // Fallback: update in messages array if no streaming message
          return {
            messages: state.messages.map(m =>
              m.id === payload.messageId
                ? {
                    ...m,
                    preparingToolCalls: [
                      ...(m.preparingToolCalls ?? []),
                      { index: payload.index, name: payload.name }
                    ]
                  }
                : m
            ),
          }
        })
        break
      }
      
      case 'chat.tool_call': {
        // Add tool call to the message with this messageId
        // Also remove any matching preparing tool call (by name match, since we don't have index in tool_call)
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatToolCallPayload

        const applyToolCall = (m: Message): Message => {
          const preparingToolCalls = m.preparingToolCalls?.filter((ptc, idx) => {
            if (ptc.name === payload.tool) {
              const hasEarlierMatch = m.preparingToolCalls?.slice(0, idx).some(p => p.name === payload.tool)
              return hasEarlierMatch
            }
            return true
          })
          return {
            ...m,
            toolCalls: [
              ...(m.toolCalls ?? []),
              { id: payload.callId, name: payload.tool, arguments: payload.args, startedAt: Date.now() }
            ],
            ...(preparingToolCalls && preparingToolCalls.length > 0
              ? { preparingToolCalls }
              : { preparingToolCalls: undefined }),
          }
        }

        set(state => {
          const sm = state.streamingMessage
          if (sm && sm.id === payload.messageId) {
            return { streamingMessage: applyToolCall(sm) }
          }
          return {
            messages: state.messages.map(m =>
              m.id === payload.messageId ? applyToolCall(m) : m
            ),
          }
        })
        break
      }
      
      case 'chat.tool_output': {
        // Append streaming output — buffered and flushed once per animation frame
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatToolOutputPayload
        streamingBuffer.messageId = payload.messageId
        streamingBuffer.toolOutput.push({
          messageId: payload.messageId,
          callId: payload.callId,
          stream: payload.stream,
          content: payload.output,
        })
        scheduleStreamingFlush()
        break
      }
      
      case 'chat.tool_result': {
        // Tool results come as separate chat.message events (tool role messages)
        // This event is just for real-time display - can track in message's toolCalls
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatToolResultPayload

        const applyToolResult = (m: Message): Message => {
          const toolCalls = m.toolCalls?.map(tc =>
            tc.id === payload.callId
              ? { ...tc, result: payload.result }
              : tc
          )
          return { ...m, toolCalls }
        }

        set(state => {
          const sm = state.streamingMessage
          if (sm && sm.id === payload.messageId) {
            return { streamingMessage: applyToolResult(sm) }
          }
          return {
            messages: state.messages.map(m =>
              m.id === payload.messageId ? applyToolResult(m) : m
            ),
          }
        })
        break
      }
      
      case 'chat.todo': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatTodoPayload
        set({ currentTodos: payload.todos })
        break
      }
      
      case 'chat.summary': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatSummaryPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, summary: payload.summary }
            : null,
        }))
        break
      }
      
      case 'chat.progress': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        // Progress messages are transient - could add to a separate state if needed
        // For now, just log
        const payload = message.payload as ChatProgressPayload
        console.log('Progress:', payload.message, payload.phase)
        break
      }
      
      case 'chat.format_retry': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        // Format retry - could show in UI
        const payload = message.payload as ChatFormatRetryPayload
        console.log('Format retry:', payload.attempt, '/', payload.maxAttempts)
        break
      }
      
      case 'chat.done': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        // Flush any buffered streaming content before finalizing
        cancelStreamingFlush()
        flushStreamingBuffer?.()

        const payload = message.payload as ChatDonePayload
        const messageStats = payload.stats as Message['stats']

        // Reset streaming buffer
        streamingBuffer.messageId = null
        streamingBuffer.deltaContent = ''
        streamingBuffer.thinkingContent = ''
        streamingBuffer.toolOutput = []

        // Fold streamingMessage back into messages[] and mark as done
        set(state => {
          const sm = state.streamingMessage
          const finalMessage = sm && sm.id === payload.messageId
            ? { ...sm, isStreaming: false, stats: messageStats ?? sm.stats }
            : null

          return {
            messages: state.messages.map(m =>
              m.id === payload.messageId
                ? (finalMessage ?? { ...m, isStreaming: false, stats: messageStats ?? m.stats })
                : m
            ),
            streamingMessageId: null,
            streamingMessage: null,
          }
        })
        break
      }
      
      case 'chat.error': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        // Flush buffered content so nothing is lost
        cancelStreamingFlush()
        flushStreamingBuffer?.()

        const payload = message.payload as ChatErrorPayload
        console.error('Chat error:', payload.error, 'recoverable:', payload.recoverable)
        if (!payload.recoverable) {
          streamingBuffer.messageId = null
          streamingBuffer.deltaContent = ''
          streamingBuffer.thinkingContent = ''
          streamingBuffer.toolOutput = []
        }
        set(state => ({
          error: { code: 'CHAT_ERROR', message: payload.error },
          streamingMessageId: payload.recoverable ? state.streamingMessageId : null,
          // Fold streamingMessage back into messages on non-recoverable error
          ...(payload.recoverable ? {} : {
            messages: state.streamingMessage
              ? state.messages.map(m => m.id === state.streamingMessage!.id ? state.streamingMessage! : m)
              : state.messages,
            streamingMessage: null,
          }),
        }))
        break
      }
      
      case 'chat.path_confirmation': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatPathConfirmationPayload
        set({
          pendingPathConfirmation: {
            callId: payload.callId,
            tool: payload.tool,
            paths: payload.paths,
            workdir: payload.workdir,
            reason: payload.reason,
          },
        })
        break
      }
      
      case 'mode.changed': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ModeChangedPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, mode: payload.mode }
            : null,
        }))
        break
      }
      
      case 'phase.changed': {
        const payload = message.payload as PhaseChangedPayload
        const eventSessionId = message.sessionId
        const activeSessionId = get().currentSession?.id
        const isBackgroundSession = eventSessionId && eventSessionId !== activeSessionId
        
        // Always update sidebar status for the session
        set(state => ({
          sessions: state.sessions.map(s => 
            s.id === eventSessionId 
              ? { ...s, phase: payload.phase }
              : s
          ),
        }))

        if (!isBackgroundSession) {
          set(state => ({
            currentSession: state.currentSession
              ? { ...state.currentSession, phase: payload.phase }
              : null,
          }))
        }
        break
      }
      
      case 'criteria.updated': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as CriteriaUpdatedPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, criteria: payload.criteria }
            : null,
        }))
        break
      }
      
      case 'context.state': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ContextStatePayload
        set({ contextState: payload.context })
        break
      }
      
      case 'session.name_generated': {
        // Session name was generated - update both currentSession and sessions list
        const payload = message.payload as { name: string }
        const eventSessionId = message.sessionId
        const activeSessionId = get().currentSession?.id
        
        set(state => {
          const updatedSessions = state.sessions.map(s =>
            s.id === eventSessionId
              ? { ...s, title: payload.name, updatedAt: new Date().toISOString() }
              : s
          )
          
          const updatedCurrentSession = activeSessionId === eventSessionId
            ? state.currentSession
              ? { ...state.currentSession, title: payload.name, updatedAt: new Date().toISOString() }
              : null
            : state.currentSession
          
          return {
            sessions: updatedSessions,
            currentSession: updatedCurrentSession,
          }
        })
        break
      }
      
      case 'queue.state': {
        const payload = message.payload as QueueStatePayload
        set({ queuedMessages: payload.messages })
        break
      }

      case 'error': {
        const payload = message.payload as { code: string; message: string }
        console.error('Server error:', payload)
        set({
          error: { code: payload.code, message: payload.message },
          streamingMessageId: null,
        })
        break
      }
    }
  },
})})

// Helper selector: is the session currently running (agent active)?
export function useIsRunning() {
  return useSessionStore(state => state.currentSession?.isRunning ?? false)
}

export function useQueuedMessages() {
  return useSessionStore(state => state.queuedMessages)
}

export function useAbortInProgress() {
  return useSessionStore(state => state.abortInProgress)
}
