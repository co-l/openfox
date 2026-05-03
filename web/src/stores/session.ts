import { create } from 'zustand'
import { authFetch } from '../lib/api'
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
  ChatVisionFallbackPayload,
  ModeChangedPayload,
  PhaseChangedPayload,
  CriteriaUpdatedPayload,
  ContextStatePayload,
  QueuedMessage,
  QueueStatePayload,
} from '@shared/protocol.js'
import { wsClient, type ConnectionStatus } from '../lib/ws'
import { useDevServerStore } from './dev-server'
import { useConfigStore } from './config'
import { useProjectStore } from './project'
import { useBackgroundProcessesStore } from './background-processes'
import { playNotification, playAchievement, playIntervention, playWaitingForUser, playNewMessage } from '../lib/sound'
import type { AgentType } from './notifications'

// Track subscription to prevent duplicates
let isSubscribed = false
let wsUnsubscribe: (() => void) | null = null

// Track which messageIds have already triggered the new_message sound
const triggeredNewMessageSound = new Set<string>()

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

function isSessionStateForCurrentView(
  message: ServerMessage,
  currentSessionId: string | null,
  pendingSessionCreate: boolean | string,
): boolean {
  return (
    message.id !== undefined ||
    isMessageForCurrentSession(message, currentSessionId) ||
    (pendingSessionCreate === true && message.sessionId !== undefined)
  )
}

function addUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.includes(sessionId) ? unreadSessionIds : [...unreadSessionIds, sessionId]
}

function removeUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.filter((id) => id !== sessionId)
}

function mergeSessionIntoSummary(sessions: SessionSummary[], session: Session): SessionSummary[] {
  const existingSession = sessions.find((candidate) => candidate.id === session.id)
  const nextSummary: SessionSummary = existingSession
    ? {
        ...existingSession,
        projectId: session.projectId,
        workdir: session.workdir,
        mode: session.mode,
        phase: session.phase,
        isRunning: session.isRunning,
        messageCount: session.messages.length,
        criteriaCount: session.criteria.length,
        criteriaCompleted: session.criteria.filter((criterion) => criterion.status.type === 'passed').length,
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
        criteriaCompleted: session.criteria.filter((criterion) => criterion.status.type === 'passed').length,
        messageCount: session.messages.length,
      }

  return existingSession
    ? sessions.map((candidate) => (candidate.id === session.id ? nextSummary : candidate))
    : [nextSummary, ...sessions]
}

function mergeSessionList(
  incomingSessions: SessionSummary[],
  existingSessions: SessionSummary[],
  currentSession: Session | null,
): SessionSummary[] {
  return incomingSessions.map((incomingSession) => {
    const currentSessionOverride = currentSession?.id === incomingSession.id ? currentSession : null
    const existingSession = existingSessions.find((candidate) => candidate.id === incomingSession.id)

    return {
      ...incomingSession,
      title: incomingSession.title ?? existingSession?.title,
      mode: currentSessionOverride?.mode ?? existingSession?.mode ?? incomingSession.mode,
      phase: currentSessionOverride?.phase ?? existingSession?.phase ?? incomingSession.phase,
      isRunning: incomingSession.isRunning && existingSession?.isRunning !== false,
      messageCount: incomingSession.messageCount,
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
  reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command' | 'git_no_verify'
  alwaysAllow?: boolean // Set when user clicks "Always Allow"
}

// Pending ask_user question from server
export interface PendingQuestion {
  callId: string
  question: string
}

interface SessionState {
  // Connection
  connectionStatus: ConnectionStatus
  showPasswordModal: boolean
  passwordModalRetry: boolean

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

  // Per-subagent context states (keyed by subAgentInstanceId)
  subAgentContextStates: Record<string, ContextState>

  // Pending path confirmation (outside-workdir access request)
  pendingPathConfirmation: PendingPathConfirmation | null

  // Pending ask_user question
  pendingQuestion: PendingQuestion | null

  // Vision fallback state per message (for inline display in feed)
  visionFallbackByMessage: Record<
    string,
    { type: 'start' | 'done'; attachmentId: string; filename?: string; description?: string }
  >

  // Message queue (while agent is running)
  queuedMessages: QueuedMessage[]
  abortInProgress: boolean

  // Error state
  error: { code: string; message: string } | null

  // Sessions pagination
  sessionsHasMore: boolean
  sessionsPaginationLoading: boolean

  // Track new session creation: true while waiting for server, session ID once created (for navigation)
  pendingSessionCreate: boolean | string

  // Actions
  connect: () => Promise<void>
  reconnect: () => void
  disconnect: () => void
  submitPassword: (password: string) => Promise<void>
  cancelPassword: () => void

  // Session management
  createSession: (projectId: string, title?: string) => Promise<Session | null>
  loadSession: (sessionId: string) => Promise<void>
  listSessions: (projectId?: string, limit?: number) => Promise<void>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  deleteAllSessions: (projectId: string) => Promise<boolean>
  loadMoreSessions: (projectId: string) => Promise<void>
  clearSession: () => void

  // Unified chat (works in any mode)
  sendMessage: (
    content: string,
    attachments?: Attachment[],
    opts?: { messageKind?: 'command'; isSystemGenerated?: boolean },
  ) => void
  stopGeneration: () => void
  continueGeneration: () => void

  // Runner (auto-loop)
  launchRunner: (content?: string, attachments?: Attachment[], workflowId?: string) => void

  // Mode switching
  switchMode: (mode: SessionMode) => void
  switchDangerLevel: (dangerLevel: 'normal' | 'dangerous') => void
  acceptAndBuild: (workflowId?: string, content?: string, attachments?: Attachment[]) => void

  // Criteria (from UI)
  editCriteria: (criteria: Criterion[]) => void

  // Context management
  compactContext: () => void

  // Per-session provider/model
  setSessionProvider: (providerId: string, model?: string) => Promise<Session | null>

  // Update context state (from REST API responses)
  updateContextState: (contextState: ContextState) => void

  // Update subagent context state (from WS events with subAgentId)
  updateSubAgentContextState: (subAgentId: string, context: ContextState) => void

  // Clear subagent context state when subagent completes
  clearSubAgentContextState: (subAgentId: string) => void

  // Path confirmation
  confirmPath: (callId: string, approved: boolean, alwaysAllow?: boolean) => void

  // Ask user question
  answerQuestion: (callId: string, answer: string) => void

  // Message queue
  queueAsap: (content: string, attachments?: Attachment[], messageKind?: string) => void
  queueCompletion: (content: string, attachments?: Attachment[], messageKind?: string) => void
  cancelQueued: (queueId: string) => void

  clearError: () => void

  // Reset pending session create state (called after navigation)
  resetPendingSessionCreate: () => void

  // Internal
  handleServerMessage: (message: ServerMessage) => void
}

// Track last phase seen per session via phase.changed events only.
// This avoids races where session.state (direct WS) updates currentSession.phase
// to 'done' before the EventStore phase.changed event arrives.
const lastSeenPhase = new Map<string, string>()

function resolveAgentType(state: SessionState, sessionId?: string): AgentType | undefined {
  const session = sessionId === state.currentSession?.id ? state.currentSession : null
  const summary = state.sessions.find((s) => s.id === sessionId)
  const mode = session?.mode ?? summary?.mode
  if (mode === 'planner') return 'planner'
  if (mode === 'builder') return 'build'
  return 'planner' // default sound profile for custom agents
}

function handleGlobalSoundEffects(message: ServerMessage, state: SessionState): void {
  if (message.type === 'chat.done') {
    const payload = message.payload as ChatDonePayload
    const resolvedAgent = resolveAgentType(state, message.sessionId)
    const agent = payload.agentType ?? resolvedAgent
    if (payload.reason === 'complete') {
      playNotification(agent)
    }
    if (payload.reason === 'waiting_for_user') {
      playWaitingForUser(agent)
    }
    return
  }

  // Path confirmation requires user input - play waiting sound
  if (message.type === 'chat.path_confirmation') {
    const agent = resolveAgentType(state, message.sessionId)
    playWaitingForUser(agent)
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
    set((state) => {
      const sm = state.streamingMessage
      if (sm && sm.id === buf.messageId) {
        let updated = { ...sm }
        if (hasDelta) {
          updated.content = updated.content + delta
        }
        if (hasThinking) {
          updated.thinkingContent = (updated.thinkingContent ?? '') + thinking
        }
        if (hasToolOutput) {
          const matchedCallIds = new Set<string>()
          updated.toolCalls = updated.toolCalls?.map((tc) => {
            const outputs = toolOutputs.filter((o) => o.callId === tc.id)
            if (outputs.length === 0) return tc
            matchedCallIds.add(tc.id)
            return {
              ...tc,
              streamingOutput: [
                ...(tc.streamingOutput ?? []),
                ...outputs.map((o) => ({ stream: o.stream, content: o.content, timestamp: Date.now() })),
              ],
            }
          })
          // Re-buffer unmatched outputs (e.g. return_value outputs arriving before tool.call)
          const unmatched = toolOutputs.filter((o) => !matchedCallIds.has(o.callId))
          if (unmatched.length > 0) {
            streamingBuffer.toolOutput.push(...unmatched)
          }
        }
        return { streamingMessage: updated }
      }

      // streamingMessage was already folded back (message.done arrived) but tool
      // output is still coming in from running tools. Apply directly to messages[].
      if (hasToolOutput) {
        const matchedCallIds = new Set<string>()
        const updatedMessages = state.messages.map((m) => {
          if (m.id !== buf.messageId) return m
          const updatedToolCalls = m.toolCalls?.map((tc) => {
            const outputs = toolOutputs.filter((o) => o.callId === tc.id)
            if (outputs.length === 0) return tc
            matchedCallIds.add(tc.id)
            return {
              ...tc,
              streamingOutput: [
                ...(tc.streamingOutput ?? []),
                ...outputs.map((o) => ({ stream: o.stream, content: o.content, timestamp: Date.now() })),
              ],
            }
          })
          return { ...m, toolCalls: updatedToolCalls }
        })
        const unmatched = toolOutputs.filter((o) => !matchedCallIds.has(o.callId))
        if (unmatched.length > 0) {
          streamingBuffer.toolOutput.push(...unmatched)
        }
        return { messages: updatedMessages }
      }

      return state
    })
  }

  return {
    connectionStatus: 'disconnected',
    showPasswordModal: false,
    passwordModalRetry: false,
    sessions: [],
    currentSession: null,
    unreadSessionIds: [],
    messages: [],
    streamingMessageId: null,
    streamingMessage: null,
    currentTodos: [],
    contextState: null,
    subAgentContextStates: {},
    pendingPathConfirmation: null,
    pendingQuestion: null,
    visionFallbackByMessage: {},
    queuedMessages: [],
    abortInProgress: false,
    error: null,
    sessionsHasMore: true,
    sessionsPaginationLoading: false,
    pendingSessionCreate: false as boolean | string,

    connect: async () => {
      const status = get().connectionStatus
      if (status === 'connected') return

      set({ connectionStatus: 'reconnecting' })

      let needsAuth = false
      try {
        const authRes = await authFetch('/api/auth')
        const auth = await authRes.json()
        needsAuth = auth.requiresAuth
      } catch {
        // If /api/auth fails, continue without auth
      }

      if (needsAuth && !wsClient.hasToken()) {
        set({ showPasswordModal: true, passwordModalRetry: false, connectionStatus: 'reconnecting' })
        return
      }

      wsClient.onStatusChange((newStatus) => {
        set({ connectionStatus: newStatus })
        if (newStatus === 'connected') {
          get().listSessions(undefined)
          useProjectStore.getState().listProjects()
          const currentSessionId = get().currentSession?.id
          if (currentSessionId) {
            get().loadSession(currentSessionId)
          }
        }
      })

      try {
        await wsClient.connect()

        if (!isSubscribed) {
          isSubscribed = true
          const handler = get().handleServerMessage
          wsUnsubscribe = wsClient.subscribe(handler)
        }
      } catch (error) {
        console.error('Failed to connect:', error)
        const closeCode = wsClient.getLastCloseCode()

        // Only show password modal if we don't have a token AND auth failed
        // If we have a token, just show disconnected - the token is still valid
        if (!wsClient.hasToken() && (closeCode === 1006 || closeCode === 4000)) {
          set({ showPasswordModal: true, passwordModalRetry: true, connectionStatus: 'reconnecting' })
          return
        }
        // Clean up on connection failure to allow clean reconnection
        if (wsUnsubscribe) {
          wsUnsubscribe()
          wsUnsubscribe = null
        }
        isSubscribed = false
        set({ connectionStatus: 'disconnected' })
      }
    },

    reconnect: () => {
      wsClient.disconnect()
      if (wsUnsubscribe) {
        wsUnsubscribe()
        wsUnsubscribe = null
      }
      isSubscribed = false
      set({ connectionStatus: 'disconnected' })
      get().connect()
    },

    disconnect: () => {
      wsClient.disconnect()
      if (wsUnsubscribe) {
        wsUnsubscribe()
        wsUnsubscribe = null
      }
      isSubscribed = false
      set({ connectionStatus: 'disconnected', showPasswordModal: false })
    },

    submitPassword: async (password: string) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        if (!res.ok) {
          set({ showPasswordModal: true, passwordModalRetry: true, connectionStatus: 'reconnecting' })
          return
        }
        const { token } = await res.json()
        wsClient.setToken(token)
        set({ showPasswordModal: false })
        get().connect()

        const { listProjects } = useProjectStore.getState()
        const { fetchConfig } = useConfigStore.getState()
        listProjects()
        fetchConfig()

        get().connect()
      } catch {
        set({ showPasswordModal: true, passwordModalRetry: true, connectionStatus: 'reconnecting' })
      }
    },

    cancelPassword: () => {
      wsClient.clearToken()
      set({ showPasswordModal: false, connectionStatus: 'disconnected' })
    },

    createSession: async (projectId, title) => {
      const state = get()
      if (state.pendingSessionCreate) {
        return null
      }
      try {
        // Set pending flag BEFORE the API call to trigger navigation
        set({ pendingSessionCreate: true })

        const res = await authFetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, title }),
        })
        if (!res.ok) {
          set({ pendingSessionCreate: false })
          return null
        }
        const data = await res.json()
        // Tell WS server which session is active (required for chat.send routing)
        wsClient.send('session.load', { sessionId: data.session.id })
        // DO NOT refresh session list here - wait for WS session.state to arrive
        // await get().listSessions()
        return data.session
      } catch {
        set({ pendingSessionCreate: false })
        return null
      }
    },

    loadSession: async (sessionId) => {
      try {
        const currentSession = get().currentSession

        // Clear state when loading a different session
        if (!currentSession || currentSession.id !== sessionId) {
          cancelStreamingFlush()
          set({
            currentSession: null,
            unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, sessionId),
            subAgentContextStates: {},
            messages: [],
            streamingMessageId: null,
            streamingMessage: null,
            currentTodos: [],
            contextState: null,
            pendingPathConfirmation: null,
            queuedMessages: [],
            abortInProgress: false,
            error: null,
            pendingSessionCreate: false as boolean | string,
          })
        } else {
          set({ unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, sessionId) })
        }

        const res = await authFetch(`/api/sessions/${sessionId}`)
        if (!res.ok) return

        const data = await res.json()
        set({
          currentSession: data.session,
          messages: data.messages ?? [],
          contextState: data.contextState,
          queuedMessages: data.queueState ?? [],
        })

        // Tell WS server which session is active (required for chat.send routing)
        wsClient.send('session.load', { sessionId })

        // Fetch background processes for this session
        try {
          const bpRes = await authFetch(`/api/sessions/${sessionId}/background-processes`)
          if (bpRes.ok) {
            const bpData = await bpRes.json()
            useBackgroundProcessesStore.getState().setProcesses(bpData.processes ?? [])
          }
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    },

    listSessions: async (projectId?: string, limit = 20) => {
      try {
        const params = new URLSearchParams()
        params.set('limit', String(limit))
        if (projectId) {
          params.set('projectId', projectId)
        }
        const res = await authFetch(`/api/sessions?${params.toString()}`)
        const data = await res.json()
        const incoming = (data.sessions ?? []) as SessionSummary[]
        set((state) => ({
          sessions: mergeSessionList(incoming, state.sessions, state.currentSession),
          sessionsHasMore: projectId ? (data.hasMore ?? false) : true,
        }))
      } catch {
        // ignore
      }
    },

    loadMoreSessions: async (projectId) => {
      const state = get()
      if (state.sessionsPaginationLoading || !state.sessionsHasMore) return

      set({ sessionsPaginationLoading: true })
      try {
        const params = new URLSearchParams()
        params.set('limit', '20')
        params.set('offset', String(state.sessions.length))
        params.set('projectId', projectId)
        const res = await authFetch(`/api/sessions?${params.toString()}`)
        const data = await res.json()
        const moreSessions = (data.sessions ?? []) as SessionSummary[]
        set((state) => ({
          sessions: [
            ...state.sessions,
            ...moreSessions.map((s) => {
              const existing = state.sessions.find((e) => e.id === s.id)
              return existing?.isRunning === false ? { ...s, isRunning: false } : s
            }),
          ],
          sessionsHasMore: data.hasMore ?? false,
          sessionsPaginationLoading: false,
        }))
      } catch {
        set({ sessionsPaginationLoading: false })
      }
    },

    deleteSession: async (sessionId) => {
      try {
        const res = await authFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
        if (!res.ok) return false
        // Refresh session list
        await get().listSessions()
        // Clear current session if it was deleted
        if (get().currentSession?.id === sessionId) {
          get().clearSession()
        }
        return true
      } catch {
        return false
      }
    },

    renameSession: async (sessionId: string, title: string) => {
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/title`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        if (!res.ok) return false
        // Refresh session list to pick up new title
        await get().listSessions()
        // Update current session title if it's the one being renamed
        const currentSessionId = get().currentSession?.id
        if (currentSessionId === sessionId) {
          const data = await res.json()
          if (data.session) {
            set({ currentSession: data.session })
          }
        }
        return true
      } catch {
        return false
      }
    },

    deleteAllSessions: async (projectId) => {
      try {
        const res = await authFetch(`/api/projects/${projectId}/sessions`, { method: 'DELETE' })
        if (!res.ok) return false
        // Refresh session list
        await get().listSessions()
        return true
      } catch {
        return false
      }
    },

    clearSession: () => {
      cancelStreamingFlush()
      set((state) => ({
        currentSession: null,
        messages: [],
        streamingMessageId: null,
        streamingMessage: null,
        currentTodos: [],
        contextState: null,
        pendingSessionCreate: false as boolean | string,
        unreadSessionIds: state.currentSession
          ? removeUnreadSessionId(state.unreadSessionIds, state.currentSession.id)
          : state.unreadSessionIds,
      }))
    },

    sendMessage: async (content, attachments, opts) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      set({ streamingMessageId: null })

      // Use unified /message endpoint - always queues, processes at turn boundaries
      // This works whether agent is running (queues) or idle (processes immediately)
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, attachments, messageKind: opts?.messageKind }),
        })
        const data = await res.json()
        if (data.queueState) {
          set({ queuedMessages: data.queueState })
        }
      } catch (error) {
        console.error('Error sending message:', error)
      }
    },

    stopGeneration: async () => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return
      if (get().abortInProgress) return
      // Flush any buffered streaming content before stopping
      cancelStreamingFlush()
      flushStreamingBuffer?.()
      set({ abortInProgress: true })

      try {
        await authFetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' })
      } catch (error) {
        console.error('Error stopping generation:', error)
      }
    },

    continueGeneration: async () => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return
      set({ streamingMessageId: null })

      try {
        await authFetch(`/api/sessions/${sessionId}/continue`, { method: 'POST' })
      } catch (error) {
        console.error('Error continuing generation:', error)
      }
    },

    launchRunner: (content?: string, attachments?: Attachment[], workflowId?: string) => {
      set({ streamingMessageId: null })
      const payload: Record<string, unknown> = {}
      if (content?.trim()) payload.content = content
      if (attachments && attachments.length > 0) payload.attachments = attachments
      if (workflowId) payload.workflowId = workflowId
      wsClient.send('runner.launch', payload)
    },

    switchMode: async (mode) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/mode`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        })
        if (!res.ok) {
          console.error('Failed to switch mode:', await res.json())
          return
        }
        const data = await res.json()
        // Update session with new mode
        if (data.session) {
          set({ currentSession: data.session })
        }
      } catch (error) {
        console.error('Error switching mode:', error)
      }
    },

    switchDangerLevel: async (dangerLevel: 'normal' | 'dangerous') => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/danger-level`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dangerLevel }),
        })
        if (!res.ok) {
          console.error('Failed to switch danger level:', await res.json())
          return
        }
        const data = await res.json()
        if (data.session) {
          set({ currentSession: data.session })
        }
      } catch (error) {
        console.error('Error switching danger level:', error)
      }
    },

    acceptAndBuild: (workflowId?: string, content?: string, attachments?: Attachment[]) => {
      set({ streamingMessageId: null })
      const payload: Record<string, unknown> = {}
      if (workflowId) payload.workflowId = workflowId
      if (content?.trim()) payload.content = content
      if (attachments && attachments.length > 0) payload.attachments = attachments

      // Switch to builder mode first, then launch runner
      const sessionId = get().currentSession?.id
      if (sessionId) {
        authFetch(`/api/sessions/${sessionId}/mode`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'builder' }),
        }).then(() => {
          wsClient.send('runner.launch', payload)
        })
      }
    },

    editCriteria: async (criteria) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/criteria`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ criteria }),
        })
        if (!res.ok) {
          console.error('Failed to update criteria:', await res.json())
        }
      } catch (error) {
        console.error('Error updating criteria:', error)
      }
    },

    compactContext: () => {
      wsClient.send('context.compact', {})
    },

    setSessionProvider: async (providerId, model) => {
      try {
        const sessionId = get().currentSession?.id
        if (!sessionId) return null

        const res = await authFetch(`/api/sessions/${sessionId}/provider`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId, ...(model ? { model } : {}) }),
        })
        if (!res.ok) return null
        const data = await res.json()
        // Update current session
        set({
          currentSession: data.session,
          messages: data.messages ?? [],
          contextState: data.contextState,
        })
        return data.session
      } catch {
        return null
      }
    },

    updateContextState: (contextState) => {
      set({ contextState })
    },

    updateSubAgentContextState: (subAgentId, context) => {
      set((state) => ({
        subAgentContextStates: {
          ...state.subAgentContextStates,
          [subAgentId]: context,
        },
      }))
    },

    clearSubAgentContextState: (subAgentId) => {
      set((state) => {
        const newStates = { ...state.subAgentContextStates }
        delete newStates[subAgentId]
        return { subAgentContextStates: newStates }
      })
    },

    confirmPath: async (callId, approved, alwaysAllow = false) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        await authFetch(`/api/sessions/${sessionId}/confirm-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, approved, alwaysAllow }),
        })
        // Don't clear here - server will send updated session state with pendingConfirmations
      } catch (error) {
        console.error('Error confirming path:', error)
      }
    },

    answerQuestion: async (callId: string, answer: string) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        await authFetch(`/api/sessions/${sessionId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, answer }),
        })
      } catch (error) {
        console.error('Error answering question:', error)
      }
      set({ pendingQuestion: null })
    },

    queueAsap: async (content, attachments, messageKind?: string) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, attachments, messageKind }),
        })
        const data = await res.json()
        if (data.queueState) {
          set({ queuedMessages: data.queueState })
        }
      } catch (error) {
        console.error('Error queueing ASAP message:', error)
      }
    },

    queueCompletion: async (content, attachments, messageKind?: string) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      // Completion mode now uses same ASAP queue (processed at end of turn)
      // In future could differentiate, but for now unify
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, attachments, messageKind }),
        })
        const data = await res.json()
        if (data.queueState) {
          set({ queuedMessages: data.queueState })
        }
      } catch (error) {
        console.error('Error queueing completion message:', error)
      }
    },

    cancelQueued: async (queueId) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/queue/${queueId}`, {
          method: 'DELETE',
        })
        const data = await res.json()
        if (data.queueState) {
          set({ queuedMessages: data.queueState })
        }
      } catch (error) {
        console.error('Error canceling queued message:', error)
      }
    },

    clearError: () => {
      set({ error: null })
    },

    resetPendingSessionCreate: () => {
      set({ pendingSessionCreate: false as boolean | string })
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
        set((state) => ({ unreadSessionIds: addUnreadSessionId(state.unreadSessionIds, eventSessionId) }))
      }

      switch (message.type) {
        case 'session.state': {
          const payload = message.payload as SessionStatePayload
          if (!isSessionStateForCurrentView(message, activeSessionId, stateSnapshot.pendingSessionCreate)) {
            break
          }
          // Server sends complete state: session + messages + pendingConfirmations
          // This is the source of truth on load/reconnect
          cancelStreamingFlush()
          const streamingMsg = payload.messages.find((m) => m.isStreaming) ?? null
          const wasPendingCreate = get().pendingSessionCreate === true

          // Restore pending confirmations from server state (persists across reload)
          // Merge with any existing real-time confirmations (if user already responded on this client)
          const serverConfirmations = payload.pendingConfirmations ?? []
          const currentConfirmation = stateSnapshot.pendingPathConfirmation

          // Only keep server confirmation if we don't have one locally (user already responded)
          const pendingPathConfirmation =
            currentConfirmation ?? (serverConfirmations.length > 0 ? (serverConfirmations[0] ?? null) : null)

          set({
            currentSession: payload.session,
            sessions: mergeSessionIntoSummary(get().sessions, payload.session),
            unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, payload.session.id),
            messages: payload.messages,
            streamingMessageId: streamingMsg?.id ?? null,
            streamingMessage: streamingMsg,
            currentTodos: [],
            pendingPathConfirmation,
            error: null,
            // When this is the response to a session.create, store the new session ID for navigation
            ...(wasPendingCreate ? { pendingSessionCreate: payload.session.id } : {}),
          })

          // Sync config store with session's provider/model for header display
          if (payload.session.providerId && payload.session.providerModel) {
            const configStore = useConfigStore.getState()
            const sessionProvider = configStore.providers.find((p) => p.id === payload.session.providerId)
            if (sessionProvider) {
              configStore.syncFromSession(payload.session.providerId, payload.session.providerModel)
            }
          }
          break
        }

        case 'session.list': {
          const payload = message.payload as SessionListPayload
          set((state) => ({
            sessions: mergeSessionList(payload.sessions, state.sessions, state.currentSession),
          }))
          break
        }

        case 'session.deleted': {
          const payload = message.payload as { sessionId: string }
          set((state) => ({ unreadSessionIds: removeUnreadSessionId(state.unreadSessionIds, payload.sessionId) }))
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
          set((state) => ({
            sessions: state.sessions.map((s) => (s.id === eventSessionId ? { ...s, isRunning: payload.isRunning } : s)),
          }))

          // Only update currentSession if this is the active session
          if (!isBackgroundSession) {
            set((state) => ({
              currentSession: state.currentSession ? { ...state.currentSession, isRunning: payload.isRunning } : null,
              // Don't clear pendingPathConfirmation on stop - wait for user response
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

          set((state) => {
            // Don't add duplicates
            if (state.messages.some((m) => m.id === payload.message.id)) {
              return state
            }
            return {
              messages: [...state.messages, payload.message],
              // Track streaming message if it's marked as streaming
              streamingMessageId: payload.message.isStreaming ? payload.message.id : state.streamingMessageId,
              // Initialize separate streaming message for independent updates
              streamingMessage: payload.message.isStreaming ? payload.message : state.streamingMessage,
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
            payload.updates.isStreaming === false && get().streamingMessageId === payload.messageId

          // If streaming is ending, flush buffer and fold streamingMessage back
          if (isEndingStreaming) {
            cancelStreamingFlush()
            flushStreamingBuffer?.()
          }

          set((state) => {
            const sm = state.streamingMessage
            const stoppedStreaming = isEndingStreaming

            // If we have a streamingMessage for this ID, fold it back with updates
            if (sm && sm.id === payload.messageId) {
              const finalMessage = { ...sm, ...payload.updates }
              return {
                messages: state.messages.map((m) => (m.id === payload.messageId ? finalMessage : m)),
                streamingMessageId: stoppedStreaming ? null : state.streamingMessageId,
                streamingMessage: stoppedStreaming ? null : { ...sm, ...payload.updates },
              }
            }

            return {
              messages: state.messages.map((m) => (m.id === payload.messageId ? { ...m, ...payload.updates } : m)),
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
          // Play new_message sound on first delta for this messageId
          if (!triggeredNewMessageSound.has(payload.messageId)) {
            triggeredNewMessageSound.add(payload.messageId)
            const agent = resolveAgentType(get(), message.sessionId)
            playNewMessage(agent)
          }
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
          // Note: new_message sound only triggers on chat.delta (agent messages), not thinking blocks
          streamingBuffer.messageId = payload.messageId
          streamingBuffer.thinkingContent += payload.content
          scheduleStreamingFlush()
          break
        }

        case 'chat.tool_preparing': {
          // Add or update preparing tool call indicator (temporary, replaced when full tool call arrives)
          if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
            markBackgroundSessionUnread()
            break
          }
          const payload = message.payload as ChatToolPreparingPayload
          set((state) => {
            const sm = state.streamingMessage
            if (sm && sm.id === payload.messageId) {
              const existing = sm.preparingToolCalls ?? []
              const existingIndex = existing.findIndex((p) => p.index === payload.index)
              let preparingToolCalls: typeof existing
              if (existingIndex >= 0) {
                // Update existing entry with new partial arguments
                preparingToolCalls = existing.map((p, i) =>
                  i === existingIndex ? { ...p, arguments: payload.arguments } : p
                )
              } else {
                preparingToolCalls = [...existing, { index: payload.index, name: payload.name, ...(payload.arguments ? { arguments: payload.arguments } : {}) }]
              }
              return {
                streamingMessage: {
                  ...sm,
                  preparingToolCalls,
                },
              }
            }
            // Fallback: update in messages array if no streaming message
            return {
              messages: state.messages.map((m) =>
                m.id === payload.messageId
                  ? {
                      ...m,
                      preparingToolCalls: (() => {
                        const existing = m.preparingToolCalls ?? []
                        const existingIndex = existing.findIndex((p) => p.index === payload.index)
                        if (existingIndex >= 0) {
                          return existing.map((p, i) =>
                            i === existingIndex ? { ...p, arguments: payload.arguments } : p
                          )
                        }
                        return [
                          ...existing,
                          { index: payload.index, name: payload.name, ...(payload.arguments ? { arguments: payload.arguments } : {}) },
                        ]
                      })(),
                    }
                  : m,
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
                const hasEarlierMatch = m.preparingToolCalls?.slice(0, idx).some((p) => p.name === payload.tool)
                return hasEarlierMatch
              }
              return true
            })
            // Drain any buffered streaming outputs for this tool call (e.g. return_value content)
            const bufferedOutputs = streamingBuffer.toolOutput.filter((o) => o.callId === payload.callId)
            if (bufferedOutputs.length > 0) {
              streamingBuffer.toolOutput = streamingBuffer.toolOutput.filter((o) => o.callId !== payload.callId)
            }
            return {
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []),
                {
                  id: payload.callId,
                  name: payload.tool,
                  arguments: payload.args,
                  startedAt: Date.now(),
                  ...(bufferedOutputs.length > 0
                    ? {
                        streamingOutput: bufferedOutputs.map((o) => ({
                          stream: o.stream,
                          content: o.content,
                          timestamp: Date.now(),
                        })),
                      }
                    : {}),
                },
              ],
              ...(preparingToolCalls && preparingToolCalls.length > 0
                ? { preparingToolCalls }
                : { preparingToolCalls: undefined }),
            }
          }

          set((state) => {
            const sm = state.streamingMessage
            if (sm && sm.id === payload.messageId) {
              return { streamingMessage: applyToolCall(sm) }
            }
            return {
              messages: state.messages.map((m) => (m.id === payload.messageId ? applyToolCall(m) : m)),
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
            const toolCalls = m.toolCalls?.map((tc) =>
              tc.id === payload.callId ? { ...tc, result: payload.result } : tc,
            )
            return { ...m, toolCalls }
          }

          set((state) => {
            const sm = state.streamingMessage
            if (sm && sm.id === payload.messageId) {
              return { streamingMessage: applyToolResult(sm) }
            }
            return {
              messages: state.messages.map((m) => (m.id === payload.messageId ? applyToolResult(m) : m)),
            }
          })
          break
        }

        case 'chat.vision_fallback': {
          if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
            markBackgroundSessionUnread()
            break
          }
          const payload = message.payload as ChatVisionFallbackPayload
          set((state) => {
            const key = `${payload.messageId}-${payload.attachmentId}`
            const newByMessage = { ...state.visionFallbackByMessage }
            newByMessage[key] = {
              type: payload.type,
              attachmentId: payload.attachmentId,
              filename: payload.filename,
              description: payload.description,
            }
            return { visionFallbackByMessage: newByMessage }
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
          set((state) => ({
            currentSession: state.currentSession ? { ...state.currentSession, summary: payload.summary } : null,
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

          // Reset streaming buffer and clear the new_message sound trigger for this messageId
          streamingBuffer.messageId = null
          streamingBuffer.deltaContent = ''
          streamingBuffer.thinkingContent = ''
          streamingBuffer.toolOutput = []
          triggeredNewMessageSound.delete(payload.messageId)

          // Fold streamingMessage back into messages[] and mark as done
          set((state) => {
            const sm = state.streamingMessage
            const finalMessage =
              sm && sm.id === payload.messageId ? { ...sm, isStreaming: false, stats: messageStats ?? sm.stats } : null

            return {
              messages: state.messages.map((m) =>
                m.id === payload.messageId
                  ? (finalMessage ?? { ...m, isStreaming: false, stats: messageStats ?? m.stats })
                  : m,
              ),
              streamingMessageId: null,
              streamingMessage: null,
              visionFallbackByMessage: {},
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
          set((state) => ({
            error: { code: 'CHAT_ERROR', message: payload.error },
            streamingMessageId: payload.recoverable ? state.streamingMessageId : null,
            // Fold streamingMessage back into messages on non-recoverable error
            ...(payload.recoverable
              ? {}
              : {
                  messages: state.streamingMessage
                    ? state.messages.map((m) => (m.id === state.streamingMessage!.id ? state.streamingMessage! : m))
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

        case 'chat.ask_user': {
          if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
            markBackgroundSessionUnread()
            return
          }
          const payload = message.payload as { callId: string; question: string }
          set({
            pendingQuestion: {
              callId: payload.callId,
              question: payload.question,
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
          set((state) => ({
            currentSession: state.currentSession ? { ...state.currentSession, mode: payload.mode } : null,
          }))
          break
        }

        case 'phase.changed': {
          const payload = message.payload as PhaseChangedPayload
          const eventSessionId = message.sessionId
          const activeSessionId = get().currentSession?.id
          const isBackgroundSession = eventSessionId && eventSessionId !== activeSessionId

          // Always update sidebar status for the session
          set((state) => ({
            sessions: state.sessions.map((s) => (s.id === eventSessionId ? { ...s, phase: payload.phase } : s)),
          }))

          if (!isBackgroundSession) {
            set((state) => ({
              currentSession: state.currentSession ? { ...state.currentSession, phase: payload.phase } : null,
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
          set((state) => ({
            currentSession: state.currentSession ? { ...state.currentSession, criteria: payload.criteria } : null,
          }))
          break
        }

        case 'context.state': {
          const payload = message.payload as ContextStatePayload
          const isCurrentSession = isMessageForCurrentSession(message, get().currentSession?.id ?? null)

          if (payload.subAgentId) {
            if (isCurrentSession) {
              get().updateSubAgentContextState(payload.subAgentId, payload.context)
            }
          } else {
            if (isCurrentSession) {
              set({ contextState: payload.context })
            } else {
              markBackgroundSessionUnread()
            }
          }
          break
        }

        case 'session.name_generated': {
          // Session name was generated - update both currentSession and sessions list
          const payload = message.payload as { name: string }
          const eventSessionId = message.sessionId
          const activeSessionId = get().currentSession?.id

          set((state) => {
            const updatedSessions = state.sessions.map((s) =>
              s.id === eventSessionId ? { ...s, title: payload.name, updatedAt: new Date().toISOString() } : s,
            )

            const updatedCurrentSession =
              activeSessionId === eventSessionId
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
          set({ queuedMessages: payload.messages ?? [] })
          break
        }

        case 'devServer.output':
        case 'devServer.state': {
          useDevServerStore.getState().handleMessage(message)
          break
        }

        case 'backgroundProcess.started':
        case 'backgroundProcess.output':
        case 'backgroundProcess.exited':
        case 'backgroundProcess.removed': {
          useBackgroundProcessesStore.getState().handleMessage(message.type, message.payload as Record<string, unknown>)
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
  }
})

// Helper selector: is the session currently running (agent active)?
export function useIsRunning() {
  return useSessionStore((state) => state.currentSession?.isRunning ?? false)
}

export function useQueuedMessages() {
  return useSessionStore((state) => state.queuedMessages)
}

export function useAbortInProgress() {
  return useSessionStore((state) => state.abortInProgress)
}

export function useVisionFallbackItems() {
  return useSessionStore((state) => state.visionFallbackByMessage)
}

export function useVisionFallbackForMessage(messageId: string, attachmentId?: string) {
  return useSessionStore((state) => {
    if (!attachmentId) return undefined
    const key = `${messageId}-${attachmentId}`
    return state.visionFallbackByMessage[key]
  })
}
