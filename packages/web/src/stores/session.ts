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
  
  // Planning tool calls
  planToolEvents: PlanToolEvent[]
  
  // Agent events
  agentEvents: AgentEvent[]
  
  // Actions
  connect: () => Promise<void>
  disconnect: () => void
  
  createSession: (workdir: string, title?: string) => void
  loadSession: (sessionId: string) => void
  listSessions: () => void
  deleteSession: (sessionId: string) => void
  clearSession: () => void
  
  sendPlanMessage: (content: string) => void
  editCriteria: (criteria: Criterion[]) => void
  acceptCriteria: () => void
  
  startAgent: () => void
  pauseAgent: () => void
  intervene: (response: string) => void
  
  startValidation: () => void
  humanVerify: (criterionId: string, passed: boolean, reason?: string) => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
  clearStreamingState: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  connected: false,
  connecting: false,
  sessions: [],
  currentSession: null,
  streamingText: '',
  streamingThinking: '',
  isStreaming: false,
  planToolEvents: [],
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
  
  createSession: (workdir, title) => {
    wsClient.send('session.create', { workdir, title })
  },
  
  loadSession: (sessionId) => {
    set({ agentEvents: [] })
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
  
  sendPlanMessage: (content) => {
    set({ streamingText: '', streamingThinking: '', isStreaming: true, planToolEvents: [] })
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
          set(state => ({ streamingThinking: state.streamingThinking + payload.content }))
        } else {
          set(state => ({ streamingText: state.streamingText + payload.content }))
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
        }))
        break
      }
      
      case 'plan.done': {
        get().clearStreamingState()
        // Refresh session to get the new message
        const session = get().currentSession
        if (session) {
          get().loadSession(session.id)
        }
        break
      }
      
      case 'agent.event': {
        const payload = message.payload as AgentEventPayload
        set(state => ({
          agentEvents: [...state.agentEvents, payload.event],
        }))
        
        // Handle completion
        if (payload.event.type === 'done') {
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
        console.error('Server error:', message.payload)
        get().clearStreamingState()
        break
      }
    }
  },
  
  clearStreamingState: () => {
    set({ streamingText: '', streamingThinking: '', isStreaming: false })
  },
}))
