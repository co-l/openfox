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
} from '../../../src/shared/types.js'
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
} from '../../../src/shared/protocol.js'
import { wsClient, type ConnectionStatus } from '../lib/ws'
import { playNotification, playAchievement, playIntervention, playWaitingForUser } from '../lib/sound'

// Track subscription to prevent duplicates
let isSubscribed = false

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
  
  // Current todos (displayed in chat)
  currentTodos: Todo[]
  
  // Context state (for header display)
  contextState: ContextState | null
  
  // Pending path confirmation (outside-workdir access request)
  pendingPathConfirmation: PendingPathConfirmation | null
  
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
  clearSession: () => void
  
  // Unified chat (works in any mode)
  sendMessage: (content: string, attachments?: Attachment[]) => void
  stopGeneration: () => void
  continueGeneration: () => void
  
  // Runner (auto-loop)
  launchRunner: () => void
  
  // Mode switching
  switchMode: (mode: SessionMode) => void
  acceptAndBuild: () => void
  
  // Criteria (from UI)
  editCriteria: (criteria: Criterion[]) => void
  
  // Context management
  compactContext: () => void
  
  // Path confirmation
  confirmPath: (callId: string, approved: boolean) => void
  
  clearError: () => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
}

function getKnownPhase(state: SessionState, sessionId: string): SessionSummary['phase'] | Session['phase'] | null {
  if (state.currentSession?.id === sessionId) {
    return state.currentSession.phase
  }

  return state.sessions.find(session => session.id === sessionId)?.phase ?? null
}

function handleGlobalSoundEffects(message: ServerMessage, state: SessionState): void {
  if (message.type === 'chat.done') {
    const payload = message.payload as ChatDonePayload
    if (payload.reason === 'complete') {
      playNotification()
    }
    if (payload.reason === 'waiting_for_user') {
      playWaitingForUser()
    }
    return
  }

  if (message.type === 'phase.changed' && message.sessionId) {
    const payload = message.payload as PhaseChangedPayload
    const previousPhase = getKnownPhase(state, message.sessionId)
    if (previousPhase === payload.phase) {
      return
    }

    if (payload.phase === 'done') {
      playAchievement()
    }
    if (payload.phase === 'blocked') {
      playIntervention()
    }
  }
}

export const soundTestExports = {
  handleGlobalSoundEffects,
}

export const useSessionStore = create<SessionState>((set, get) => ({
  connectionStatus: 'disconnected',
  sessions: [],
  currentSession: null,
  unreadSessionIds: [],
  messages: [],
  streamingMessageId: null,
  currentTodos: [],
  contextState: null,
  pendingPathConfirmation: null,
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
      set({ 
        currentSession: null,
        unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, sessionId),
        messages: [],
        streamingMessageId: null,
        currentTodos: [],
        contextState: null,
        pendingPathConfirmation: null,
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
  
  clearSession: () => {
    set(state => ({ 
      currentSession: null, 
      messages: [],
      streamingMessageId: null,
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
    wsClient.send('chat.stop', {})
  },
  
  continueGeneration: () => {
    set({ streamingMessageId: null })
    wsClient.send('chat.continue', {})
  },
  
  launchRunner: () => {
    set({ streamingMessageId: null })
    wsClient.send('runner.launch', {})
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
  
  confirmPath: (callId, approved) => {
    wsClient.send('path.confirm', { callId, approved })
    set({ pendingPathConfirmation: null })
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
        set({ 
          currentSession: payload.session,
          sessions: mergeSessionIntoSummary(get().sessions, payload.session),
          unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, payload.session.id),
          messages: payload.messages,
          // If any message is streaming, track it
          streamingMessageId: payload.messages.find(m => m.isStreaming)?.id ?? null,
          currentTodos: [],
          pendingPathConfirmation: null,
          error: null,
        })
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
        set(state => ({
          messages: state.messages.map(m => 
            m.id === payload.messageId
              ? { ...m, ...payload.updates }
              : m
          ),
          // Clear streaming if the updated message was streaming and is now not
          streamingMessageId: 
            state.streamingMessageId === payload.messageId && payload.updates.isStreaming === false
              ? null
              : state.streamingMessageId,
        }))
        break
      }
      
      case 'chat.delta': {
        // Append text content to the message with this messageId
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatDeltaPayload
        set(state => ({
          messages: state.messages.map(m => 
            m.id === payload.messageId
              ? { ...m, content: m.content + payload.content }
              : m
          ),
          streamingMessageId: payload.messageId,
        }))
        break
      }
      
      case 'chat.thinking': {
        // Append thinking content to the message with this messageId
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatThinkingPayload
        set(state => ({
          messages: state.messages.map(m => 
            m.id === payload.messageId
              ? { ...m, thinkingContent: (m.thinkingContent ?? '') + payload.content }
              : m
          ),
          streamingMessageId: payload.messageId,
        }))
        break
      }
      
      case 'chat.tool_preparing': {
        // Add preparing tool call indicator (temporary, replaced when full tool call arrives)
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatToolPreparingPayload
        set(state => ({
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
        }))
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
        set(state => ({
          messages: state.messages.map(m => {
            if (m.id !== payload.messageId) return m
            
            // Remove the first matching preparing tool call by name
            const preparingToolCalls = m.preparingToolCalls?.filter((ptc, idx) => {
              // Remove the first match with this name
              if (ptc.name === payload.tool) {
                const hasEarlierMatch = m.preparingToolCalls?.slice(0, idx).some(p => p.name === payload.tool)
                return hasEarlierMatch // Keep if there was an earlier match (only remove first)
              }
              return true
            })
            
            return {
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []),
                { id: payload.callId, name: payload.tool, arguments: payload.args, startedAt: Date.now() }
              ],
              // Only include preparingToolCalls if there are any left
              ...(preparingToolCalls && preparingToolCalls.length > 0 
                ? { preparingToolCalls } 
                : { preparingToolCalls: undefined }),
            }
          }),
        }))
        break
      }
      
      case 'chat.tool_output': {
        // Append streaming output to the tool call (run_command only)
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatToolOutputPayload
        set(state => ({
          messages: state.messages.map(m => {
            if (m.id !== payload.messageId) return m
            const toolCalls = m.toolCalls?.map(tc => {
              if (tc.id !== payload.callId) return tc
              return {
                ...tc,
                streamingOutput: [
                  ...(tc.streamingOutput ?? []),
                  { stream: payload.stream, content: payload.output }
                ]
              }
            })
            return { ...m, toolCalls }
          }),
        }))
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
        set(state => ({
          messages: state.messages.map(m => {
            if (m.id !== payload.messageId) return m
            // Update the tool call with result
            const toolCalls = m.toolCalls?.map(tc => 
              tc.id === payload.callId
                ? { ...tc, result: payload.result }
                : tc
            )
            return { ...m, toolCalls }
          }),
        }))
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
        const payload = message.payload as ChatDonePayload
        const messageStats = payload.stats as Message['stats']
        
        // Mark the message as no longer streaming and add stats if present
        // Note: isRunning is now updated via session.running event, not here
        set(state => ({
          messages: state.messages.map(m => 
            m.id === payload.messageId
              ? { ...m, isStreaming: false, stats: messageStats ?? m.stats }
              : m
          ),
          streamingMessageId: null,
        }))
        break
      }
      
      case 'chat.error': {
        if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
          markBackgroundSessionUnread()
          break
        }
        const payload = message.payload as ChatErrorPayload
        console.error('Chat error:', payload.error, 'recoverable:', payload.recoverable)
        set({ 
          error: { code: 'CHAT_ERROR', message: payload.error },
          streamingMessageId: payload.recoverable ? get().streamingMessageId : null,
        })
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
}))

// Helper selector: is the session currently running (agent active)?
export function useIsRunning() {
  return useSessionStore(state => state.currentSession?.isRunning ?? false)
}
