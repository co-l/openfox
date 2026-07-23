import { create } from 'zustand'
import { authFetch } from '../../lib/api'
import { appUrl } from '../../lib/basePath'
import type { SessionSummary, Message } from '@shared/types.js'
import type { QueuedMessage, PendingQuestionPayload } from '@shared/protocol.js'
import { wsClient } from '../../lib/ws'
import { useConfigStore } from '../config'
import { useProjectStore } from '../project'
import { useBackgroundProcessesStore } from '../background-processes'
import type { SessionState, PendingPathConfirmation } from './types'
import { getBuffer, setFlushFn, cancelStreamingFlush } from './streamingBuffer'
import { handleServerMessage as handleMessage } from './messageHandler'

let isSubscribed = false
let wsUnsubscribe: (() => void) | null = null

const loadingSessionIds = new Set<string>()
const listingSessionsForProject = new Map<string, Promise<void>>()

function applyToolOutputs(
  toolCalls: import('@shared/types.js').ToolCall[] | undefined,
  toolOutputs: Array<{ callId: string; stream: 'stdout' | 'stderr'; content: string }>,
  matchedCallIds: Set<string>,
): import('@shared/types.js').ToolCall[] | undefined {
  return toolCalls?.map((tc) => {
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
}

async function postMessage(
  sessionId: string,
  content: string | undefined,
  attachments: import('@shared/types.js').Attachment[] | undefined,
  messageKind: string | undefined,
  set: (
    partial:
      | Partial<import('./types').SessionState>
      | ((state: import('./types').SessionState) => Partial<import('./types').SessionState>),
  ) => void,
) {
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
    console.error('Error queueing message:', error)
  }
}

export const useSessionStore = create<SessionState>((set, get) => {
  setFlushFn(() => {
    const buf = getBuffer()
    if (!buf.messageId) return

    const hasDelta = buf.deltaContent.length > 0
    const hasThinking = buf.thinkingContent.length > 0
    const hasToolOutput = buf.toolOutput.length > 0

    if (!hasDelta && !hasThinking && !hasToolOutput) return

    const delta = buf.deltaContent
    const thinking = buf.thinkingContent
    const toolOutputs: Array<{ messageId: string; callId: string; stream: 'stdout' | 'stderr'; content: string }> =
      buf.toolOutput

    buf.deltaContent = ''
    buf.thinkingContent = ''
    buf.toolOutput = []

    set((state) => {
      const sm = state.messages.find((m) => m.id === buf.messageId)
      if (sm) {
        const updated = { ...sm }
        if (hasDelta) {
          updated.content = updated.content + delta
        }
        if (hasThinking) {
          updated.thinkingContent = (updated.thinkingContent ?? '') + thinking
        }
        if (hasToolOutput) {
          const matchedCallIds = new Set<string>()
          updated.toolCalls = applyToolOutputs(updated.toolCalls, toolOutputs, matchedCallIds)
          const unmatched = toolOutputs.filter((o) => !matchedCallIds.has(o.callId))
          if (unmatched.length > 0) buf.toolOutput.push(...unmatched)
        }
        return { messages: state.messages.map((m) => (m.id === buf.messageId ? updated : m)) }
      }

      if (hasToolOutput) {
        const matchedCallIds = new Set<string>()
        const updatedMessages = state.messages.map((m) => {
          if (m.id !== buf.messageId) return m
          return { ...m, toolCalls: applyToolOutputs(m.toolCalls, toolOutputs, matchedCallIds) }
        })
        const unmatched = toolOutputs.filter((o) => !matchedCallIds.has(o.callId))
        if (unmatched.length > 0) buf.toolOutput.push(...unmatched)
        return { messages: updatedMessages }
      }

      return state
    })
  })

  return {
    connectionStatus: 'disconnected',
    showPasswordModal: false,
    passwordModalRetry: false,
    sessions: [],
    currentSession: null,
    unreadSessionIds: [],
    messages: [],
    hiddenCount: 0,
    currentTodos: [],
    contextState: null,
    subAgentContextStates: {},
    pendingPathConfirmations: [],
    crossSessionConfirmations: {},
    sessionsWithPendingConfirmations: [],
    pendingQuestions: [],
    visionFallbackByMessage: {},
    gitStatus: null,
    queuedMessages: [],
    abortInProgress: false,
    restoredInput: null,
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
        /* empty */
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
          wsUnsubscribe = wsClient.subscribe((message) => {
            handleMessage(message, set, get)
          })
        }
      } catch (error) {
        console.error('Failed to connect:', error)
        const closeCode = wsClient.getLastCloseCode()

        if (!wsClient.hasToken() && (closeCode === 1006 || closeCode === 4000)) {
          set({ showPasswordModal: true, passwordModalRetry: true, connectionStatus: 'reconnecting' })
          return
        }
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
        const res = await fetch(appUrl('/api/auth/login'), {
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
        try {
          wsClient.send('session.load', { sessionId: data.session.id })
        } catch {
          /* empty */
        }
        return data.session
      } catch {
        set({ pendingSessionCreate: false })
        return null
      }
    },

    loadSession: async (sessionId) => {
      if (loadingSessionIds.has(sessionId)) {
        return
      }

      loadingSessionIds.add(sessionId)

      try {
        const currentSession = get().currentSession

        if (!currentSession || currentSession.id !== sessionId) {
          const oldSessionId = currentSession?.id
          const oldConfirmations = get().pendingPathConfirmations
          const existingCross = get().crossSessionConfirmations
          const crossCleanup = { ...existingCross }
          if (oldSessionId && oldConfirmations.length > 0) {
            crossCleanup[oldSessionId] = [...(crossCleanup[oldSessionId] ?? []), ...oldConfirmations]
          }
          cancelStreamingFlush()
          set({
            currentSession: null,
            unreadSessionIds: get().unreadSessionIds.filter((id) => id !== sessionId),
            subAgentContextStates: {},
            messages: [],
            currentTodos: [],
            contextState: null,
            pendingPathConfirmations: [],
            pendingQuestions: [],
            queuedMessages: [],
            abortInProgress: false,
            restoredInput: null,
            error: null,
            gitStatus: null,
            pendingSessionCreate: false as boolean | string,
            crossSessionConfirmations: crossCleanup,
            sessionsWithPendingConfirmations: Object.keys(crossCleanup),
          })
        } else {
          set({ unreadSessionIds: get().unreadSessionIds.filter((id) => id !== sessionId) })
        }

        const res = await authFetch(`/api/sessions/${sessionId}`)
        if (!res.ok) return

        const data = await res.json()
        const loadedMessages = (data.messages as Message[] | undefined) ?? []
        const crossCleanup = { ...get().crossSessionConfirmations }
        delete crossCleanup[sessionId]
        set({
          currentSession: data.session,
          messages: loadedMessages,
          hiddenCount: (data.hiddenCount as number | undefined) ?? 0,
          contextState: data.contextState,
          queuedMessages: (data.queueState as QueuedMessage[] | undefined) ?? [],
          pendingPathConfirmations: (data.pendingConfirmations ?? []) as PendingPathConfirmation[],
          pendingQuestions: (data.pendingQuestions ?? []) as PendingQuestionPayload[],
          crossSessionConfirmations: crossCleanup,
          sessionsWithPendingConfirmations: Object.keys(crossCleanup),
        })

        wsClient.send('session.load', { sessionId })

        try {
          const bpRes = await authFetch(`/api/sessions/${sessionId}/background-processes`)
          if (bpRes.ok) {
            const bpData = await bpRes.json()
            useBackgroundProcessesStore.getState().setProcesses(bpData.processes ?? [])
          }
        } catch {
          /* empty */
        }
      } catch {
        /* empty */
      } finally {
        loadingSessionIds.delete(sessionId)
      }
    },

    listSessions: async (projectId?: string, limit = 20) => {
      const cacheKey = projectId ?? 'global'

      if (listingSessionsForProject.has(cacheKey)) {
        return listingSessionsForProject.get(cacheKey)
      }

      const listPromise = (async () => {
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
            sessions: incoming.map((s) => {
              const existing = state.sessions.find((e) => e.id === s.id)
              return {
                ...s,
                title: s.title ?? existing?.title,
                mode: state.currentSession?.id === s.id ? state.currentSession.mode : (existing?.mode ?? s.mode),
                phase: state.currentSession?.id === s.id ? state.currentSession.phase : (existing?.phase ?? s.phase),
                isRunning: s.isRunning && existing?.isRunning !== false,
                messageCount: s.messageCount,
                recentUserPrompts: s.recentUserPrompts,
              }
            }),
            sessionsHasMore: projectId ? (data.hasMore ?? false) : true,
          }))

          // Restore cross-session confirmation state from server
          const pendingBySession = data.pendingConfirmationsBySession as
            | Record<string, PendingPathConfirmation[]>
            | undefined
          if (pendingBySession) {
            const currentSessionId = get().currentSession?.id
            const crossSessionConfirmations: Record<string, PendingPathConfirmation[]> = {}
            for (const [sid, confs] of Object.entries(pendingBySession)) {
              if (sid !== currentSessionId) {
                crossSessionConfirmations[sid] = confs
              }
            }
            set({
              crossSessionConfirmations,
              sessionsWithPendingConfirmations: Object.keys(crossSessionConfirmations),
            })
          }
        } catch {
          /* empty */
        } finally {
          listingSessionsForProject.delete(cacheKey)
        }
      })()

      listingSessionsForProject.set(cacheKey, listPromise)
      return listPromise
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
        await get().listSessions()
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
        await get().listSessions()
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
        hiddenCount: 0,
        currentTodos: [],
        contextState: null,
        restoredInput: null,
        pendingSessionCreate: false as boolean | string,
        unreadSessionIds: state.currentSession
          ? state.unreadSessionIds.filter((id) => id !== state.currentSession!.id)
          : state.unreadSessionIds,
      }))
    },

    sendMessage: async (content, attachments, opts) => {
      set({ error: null })
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        const hasContent = content?.trim()
        const hasAttachments = attachments && attachments.length > 0
        const body: Record<string, unknown> = {}
        if (hasContent) {
          body.content = content
        }
        if (hasAttachments) {
          body.attachments = attachments
        }
        if (opts?.messageKind) {
          body.messageKind = opts.messageKind
        }

        const res = await authFetch(`/api/sessions/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
      cancelStreamingFlush()
      set({ abortInProgress: true })

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' })
        const data = (await res.json()) as { success: boolean; queuedMessages?: Array<{ content: string }> }
        if (data.queuedMessages && data.queuedMessages.length > 0) {
          const combined = data.queuedMessages.map((m) => m.content).join('\n')
          set({ restoredInput: combined })
        }
      } catch (error) {
        console.error('Error stopping generation:', error)
      }
    },

    continueGeneration: async () => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        await authFetch(`/api/sessions/${sessionId}/continue`, { method: 'POST' })
      } catch (error) {
        console.error('Error continuing generation:', error)
      }
    },

    launchWorkflow: (content?, attachments?, workflowId?, subGroup?) => {
      const payload: Record<string, unknown> = {}
      if (content?.trim()) payload.content = content
      if (attachments && attachments.length > 0) payload.attachments = attachments
      if (workflowId) payload.workflowId = workflowId
      if (subGroup) payload.subGroup = subGroup
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
        if (data.session) {
          set({ currentSession: data.session })
        }
        if (data.messages) {
          set({ messages: data.messages, hiddenCount: (data.hiddenCount as number) ?? 0 })
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
        set({
          currentSession: data.session,
          messages: data.messages ?? [],
          hiddenCount: (data.hiddenCount as number) ?? 0,
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
        const res = await authFetch(`/api/sessions/${sessionId}/confirm-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, approved, alwaysAllow }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          console.error('Error confirming path:', body.error ?? `HTTP ${res.status}`)
        }
      } catch (error) {
        console.error('Error confirming path:', error)
      }
    },

    answerQuestion: async (callId: string, answer: string, skip?: boolean) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return

      try {
        await authFetch(`/api/sessions/${sessionId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, answer, skip }),
        })
      } catch (error) {
        console.error('Error answering question:', error)
      }
      set((state) => ({
        pendingQuestions: state.pendingQuestions.filter((q) => q.callId !== callId),
      }))
    },

    queueAsap: async (content, attachments, messageKind?: string) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return
      await postMessage(sessionId, content, attachments, messageKind, set)
    },

    queueCompletion: async (content, attachments, messageKind?: string) => {
      const sessionId = get().currentSession?.id
      if (!sessionId) return
      await postMessage(sessionId, content, attachments, messageKind, set)
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

    clearRestoredInput: () => {
      set({ restoredInput: null })
    },

    resetPendingSessionCreate: () => {
      set({ pendingSessionCreate: false as boolean | string })
    },

    handleServerMessage: (message) => {
      handleMessage(message, set, get)
    },
  }
})
