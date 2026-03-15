import { create } from 'zustand'
import type {
  Session,
  SessionSummary,
  SessionMode,
  Criterion,
  Todo,
  Message,
  ContextState,
} from '@openfox/shared'
import type {
  ServerMessage,
  SessionStatePayload,
  SessionListPayload,
  ChatDeltaPayload,
  ChatThinkingPayload,
  ChatToolCallPayload,
  ChatToolResultPayload,
  ChatTodoPayload,
  ChatSummaryPayload,
  ChatProgressPayload,
  ChatFormatRetryPayload,
  ChatMessagePayload,
  ChatMessageUpdatedPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ModeChangedPayload,
  PhaseChangedPayload,
  CriteriaUpdatedPayload,
  ContextStatePayload,
} from '@openfox/shared/protocol'
import { wsClient, type ConnectionStatus } from '../lib/ws'
import { playNotification, playAchievement, playIntervention } from '../lib/sound'

// Track subscription to prevent duplicates
let isSubscribed = false

interface SessionState {
  // Connection
  connectionStatus: ConnectionStatus
  
  // Sessions
  sessions: SessionSummary[]
  currentSession: Session | null
  
  // Messages: server-authoritative, includes streaming state
  // Each message has isStreaming flag to indicate if it's being streamed
  messages: Message[]
  
  // Track which message is currently streaming (for applying deltas)
  streamingMessageId: string | null
  
  // Current todos (displayed in chat)
  currentTodos: Todo[]
  
  // Context state (for header display)
  contextState: ContextState | null
  
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
  sendMessage: (content: string) => void
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
  
  clearError: () => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  connectionStatus: 'disconnected',
  sessions: [],
  currentSession: null,
  messages: [],
  streamingMessageId: null,
  currentTodos: [],
  contextState: null,
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
        messages: [],
        streamingMessageId: null,
        currentTodos: [],
        contextState: null,
      })
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
    set({ 
      currentSession: null, 
      messages: [],
      streamingMessageId: null,
      currentTodos: [],
      contextState: null,
    })
  },
  
  sendMessage: (content) => {
    // No optimistic update needed - server will send chat.message with user message
    set({ streamingMessageId: null })
    wsClient.send('chat.send', { content })
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
  
  clearError: () => {
    set({ error: null })
  },
  
  handleServerMessage: (message) => {
    switch (message.type) {
      case 'session.state': {
        const payload = message.payload as SessionStatePayload
        // Server sends complete state: session + messages
        // This is the source of truth on load/reconnect
        set({ 
          currentSession: payload.session,
          messages: payload.messages,
          // If any message is streaming, track it
          streamingMessageId: payload.messages.find(m => m.isStreaming)?.id ?? null,
        })
        break
      }
      
      case 'session.list': {
        const payload = message.payload as SessionListPayload
        set({ sessions: payload.sessions })
        break
      }
      
      case 'session.deleted': {
        get().listSessions()
        break
      }
      
      case 'chat.message': {
        // Server created a new message (user message or assistant message before streaming)
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
      
      case 'chat.tool_call': {
        // Add tool call to the message with this messageId
        const payload = message.payload as ChatToolCallPayload
        set(state => ({
          messages: state.messages.map(m => 
            m.id === payload.messageId
              ? { 
                  ...m, 
                  toolCalls: [
                    ...(m.toolCalls ?? []),
                    { id: payload.callId, name: payload.tool, arguments: payload.args }
                  ]
                }
              : m
          ),
        }))
        break
      }
      
      case 'chat.tool_result': {
        // Tool results come as separate chat.message events (tool role messages)
        // This event is just for real-time display - can track in message's toolCalls
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
        const payload = message.payload as ChatTodoPayload
        set({ currentTodos: payload.todos })
        break
      }
      
      case 'chat.summary': {
        const payload = message.payload as ChatSummaryPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, summary: payload.summary }
            : null,
        }))
        break
      }
      
      case 'chat.progress': {
        // Progress messages are transient - could add to a separate state if needed
        // For now, just log
        const payload = message.payload as ChatProgressPayload
        console.log('Progress:', payload.message, payload.phase)
        break
      }
      
      case 'chat.format_retry': {
        // Format retry - could show in UI
        const payload = message.payload as ChatFormatRetryPayload
        console.log('Format retry:', payload.attempt, '/', payload.maxAttempts)
        break
      }
      
      case 'chat.done': {
        const payload = message.payload as ChatDonePayload
        
        // Mark the message as no longer streaming and add stats if present
        set(state => ({
          messages: state.messages.map(m => 
            m.id === payload.messageId
              ? { ...m, isStreaming: false, stats: payload.stats ?? m.stats }
              : m
          ),
          streamingMessageId: null,
          // Update session running state
          currentSession: state.currentSession
            ? { ...state.currentSession, isRunning: false }
            : null,
        }))
        
        if (payload.reason === 'complete') {
          playNotification()
        }
        break
      }
      
      case 'chat.error': {
        const payload = message.payload as ChatErrorPayload
        console.error('Chat error:', payload.error, 'recoverable:', payload.recoverable)
        if (!payload.recoverable) {
          set({ streamingMessageId: null })
        }
        break
      }
      
      case 'mode.changed': {
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
        const currentPhase = get().currentSession?.phase
        // Only play sounds if phase actually changed (not if already in that phase)
        const shouldPlayAchievement = payload.phase === 'done' && currentPhase !== 'done'
        const shouldPlayIntervention = payload.phase === 'blocked' && currentPhase !== 'blocked'
        
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, phase: payload.phase }
            : null,
          // Also update the sessions list for the sidebar
          sessions: state.sessions.map(s => 
            s.id === state.currentSession?.id 
              ? { ...s, phase: payload.phase }
              : s
          ),
        }))
        // Play achievement sound when phase becomes 'done' (only once)
        if (shouldPlayAchievement) {
          playAchievement()
        }
        // Play intervention sound when phase becomes 'blocked' (only once)
        if (shouldPlayIntervention) {
          playIntervention()
        }
        break
      }
      
      case 'criteria.updated': {
        const payload = message.payload as CriteriaUpdatedPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, criteria: payload.criteria }
            : null,
        }))
        break
      }
      
      case 'context.state': {
        const payload = message.payload as ContextStatePayload
        set({ contextState: payload.context })
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

// Helper selector: is any message currently streaming?
export function useIsStreaming() {
  return useSessionStore(state => state.streamingMessageId !== null)
}

// Helper selector: get the currently streaming message
export function useStreamingMessage() {
  const messages = useSessionStore(state => state.messages)
  const streamingMessageId = useSessionStore(state => state.streamingMessageId)
  return messages.find(m => m.id === streamingMessageId) ?? null
}
