import { create } from 'zustand'
import type {
  Session,
  SessionSummary,
  SessionMode,
  Criterion,
  Todo,
  ToolResult,
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
  ChatDonePayload,
  ChatErrorPayload,
  ModeChangedPayload,
  CriteriaUpdatedPayload,
} from '@openfox/shared/protocol'
import { wsClient, type ConnectionStatus } from '../lib/ws'
import { playNotification } from '../lib/sound'

// Track subscription to prevent duplicates
let isSubscribed = false

// Unified streaming events (all modes use the same structure)
export type ChatStreamEvent = 
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; tool: string; result: ToolResult }
  | { type: 'todo'; todos: Todo[] }
  | { type: 'summary'; summary: string }
  | { type: 'progress'; message: string; phase?: 'summary' | 'mode_switch' | 'starting' }
  | { type: 'format_retry'; attempt: number; maxAttempts: number }
  | { type: 'error'; error: string; recoverable: boolean }
  | { type: 'stats'; model: string; mode: SessionMode; totalTime: number; toolTime: number; prefillTokens: number; prefillSpeed: number; generationTokens: number; generationSpeed: number }

interface SessionState {
  // Connection
  connectionStatus: ConnectionStatus
  
  // Sessions
  sessions: SessionSummary[]
  currentSession: Session | null
  
  // Streaming state (unified for all modes)
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  chatStreamEvents: ChatStreamEvent[]
  
  // Event sequence tracking (for reconnection)
  lastEventSeq: number
  
  // Current todos (displayed in chat)
  currentTodos: Todo[]
  
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
  
  // Mode switching
  switchMode: (mode: SessionMode) => void
  acceptAndBuild: () => void  // Accept criteria, generate summary, switch to builder
  
  // Criteria (from UI)
  editCriteria: (criteria: Criterion[]) => void
  
  clearError: () => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
  clearStreamingState: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  connectionStatus: 'disconnected',
  sessions: [],
  currentSession: null,
  error: null,
  streamingText: '',
  streamingThinking: '',
  isStreaming: false,
  chatStreamEvents: [],
  lastEventSeq: 0,
  currentTodos: [],
  
  connect: async () => {
    const status = get().connectionStatus
    if (status === 'connected' || status === 'reconnecting') return
    
    // Prevent double connection attempts
    set({ connectionStatus: 'reconnecting' })
    
    // Register status callback before connecting
    wsClient.onStatusChange((newStatus) => {
      set({ connectionStatus: newStatus })
      // Reload session list when reconnected
      if (newStatus === 'connected') {
        get().listSessions()
      }
    })
    
    try {
      await wsClient.connect()
      
      // Subscribe once
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
    const lastEventSeq = get().lastEventSeq
    
    // Only clear stream state if loading a different session
    if (!currentSession || currentSession.id !== sessionId) {
      set({ 
        chatStreamEvents: [], 
        streamingText: '', 
        streamingThinking: '', 
        isStreaming: false,
        currentTodos: [],
        lastEventSeq: 0,
      })
      // New session, no events to resume from
      wsClient.send('session.load', { sessionId })
    } else {
      // Same session, try to resume from last known event
      wsClient.send('session.load', { sessionId, lastEventSeq })
    }
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
      chatStreamEvents: [],
      streamingText: '',
      streamingThinking: '',
      isStreaming: false,
      currentTodos: [],
      lastEventSeq: 0,
    })
  },
  
  sendMessage: (content) => {
    // Optimistically add user message so it appears immediately
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user' as const,
      content,
      timestamp: new Date().toISOString(),
      tokenCount: 0,
    }
    set(state => ({
      streamingText: '',
      streamingThinking: '',
      isStreaming: true,
      chatStreamEvents: [],
      currentSession: state.currentSession
        ? { ...state.currentSession, messages: [...state.currentSession.messages, userMessage] }
        : null,
    }))
    wsClient.send('chat.send', { content })
  },
  
  stopGeneration: () => {
    wsClient.send('chat.stop', {})
  },
  
  continueGeneration: () => {
    set({ isStreaming: true, chatStreamEvents: [] })
    wsClient.send('chat.continue', {})
  },
  
  switchMode: (mode) => {
    wsClient.send('mode.switch', { mode })
  },
  
  acceptAndBuild: () => {
    // This will:
    // 1. Generate summary from conversation
    // 2. Display summary in chat
    // 3. Switch to builder mode
    // 4. Auto-start builder
    set({ isStreaming: true, chatStreamEvents: [] })
    wsClient.send('mode.accept', {})
  },
  
  editCriteria: (criteria) => {
    wsClient.send('criteria.edit', { criteria })
  },
  
  clearError: () => {
    set({ error: null })
  },
  
  handleServerMessage: (message) => {
    // Track event sequence for reconnection
    const seq = (message as { seq?: number }).seq
    if (typeof seq === 'number') {
      set({ lastEventSeq: seq })
    }
    
    switch (message.type) {
      case 'session.state': {
        const payload = message.payload as SessionStatePayload
        set({ currentSession: payload.session })
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
      
      case 'chat.delta': {
        const payload = message.payload as ChatDeltaPayload
        set(state => {
          const events = [...state.chatStreamEvents]
          const last = events[events.length - 1]
          if (last?.type === 'text') {
            events[events.length - 1] = { ...last, content: last.content + payload.content }
          } else {
            events.push({ type: 'text', content: payload.content })
          }
          return { 
            streamingText: state.streamingText + payload.content, 
            chatStreamEvents: events,
          }
        })
        break
      }
      
      case 'chat.thinking': {
        const payload = message.payload as ChatThinkingPayload
        set(state => {
          const events = [...state.chatStreamEvents]
          const last = events[events.length - 1]
          if (last?.type === 'thinking') {
            events[events.length - 1] = { ...last, content: last.content + payload.content }
          } else {
            events.push({ type: 'thinking', content: payload.content })
          }
          return { 
            streamingThinking: state.streamingThinking + payload.content, 
            chatStreamEvents: events,
          }
        })
        break
      }
      
      case 'chat.tool_call': {
        const payload = message.payload as ChatToolCallPayload
        set(state => ({
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'tool_call' as const,
            callId: payload.callId,
            tool: payload.tool,
            args: payload.args,
          }],
        }))
        break
      }
      
      case 'chat.tool_result': {
        const payload = message.payload as ChatToolResultPayload
        set(state => ({
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'tool_result' as const,
            callId: payload.callId,
            tool: payload.tool,
            result: payload.result,
          }],
        }))
        break
      }
      
      case 'chat.todo': {
        const payload = message.payload as ChatTodoPayload
        set(state => ({
          currentTodos: payload.todos,
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'todo' as const,
            todos: payload.todos,
          }],
        }))
        break
      }
      
      case 'chat.summary': {
        const payload = message.payload as ChatSummaryPayload
        set(state => ({
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'summary' as const,
            summary: payload.summary,
          }],
          // Also update session summary
          currentSession: state.currentSession
            ? { ...state.currentSession, summary: payload.summary }
            : null,
        }))
        break
      }
      
      case 'chat.progress': {
        const payload = message.payload as ChatProgressPayload
        set(state => ({
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'progress' as const,
            message: payload.message,
            phase: payload.phase,
          }],
        }))
        break
      }
      
      case 'chat.format_retry': {
        const payload = message.payload as ChatFormatRetryPayload
        set(state => ({
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'format_retry' as const,
            attempt: payload.attempt,
            maxAttempts: payload.maxAttempts,
          }],
        }))
        break
      }
      
      case 'chat.done': {
        const payload = message.payload as ChatDonePayload
        
        // Add stats event if present
        if (payload.stats) {
          set(state => ({
            chatStreamEvents: [...state.chatStreamEvents, {
              type: 'stats' as const,
              model: payload.stats!.model,
              mode: payload.stats!.mode,
              totalTime: payload.stats!.totalTime,
              toolTime: payload.stats!.toolTime,
              prefillTokens: payload.stats!.prefillTokens,
              prefillSpeed: payload.stats!.prefillSpeed,
              generationTokens: payload.stats!.generationTokens,
              generationSpeed: payload.stats!.generationSpeed,
            }],
          }))
        }
        
        set({ isStreaming: false })
        
        // Reload session to get latest state (clears stream events since message is now saved)
        if (payload.reason === 'complete' || payload.reason === 'stopped') {
          if (payload.reason === 'complete') {
            playNotification()
          }
          set({ chatStreamEvents: [] })
          const session = get().currentSession
          if (session) {
            get().loadSession(session.id)
          }
        }
        break
      }
      
      case 'chat.error': {
        const payload = message.payload as ChatErrorPayload
        set(state => ({
          chatStreamEvents: [...state.chatStreamEvents, {
            type: 'error' as const,
            error: payload.error,
            recoverable: payload.recoverable,
          }],
        }))
        if (!payload.recoverable) {
          set({ isStreaming: false })
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
      
      case 'criteria.updated': {
        const payload = message.payload as CriteriaUpdatedPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, criteria: payload.criteria }
            : null,
        }))
        break
      }
      
      case 'error': {
        const payload = message.payload as { code: string; message: string }
        console.error('Server error:', payload)
        set({ error: { code: payload.code, message: payload.message } })
        get().clearStreamingState()
        break
      }
    }
  },
  
  clearStreamingState: () => {
    set({ 
      streamingText: '', 
      streamingThinking: '', 
      isStreaming: false, 
      chatStreamEvents: [],
    })
  },
}))
