import { create } from 'zustand'
import type {
  Session,
  SessionSummary,
  Criterion,
} from '@openfox/shared'
import type {
  ServerMessage,
  AgentEvent,
  PlanDeltaPayload,
  PlanCriteriaPayload,
  PlanToolCallPayload,
  PlanToolResultPayload,
  SessionStatePayload,
  SessionListPayload,
  AgentEventPayload,
  ValidationResultPayload,
} from '@openfox/shared/protocol'

interface PlanToolEvent {
  type: 'call' | 'result'
  tool: string
  args?: Record<string, unknown>
  result?: string
}

// Streaming events in order (text segments + tool events)
export type PlanStreamEvent = 
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string }
import { wsClient } from '../lib/ws'

interface SessionState {
  // Connection
  connected: boolean
  connecting: boolean
  
  // Sessions
  sessions: SessionSummary[]
  currentSession: Session | null
  
  // Streaming state
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  
  // Error state
  error: { code: string; message: string } | null
  
  // Planning tool calls (legacy, kept for compatibility)
  planToolEvents: PlanToolEvent[]
  
  // Ordered stream events (text + tools interlaced)
  planStreamEvents: PlanStreamEvent[]
  
  // Agent events
  agentEvents: AgentEvent[]
  
  // Actions
  connect: () => Promise<void>
  disconnect: () => void
  
  createSession: (projectId: string, title?: string) => void
  loadSession: (sessionId: string) => void
  listSessions: () => void
  deleteSession: (sessionId: string) => void
  clearSession: () => void
  stopExecution: () => void
  
  sendPlanMessage: (content: string) => void
  editCriteria: (criteria: Criterion[]) => void
  acceptCriteria: () => void
  
  startAgent: () => void
  pauseAgent: () => void
  intervene: (response: string) => void
  
  startValidation: () => void
  humanVerify: (criterionId: string, passed: boolean, reason?: string) => void
  
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
  planToolEvents: [],
  planStreamEvents: [],
  agentEvents: [],
  
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
    set({ agentEvents: [], planStreamEvents: [], streamingText: '', streamingThinking: '', isStreaming: false })
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
      agentEvents: [], 
      planToolEvents: [],
      streamingText: '',
      streamingThinking: '',
      isStreaming: false,
    })
  },
  
  stopExecution: () => {
    wsClient.send('agent.stop', {})
  },
  
  sendPlanMessage: (content) => {
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
      planToolEvents: [],
      planStreamEvents: [],
      currentSession: state.currentSession
        ? { ...state.currentSession, messages: [...state.currentSession.messages, userMessage] }
        : null,
    }))
    wsClient.send('plan.message', { content })
  },
  
  editCriteria: (criteria) => {
    wsClient.send('plan.edit_criteria', { criteria })
  },
  
  acceptCriteria: () => {
    wsClient.send('plan.accept', {})
  },
  
  startAgent: () => {
    set({ agentEvents: [] })
    wsClient.send('agent.start', {})
  },
  
  pauseAgent: () => {
    wsClient.send('agent.pause', {})
  },
  
  intervene: (response) => {
    wsClient.send('agent.intervene', { response })
  },
  
  startValidation: () => {
    wsClient.send('validate.start', {})
  },
  
  humanVerify: (criterionId, passed, reason) => {
    wsClient.send('criterion.human_verify', { criterionId, passed, reason })
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
      
      case 'plan.delta': {
        const payload = message.payload as PlanDeltaPayload
        if (payload.isThinking) {
          set(state => {
            const events = [...state.planStreamEvents]
            const last = events[events.length - 1]
            if (last?.type === 'thinking') {
              events[events.length - 1] = { ...last, content: last.content + payload.content }
            } else {
              events.push({ type: 'thinking', content: payload.content })
            }
            return { streamingThinking: state.streamingThinking + payload.content, planStreamEvents: events }
          })
        } else {
          set(state => {
            const events = [...state.planStreamEvents]
            const last = events[events.length - 1]
            if (last?.type === 'text') {
              events[events.length - 1] = { ...last, content: last.content + payload.content }
            } else {
              events.push({ type: 'text', content: payload.content })
            }
            return { streamingText: state.streamingText + payload.content, planStreamEvents: events }
          })
        }
        break
      }
      
      case 'plan.criteria': {
        const payload = message.payload as PlanCriteriaPayload
        set(state => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, criteria: payload.criteria }
            : null,
        }))
        break
      }
      
      case 'plan.tool_call': {
        const payload = message.payload as PlanToolCallPayload
        set(state => ({
          planToolEvents: [...state.planToolEvents, {
            type: 'call' as const,
            tool: payload.tool,
            args: payload.args,
          }],
          planStreamEvents: [...state.planStreamEvents, {
            type: 'tool_call' as const,
            tool: payload.tool,
            args: payload.args,
          }],
        }))
        break
      }
      
      case 'plan.tool_result': {
        const payload = message.payload as PlanToolResultPayload
        set(state => ({
          planToolEvents: [...state.planToolEvents, {
            type: 'result' as const,
            tool: payload.tool,
            result: payload.result,
          }],
          planStreamEvents: [...state.planStreamEvents, {
            type: 'tool_result' as const,
            tool: payload.tool,
            result: payload.result,
          }],
        }))
        break
      }
      
      case 'plan.done': {
        // Don't clear planStreamEvents - keep the beautiful interlaced view
        // Just mark streaming as done
        set({ isStreaming: false })
        break
      }
      
      case 'agent.event': {
        const payload = message.payload as AgentEventPayload
        set(state => ({
          agentEvents: [...state.agentEvents, payload.event],
        }))
        
        // Handle completion or abort
        if (payload.event.type === 'done' || payload.event.type === 'aborted') {
          const session = get().currentSession
          if (session) {
            get().loadSession(session.id)
          }
        }
        break
      }
      
      case 'validation.result': {
        const payload = message.payload as ValidationResultPayload
        console.log('Validation result:', payload.result)
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
    set({ streamingText: '', streamingThinking: '', isStreaming: false, planStreamEvents: [] })
  },
}))
