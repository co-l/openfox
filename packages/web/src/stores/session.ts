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
  ChatDonePayload,
  ChatErrorPayload,
  ModeChangedPayload,
  CriteriaUpdatedPayload,
} from '@openfox/shared/protocol'
import { wsClient } from '../lib/ws'

// Unified streaming events (all modes use the same structure)
export type ChatStreamEvent = 
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; tool: string; result: ToolResult }
  | { type: 'todo'; todos: Todo[] }
  | { type: 'summary'; summary: string }
  | { type: 'error'; error: string; recoverable: boolean }
  | { type: 'stats'; model: string; prefillSpeed: number; generationSpeed: number }

interface SessionState {
  // Connection
  connected: boolean
  connecting: boolean
  
  // Sessions
  sessions: SessionSummary[]
  currentSession: Session | null
  
  // Streaming state (unified for all modes)
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  chatStreamEvents: ChatStreamEvent[]
  
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
  connected: false,
  connecting: false,
  sessions: [],
  currentSession: null,
  error: null,
  streamingText: '',
  streamingThinking: '',
  isStreaming: false,
  chatStreamEvents: [],
  currentTodos: [],
  
  connect: async () => {
    if (get().connected || get().connecting) return
    
    set({ connecting: true })
    
    try {
      await wsClient.connect()
      
      wsClient.subscribe((message) => {
        get().handleServerMessage(message)
      })
      
      set({ connected: true, connecting: false })
      
      // Load session list on connect
      get().listSessions()
    } catch (error) {
      console.error('Failed to connect:', error)
      set({ connecting: false })
    }
  },
  
  disconnect: () => {
    wsClient.disconnect()
    set({ connected: false })
  },
  
  createSession: (projectId, title) => {
    wsClient.send('session.create', { projectId, title })
  },
  
  loadSession: (sessionId) => {
    const currentSession = get().currentSession
    // Only clear stream state if loading a different session
    if (!currentSession || currentSession.id !== sessionId) {
      set({ 
        chatStreamEvents: [], 
        streamingText: '', 
        streamingThinking: '', 
        isStreaming: false,
        currentTodos: [],
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
      chatStreamEvents: [],
      streamingText: '',
      streamingThinking: '',
      isStreaming: false,
      currentTodos: [],
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
      
      case 'chat.done': {
        const payload = message.payload as ChatDonePayload
        
        // Add stats event if present
        if (payload.stats) {
          set(state => ({
            chatStreamEvents: [...state.chatStreamEvents, {
              type: 'stats' as const,
              model: payload.stats!.model,
              prefillSpeed: payload.stats!.prefillSpeed,
              generationSpeed: payload.stats!.generationSpeed,
            }],
          }))
        }
        
        set({ isStreaming: false })
        
        // Reload session to get latest state
        if (payload.reason === 'complete') {
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
