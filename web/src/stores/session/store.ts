import { create } from 'zustand'
import { authFetch } from '../../lib/api'
import { appUrl } from '../../lib/basePath'
import { consumePrefetchedSession } from '../../lib/sessionPrefetch'
import type { SessionSummary, Message, Session, ContextState, WorkflowExecution } from '@shared/types.js'
import type { QueuedMessage, PendingQuestionPayload } from '@shared/protocol.js'
import { wsClient } from '../../lib/ws'
import { useConfigStore } from '../config'
import { useProjectStore } from '../project'
import { useBackgroundProcessesStore } from '../background-processes'
import { writeSplitLayout, isSplitRoute } from '../../lib/splitPersistence'
import type { SessionState, SessionPane, PendingPathConfirmation } from './types'
import { getBuffer, setFlushFn, cancelStreamingFlush, releaseStreamingBuffer } from './streamingBuffer'
import { handleServerMessage as handleMessage } from './messageHandler'
import {
  emptyPane,
  paneFromFlat,
  mirror,
  effectiveFocusedId,
  isLivePane,
  updatePane,
  replacePane,
  updatePaneSession,
  dropPane,
  resolveSessionProjectId,
} from './panes'

let isSubscribed = false
let wsUnsubscribe: (() => void) | null = null

const loadingSessionIds = new Set<string>()
const loadedSessionIds = new Set<string>()
const listingSessionsForProject = new Map<string, Promise<void>>()
let fullSessionListPromise: Promise<void> | null = null

interface SessionLoadData {
  session: Session
  messages?: Message[]
  hiddenCount?: number
  contextState?: ContextState | null
  queueState?: QueuedMessage[]
  pendingConfirmations?: PendingPathConfirmation[]
  pendingQuestions?: PendingQuestionPayload[]
  activeWorkflowExecution?: WorkflowExecution | null
}

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

function addToOrdered(list: string[], sessionId: string): string[] {
  return list.includes(sessionId) ? list : [...list, sessionId]
}

async function postMessage(
  sessionId: string,
  content: string | undefined,
  attachments: import('@shared/types.js').Attachment[] | undefined,
  messageKind: string | undefined,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void,
) {
  try {
    const res = await authFetch(`/api/sessions/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, attachments, messageKind }),
    })
    const data = await res.json()
    if (data.queueState) {
      set((state) => updatePane(state, sessionId, (pane) => ({ ...pane, queuedMessages: data.queueState })))
    }
  } catch (error) {
    console.error('Error queueing message:', error)
  }
}

// Merge a freshly fetched session list into the store: keep the live
// focusedSession's mode/phase, preserve titles/prompts already in state, and
// never resurrect a session the server reports as not running.
//
// When `projectId` is provided (scoped reload), incoming represents the
// complete current set of sessions for that project: it REPLACES that
// project's slice while preserving every other project's sessions. This is
// what makes a per-project refresh after a mutation (delete/rename/favorite)
// not drop other projects from the sidebar.
//
// When `projectId` is undefined (home/global reload), incoming is the
// authoritative full result (e.g. the curated 5-per-project home list) and
// REPLACES the list entirely — so sessions that fall out of the curated set
// are removed. This preserves the original listHomeSessions behavior.
function mergeSessionSummaries(incoming: SessionSummary[], state: SessionState, projectId?: string): SessionSummary[] {
  const merged = incoming.map((s) => {
    const existing = state.sessions.find((e) => e.id === s.id)
    const pane = state.panes[s.id]
    const liveSession = pane?.session
    return {
      ...s,
      title: s.title ?? existing?.title,
      mode: liveSession?.id === s.id ? liveSession.mode : (existing?.mode ?? s.mode),
      phase: liveSession?.id === s.id ? liveSession.phase : (existing?.phase ?? s.phase),
      isRunning: s.isRunning && existing?.isRunning !== false,
      messageCount: s.messageCount,
      ...(s.recentUserPrompts !== undefined && { recentUserPrompts: s.recentUserPrompts }),
    }
  })
  if (!projectId) return merged
  const incomingIds = new Set(incoming.map((s) => s.id))
  const preserved = state.sessions.filter((s) => s.projectId !== projectId && !incomingIds.has(s.id))
  return [...merged, ...preserved]
}

/** Resolve the pane backing a session, materializing from flat when needed. */
function paneFor(state: SessionState, sessionId: string): SessionPane | null {
  const pane = state.panes[sessionId]
  if (pane) return pane
  if (state.currentSession?.id === sessionId) return paneFromFlat(state)
  return null
}

export const useSessionStore = create<SessionState>((set, get) => {
  const persistSplit = () => {
    const s = get()
    writeSplitLayout({ openSessionIds: s.openSessionIds, focusedSessionId: s.focusedSessionId })
  }
  setFlushFn((sessionId) => {
    const buf = getBuffer(sessionId)
    if (!buf.messageId) return

    const hasDelta = buf.deltaContent.length > 0
    const hasThinking = buf.thinkingContent.length > 0
    const hasToolOutput = buf.toolOutput.length > 0

    if (!hasDelta && !hasThinking && !hasToolOutput) return

    set((state) => {
      if (!isLivePane(state, sessionId)) return state
      return updatePane(state, sessionId, (pane) => {
        const sm = pane.messages.find((m) => m.id === buf.messageId)
        if (!sm) {
          // The target message has not landed in this pane yet (the server can
          // stream the first deltas before broadcasting the message). Keep the
          // buffered deltas intact so the next flush applies them instead of
          // silently dropping the stream.
          return pane
        }
        const updated = { ...sm }
        let applied = false
        if (hasDelta) {
          updated.content = updated.content + buf.deltaContent
          buf.deltaContent = ''
          applied = true
        }
        if (hasThinking) {
          updated.thinkingContent = (updated.thinkingContent ?? '') + buf.thinkingContent
          buf.thinkingContent = ''
          applied = true
        }
        if (hasToolOutput) {
          const matchedCallIds = new Set<string>()
          updated.toolCalls = applyToolOutputs(updated.toolCalls, buf.toolOutput, matchedCallIds)
          const unmatched = buf.toolOutput.filter((o) => !matchedCallIds.has(o.callId))
          buf.toolOutput = unmatched
          applied = true
        }
        if (!applied) return pane
        return { ...pane, messages: pane.messages.map((m) => (m.id === buf.messageId ? updated : m)) }
      })
    })
  })

  function buildResumePayload(
    exec: import('@shared/types.js').WorkflowExecution,
    sessionId: string,
    content?: string,
    attachments?: import('@shared/types.js').Attachment[],
    messageKind?: string,
    userChoice?: string,
  ): Record<string, unknown> {
    return {
      sessionId,
      workflowId: exec.workflowId,
      resumeFrom: exec.currentStepId,
      stepOutput: exec.stepOutput,
      ...(exec.params && Object.keys(exec.params).length > 0 ? { params: exec.params } : {}),
      ...(exec.subGroup ? { subGroup: exec.subGroup } : {}),
      ...(userChoice ? { userChoice } : {}),
      ...(content?.trim() ? { content } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(messageKind ? { messageKind } : {}),
    }
  }

  /**
   * Core loader. Ensures `sessionId` has a live pane. When `focus` is true the
   * pane becomes the focused session (the router/URL session); otherwise it is
   * loaded as a background pane for the split view.
   */
  async function ensurePane(sessionId: string, focus: boolean, force = false) {
    if (!force && loadingSessionIds.has(sessionId)) {
      return
    }
    if (!force && loadedSessionIds.has(sessionId)) {
      if (focus) {
        set((s) => {
          const p = s.panes[sessionId] ?? (s.currentSession?.id === sessionId ? paneFromFlat(s) : null)
          if (!p) return s
          return {
            focusedSessionId: sessionId,
            ...mirror(p),
            unreadSessionIds: s.unreadSessionIds.filter((id) => id !== sessionId),
          }
        })
      }
      return
    }

    loadingSessionIds.add(sessionId)

    try {
      const current = get()
      const currentId = effectiveFocusedId(current)
      const switching = currentId !== null && currentId !== sessionId
      const crossCleanup = { ...current.crossSessionConfirmations }
      if (switching && currentId) {
        // Preserve the session being left's pending confirmations so they
        // surface as cross-session notifications instead of vanishing.
        const outgoingConfirmations =
          current.panes[currentId]?.pendingPathConfirmations ?? current.pendingPathConfirmations
        if (outgoingConfirmations.length > 0) {
          crossCleanup[currentId] = [...(crossCleanup[currentId] ?? []), ...outgoingConfirmations]
        }
      }

      // Focus/position the pane immediately so the UI reacts before the fetch
      // round-trips. When switching sessions, wipe the flat view (legacy
      // behaviour) unless the target pane is already live in memory.
      set((s) => {
        const existing = s.panes[sessionId]
        const target = existing ?? (effectiveFocusedId(s) === sessionId ? paneFromFlat(s) : emptyPane())
        const clearFlat = focus && switching && !existing
        return {
          focusedSessionId: focus ? sessionId : s.focusedSessionId,
          panes: { ...s.panes, [sessionId]: target },
          ...(focus ? mirror(clearFlat ? emptyPane() : target) : {}),
          unreadSessionIds: s.unreadSessionIds.filter((id) => id !== sessionId),
          crossSessionConfirmations: crossCleanup,
          sessionsWithPendingConfirmations: Object.keys(crossCleanup),
          llmRetry: null,
          pendingSessionCreate: false as boolean | string,
        }
      })

      if (switching && currentId) {
        cancelStreamingFlush(currentId)
      }

      // Fire both requests in parallel — background-processes does not depend
      // on the session payload, so it must not wait for a second round-trip.
      // The session fetch was prefetched at app boot (main.tsx) when this
      // session is the initial URL — consume it instead of re-fetching.
      // On prefetch failure (401, network blip, server restart) fall through
      // to the regular fetch: the load must never abort silently.
      const prefetched = consumePrefetchedSession(sessionId)
      const sessionFetch: Promise<SessionLoadData | null> = prefetched
        ? prefetched.then(async (result) => {
            if (result.ok) return result.data as unknown as SessionLoadData
            const res = await authFetch(`/api/sessions/${sessionId}`)
            if (!res.ok) return null
            return (await res.json()) as SessionLoadData
          })
        : authFetch(`/api/sessions/${sessionId}`).then(async (res) => {
            if (!res.ok) return null
            return (await res.json()) as SessionLoadData
          })
      const bpFetch = authFetch(`/api/sessions/${sessionId}/background-processes`)

      const data = await sessionFetch
      if (!data) {
        // The session no longer exists server-side — prune the pane so a
        // stale persisted split cannot resurrect a deleted session.
        if (get().panes[sessionId]?.session == null) {
          set((s) => dropPane(s, sessionId))
          persistSplit()
        }
        return
      }
      const loadedMessages = (data.messages as Message[] | undefined) ?? []
      const crossCleanup2 = { ...get().crossSessionConfirmations }
      delete crossCleanup2[sessionId]
      set((s) => {
        const prior = s.panes[sessionId] ?? paneFromFlat(s)
        const nextPane: SessionPane = {
          ...prior,
          session: data.session,
          messages: loadedMessages,
          hiddenCount: (data.hiddenCount as number | undefined) ?? 0,
          contextState: data.contextState ?? null,
          queuedMessages: (data.queueState as QueuedMessage[] | undefined) ?? [],
          pendingPathConfirmations: (data.pendingConfirmations ?? []) as PendingPathConfirmation[],
          pendingQuestions: (data.pendingQuestions ?? []) as PendingQuestionPayload[],
          activeWorkflowExecution: (data.activeWorkflowExecution as WorkflowExecution | undefined) ?? null,
          llmRetry: null,
        }
        return {
          ...replacePane(s, sessionId, nextPane),
          crossSessionConfirmations: crossCleanup2,
          sessionsWithPendingConfirmations: Object.keys(crossCleanup2),
        }
      })

      wsClient.send('session.load', { sessionId })

      try {
        const bpRes = await bpFetch
        if (bpRes.ok) {
          const bpData = await bpRes.json()
          useBackgroundProcessesStore.getState().setProcesses(bpData.processes ?? [])
        }
      } catch {
        /* empty */
      }
      loadedSessionIds.add(sessionId)
    } catch {
      /* empty */
    } finally {
      loadingSessionIds.delete(sessionId)
    }
  }

  return {
    connectionStatus: 'disconnected',
    showPasswordModal: false,
    passwordModalRetry: false,
    sessions: [],
    searchSessions: null,
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
    activeWorkflowExecution: null,
    llmRetry: null,
    liveTurnStats: null,
    sessionsHasMore: true,
    sessionsPaginationLoading: false,
    pendingSessionCreate: false as boolean | string,
    pendingUpdate: null as string | null,
    panes: {},
    openSessionIds: [],
    focusedSessionId: null,

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
          // Refresh the session list contextually and leanly. The homepage
          // owns its own curated load (listHomeSessions), so we must NOT fire
          // a heavyweight global list here. When a session is open, refresh
          // that project's bounded list so the sidebar stays fresh after a
          // reconnect. On the split route, the control panel needs the full
          // curated list across projects — a per-project refresh would shrink
          // it to a single project.
          if (isSplitRoute()) {
            get().listHomeSessions()
          } else {
            const activeProjectId = get().currentSession?.projectId
            if (activeProjectId) {
              get().listSessions(activeProjectId)
            }
          }
          useProjectStore.getState().listProjects()
          // Reload the active session on (re)connect only when it has not been
          // loaded yet (first connect, or after any disconnect/reconnect which
          // clears loadedSessionIds). The route-level useSessionLoader already
          // covers the initial navigation, so this avoids a duplicate fetch on
          // first load. Clearing on 'reconnecting'/'disconnected' also covers
          // automatic WS reconnects (ws.ts), so the client re-subscribes via
          // session.load after every connection drop.
          const currentSessionId = get().focusedSessionId ?? get().currentSession?.id
          if (currentSessionId) {
            void get().loadSession(currentSessionId)
          }
        } else if (newStatus === 'disconnected' || newStatus === 'reconnecting') {
          loadedSessionIds.clear()
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
      loadedSessionIds.clear()
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
      loadedSessionIds.clear()
      set({ connectionStatus: 'disconnected', showPasswordModal: false })
    },

    logout: async () => {
      wsClient.clearToken()
      get().disconnect()

      let requiresAuth = false
      try {
        const res = await authFetch('/api/auth')
        const auth = await res.json()
        requiresAuth = auth.requiresAuth === true
      } catch {
        /* server unreachable — stay disconnected without prompting */
      }

      set({ passwordModalRetry: false, showPasswordModal: requiresAuth })
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
        set({ searchSessions: null })
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

    loadSession: async (sessionId, force = false) => {
      await ensurePane(sessionId, true, force)
    },

    openPane: async (sessionId, opts = {}) => {
      const focus = opts.focus ?? false
      set((s) => ({ openSessionIds: addToOrdered(s.openSessionIds, sessionId) }))
      await ensurePane(sessionId, focus)
      if (focus) {
        get().focusPane(sessionId)
      }
      persistSplit()
    },

    closePane: (sessionId) => {
      cancelStreamingFlush(sessionId)
      releaseStreamingBuffer(sessionId)
      set((s) => dropPane(s, sessionId))
      persistSplit()
    },

    focusPane: (sessionId) => {
      set((s) => {
        if (effectiveFocusedId(s) === sessionId) return s
        const pane = s.panes[sessionId] ?? (s.currentSession?.id === sessionId ? paneFromFlat(s) : null)
        if (!pane) return s
        return {
          ...s,
          focusedSessionId: sessionId,
          openSessionIds: addToOrdered(s.openSessionIds, sessionId),
          ...mirror(pane),
        }
      })
      persistSplit()
    },

    reorderPane: (sessionId, direction) => {
      set((s) => {
        const index = s.openSessionIds.indexOf(sessionId)
        if (index === -1) return s
        const target = index + direction
        if (target < 0 || target >= s.openSessionIds.length) return s
        const next = [...s.openSessionIds]
        const [moving, displaced] = [next[index]!, next[target]!]
        next[index] = displaced
        next[target] = moving
        return { ...s, openSessionIds: next }
      })
      persistSplit()
    },

    isPaneOpen: (sessionId) => {
      const s = get()
      return s.openSessionIds.includes(sessionId) || s.panes[sessionId] !== undefined
    },

    enterSplitView: async (sessionIds, focusId) => {
      const ids = sessionIds.filter(Boolean)
      if (ids.length === 0) return
      // The control panel lists sessions across projects; make sure it is
      // populated even on a direct load of the split route (where no homepage
      // or session-page loader has run).
      void get().listHomeSessions()
      const toLoad = ids.filter((id) => !get().panes[id])
      await Promise.all(toLoad.map((id) => get().openPane(id, { focus: false })))
      const focus = focusId && ids.includes(focusId) ? focusId : ids[0]!
      set((s) => {
        const openSessionIds = [...new Set([...s.openSessionIds, ...ids])]
        const pane = s.panes[focus] ?? null
        return {
          openSessionIds,
          focusedSessionId: focus,
          ...(pane ? mirror(pane) : {}),
          unreadSessionIds: s.unreadSessionIds.filter((id) => id !== focus),
        }
      })
      persistSplit()
    },

    exitSplitView: () => {
      // Leaving split view must not destroy the layout: panes, their order and
      // the focused session are preserved so navigating back (or revisiting
      // the route) restores the exact same split. Navigation to a plain
      // session page re-mirrors the URL session via loadSession anyway.
      persistSplit()
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
            sessions: mergeSessionSummaries(incoming, state, projectId),
            sessionsHasMore: projectId ? (data.hasMore ?? false) : true,
          }))

          // Restore cross-session confirmation state from server
          const pendingBySession = data.pendingConfirmationsBySession as
            Record<string, PendingPathConfirmation[]> | undefined
          if (pendingBySession) {
            const currentSessionId = get().focusedSessionId ?? get().currentSession?.id
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

    listHomeSessions: async () => {
      try {
        const res = await authFetch('/api/sessions/home')
        if (!res.ok) return
        const data = (await res.json()) as { sessions: SessionSummary[] }
        set((state) => ({
          sessions: mergeSessionSummaries(data.sessions, state),
          sessionsHasMore: false,
        }))
      } catch {
        /* empty */
      }
    },

    ensureFullSessionList: async () => {
      // The full list (with prompts) powers search across all sessions. It is
      // deliberately loaded on demand only — a fresh home page load must never
      // pay for parsing every session snapshot.
      if (get().searchSessions) return
      if (fullSessionListPromise) return fullSessionListPromise
      fullSessionListPromise = (async () => {
        try {
          const res = await authFetch('/api/sessions')
          const data = await res.json()
          const incoming = (data.sessions ?? []) as SessionSummary[]
          set({ searchSessions: incoming })
        } catch {
          // Allow a retry on the next search; the visible list still works.
        } finally {
          fullSessionListPromise = null
        }
      })()
      return fullSessionListPromise
    },

    loadMoreSessions: async (projectId) => {
      const state = get()
      if (state.sessionsPaginationLoading || !state.sessionsHasMore) return

      set({ sessionsPaginationLoading: true })
      try {
        const params = new URLSearchParams()
        params.set('limit', '20')
        // Offset is the count of sessions already loaded for THIS project,
        // not the global sessions length — the store now holds sessions from
        // multiple projects (preserved across scoped reloads), so the global
        // length would skip real sessions of the target project.
        params.set('offset', String(state.sessions.filter((s) => s.projectId === projectId).length))
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
      // Resolve the project BEFORE the request: the server broadcasts
      // session.deleted before answering the DELETE, and that handler wipes
      // the session from state. Resolving afterwards would yield undefined and
      // fall back to an unscoped global reload, dropping other projects.
      const projectId = resolveSessionProjectId(get(), sessionId)
      try {
        const res = await authFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
        if (!res.ok) return false
        set({ searchSessions: null })
        await get().listSessions(projectId)
        if (get().focusedSessionId === sessionId || get().currentSession?.id === sessionId) {
          get().clearSession()
        }
        return true
      } catch {
        return false
      }
    },

    renameSession: async (sessionId: string, title: string) => {
      const projectId = resolveSessionProjectId(get(), sessionId)
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/title`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        if (!res.ok) return false
        set({ searchSessions: null })
        await get().listSessions(projectId)
        set((state) => {
          const pane = state.panes[sessionId]
          if (!pane) return {}
          const updated: Session | null = pane.session
            ? { ...pane.session, metadata: { ...pane.session.metadata, title } }
            : pane.session
          return { ...replacePane(state, sessionId, { ...pane, session: updated }) }
        })
        return true
      } catch {
        return false
      }
    },

    toggleFavorite: async (sessionId: string, isFavorite: boolean) => {
      const projectId = resolveSessionProjectId(get(), sessionId)
      // Optimistic update: flip immediately for responsive UI
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, isFavorite } : s)),
      }))
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/favorite`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isFavorite }),
        })
        if (!res.ok) {
          console.warn('Failed to toggle favorite', { sessionId, isFavorite, status: res.status })
          // Revert optimistic update
          set((state) => ({
            sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, isFavorite: !isFavorite } : s)),
          }))
          return false
        }
        await get().listSessions(projectId)
        return true
      } catch (error) {
        console.error('Error toggling favorite:', error)
        // Revert optimistic update
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, isFavorite: !isFavorite } : s)),
        }))
        return false
      }
    },

    deleteAllSessions: async (projectId) => {
      try {
        const res = await authFetch(`/api/projects/${projectId}/sessions`, { method: 'DELETE' })
        if (!res.ok) return false
        set({ searchSessions: null })
        await get().listSessions(projectId)
        return true
      } catch {
        return false
      }
    },

    clearSession: () => {
      const focused = get().focusedSessionId ?? get().currentSession?.id
      if (focused) {
        cancelStreamingFlush(focused)
      }
      loadedSessionIds.clear()
      set((state) => {
        const panes = { ...state.panes }
        if (focused) {
          delete panes[focused]
        }
        return {
          currentSession: null,
          messages: [],
          hiddenCount: 0,
          currentTodos: [],
          contextState: null,
          restoredInput: null,
          pendingSessionCreate: false as boolean | string,
          focusedSessionId: null,
          panes,
          openSessionIds: state.openSessionIds.filter((id) => id !== focused),
          unreadSessionIds: focused ? state.unreadSessionIds.filter((id) => id !== focused) : state.unreadSessionIds,
        }
      })
    },

    sendMessage: async (sessionId, content, attachments, opts) => {
      const pane = paneFor(get(), sessionId)
      if (!pane?.session) return
      set((s) => updatePane(s, sessionId, (p) => ({ ...p, error: null })))

      // If there's an active workflow execution that was aborted (status 'running'),
      // route the message as a workflow resume instead of a normal chat message.
      const exec = pane.activeWorkflowExecution
      if (exec && exec.status === 'running') {
        wsClient.send('runner.launch', buildResumePayload(exec, sessionId, content, attachments, opts?.messageKind))
        return
      }

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
          set((state) => updatePane(state, sessionId, (p) => ({ ...p, queuedMessages: data.queueState })))
        }
      } catch (error) {
        console.error('Error sending message:', error)
      }
    },

    stopGeneration: async (sessionId) => {
      if (!paneFor(get(), sessionId)?.session) return
      if (get().panes[sessionId]?.abortInProgress) return
      cancelStreamingFlush(sessionId)
      set((s) => updatePane(s, sessionId, (p) => ({ ...p, abortInProgress: true })))

      try {
        const res = await authFetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' })
        const data = (await res.json()) as { success: boolean; queuedMessages?: Array<{ content: string }> }
        if (data.queuedMessages && data.queuedMessages.length > 0) {
          const combined = data.queuedMessages.map((m) => m.content).join('\n')
          set((s) => updatePane(s, sessionId, (p) => ({ ...p, restoredInput: combined })))
        }
      } catch (error) {
        console.error('Error stopping generation:', error)
      }
    },

    continueGeneration: async (sessionId) => {
      if (!paneFor(get(), sessionId)?.session) return
      try {
        await authFetch(`/api/sessions/${sessionId}/continue`, { method: 'POST' })
      } catch (error) {
        console.error('Error continuing generation:', error)
      }
    },

    launchWorkflow: (sessionId, content?, attachments?, workflowId?, subGroup?, params?, scope?) => {
      if (!paneFor(get(), sessionId)?.session) return
      const payload: Record<string, unknown> = { sessionId }
      if (content?.trim()) payload.content = content
      if (attachments && attachments.length > 0) payload.attachments = attachments
      if (workflowId) payload.workflowId = workflowId
      if (subGroup) payload.subGroup = subGroup
      if (params) payload.params = params
      payload.scope = scope ?? 'auto'
      wsClient.send('runner.launch', payload)
    },

    continueWorkflow: (sessionId, choiceId?) => {
      const pane = paneFor(get(), sessionId)
      const exec = pane?.activeWorkflowExecution
      if (!exec || exec.status !== 'waiting') return
      wsClient.send('runner.launch', buildResumePayload(exec, sessionId, undefined, undefined, undefined, choiceId))
    },

    retryLLMNow: (sessionId) => {
      wsClient.send('chat.llm_retry_now', { sessionId })
      set((s) => updatePane(s, sessionId, (p) => ({ ...p, llmRetry: null })))
    },

    retryLLM: (sessionId) => {
      const pane = paneFor(get(), sessionId)
      set((s) => updatePane(s, sessionId, (p) => ({ ...p, llmRetry: null, error: null })))
      // Blocked workflow execution → re-launch the step through the resume path
      // (the step prompt is already in history — nothing is re-injected).
      const exec = pane?.activeWorkflowExecution
      if (exec && exec.status === 'blocked' && exec.currentStepId && !pane?.session?.isRunning) {
        wsClient.send('runner.launch', buildResumePayload(exec, sessionId, undefined, undefined, undefined))
        return
      }
      // Regular chat → re-run the last turn without re-adding the user message.
      wsClient.send('chat.retry', { sessionId })
    },

    exitWorkflow: (sessionId) => {
      if (!paneFor(get(), sessionId)?.session) return
      wsClient.send('workflow.exit', { sessionId })
    },

    switchMode: async (sessionId, mode) => {
      if (!paneFor(get(), sessionId)?.session) return
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
          set((state) => updatePaneSession(state, sessionId, () => data.session))
        }
        if (data.messages) {
          set((state) =>
            updatePane(state, sessionId, (p) => ({
              ...p,
              messages: data.messages,
              hiddenCount: (data.hiddenCount as number) ?? 0,
            })),
          )
        }
      } catch (error) {
        console.error('Error switching mode:', error)
      }
    },

    switchDangerLevel: async (sessionId, dangerLevel) => {
      if (!paneFor(get(), sessionId)?.session) return
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
          set((state) => updatePaneSession(state, sessionId, () => data.session))
        }
      } catch (error) {
        console.error('Error switching danger level:', error)
      }
    },

    editCriteria: async (sessionId, criteria) => {
      if (!paneFor(get(), sessionId)?.session) return
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

    compactContext: (sessionId) => {
      if (!paneFor(get(), sessionId)?.session) return
      wsClient.send('context.compact', { sessionId })
    },

    setSessionProvider: async (sessionId, providerId, model, reasoningEffort) => {
      try {
        if (!paneFor(get(), sessionId)?.session) return null
        const res = await authFetch(`/api/sessions/${sessionId}/provider`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId,
            ...(model ? { model } : {}),
            // An explicit null clears the session effort; undefined leaves it untouched.
            ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          }),
        })
        if (!res.ok) return null
        const data = await res.json()
        set((state) => {
          const prior = state.panes[sessionId] ?? paneFromFlat(state)
          const nextPane: SessionPane = {
            ...prior,
            session: data.session,
            messages: data.messages ?? prior.messages,
            hiddenCount: (data.hiddenCount as number | undefined) ?? prior.hiddenCount,
            contextState: data.contextState ?? prior.contextState,
          }
          return replacePane(state, sessionId, nextPane)
        })
        return data.session
      } catch {
        return null
      }
    },

    resetSessionProvider: async (sessionId) => {
      try {
        if (!paneFor(get(), sessionId)?.session) return null
        const res = await authFetch(`/api/sessions/${sessionId}/provider`, { method: 'DELETE' })
        if (!res.ok) return null
        const data = await res.json()
        set((state) => {
          const prior = state.panes[sessionId] ?? paneFromFlat(state)
          const nextPane: SessionPane = {
            ...prior,
            session: data.session,
            messages: data.messages ?? prior.messages,
            hiddenCount: (data.hiddenCount as number | undefined) ?? prior.hiddenCount,
          }
          return replacePane(state, sessionId, nextPane)
        })
        return data.session
      } catch {
        return null
      }
    },

    pinSessionEffort: async (sessionId, effort) => {
      try {
        if (!paneFor(get(), sessionId)?.session) return null
        const res = await authFetch(`/api/sessions/${sessionId}/pin-effort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ effort }),
        })
        if (!res.ok) return null
        const data = await res.json()
        set((state) => {
          const prior = state.panes[sessionId] ?? paneFromFlat(state)
          const nextPane: SessionPane = {
            ...prior,
            session: data.session,
            messages: data.messages ?? prior.messages,
            hiddenCount: (data.hiddenCount as number | undefined) ?? prior.hiddenCount,
          }
          return replacePane(state, sessionId, nextPane)
        })
        return data.session
      } catch {
        return null
      }
    },

    clearSessionEffortPin: async (sessionId) => {
      try {
        if (!paneFor(get(), sessionId)?.session) return null
        const res = await authFetch(`/api/sessions/${sessionId}/pin-effort`, { method: 'DELETE' })
        if (!res.ok) return null
        const data = await res.json()
        set((state) => {
          const prior = state.panes[sessionId] ?? paneFromFlat(state)
          const nextPane: SessionPane = {
            ...prior,
            session: data.session,
            messages: data.messages ?? prior.messages,
            hiddenCount: (data.hiddenCount as number | undefined) ?? prior.hiddenCount,
          }
          return replacePane(state, sessionId, nextPane)
        })
        return data.session
      } catch {
        return null
      }
    },

    updateContextState: (contextState) => {
      const sid = get().focusedSessionId ?? get().currentSession?.id
      if (!sid) return
      set((s) => updatePane(s, sid, (p) => ({ ...p, contextState })))
    },

    updateSubAgentContextState: (subAgentId, context) => {
      const sid = get().focusedSessionId ?? get().currentSession?.id
      if (!sid) return
      set((s) =>
        updatePane(s, sid, (p) => ({
          ...p,
          subAgentContextStates: { ...p.subAgentContextStates, [subAgentId]: context },
        })),
      )
    },

    clearSubAgentContextState: (subAgentId) => {
      const sid = get().focusedSessionId ?? get().currentSession?.id
      if (!sid) return
      set((s) =>
        updatePane(s, sid, (p) => {
          const newStates = { ...p.subAgentContextStates }
          delete newStates[subAgentId]
          return { ...p, subAgentContextStates: newStates }
        }),
      )
    },

    confirmPath: async (sessionId, callId, approved, alwaysAllow = false) => {
      if (!paneFor(get(), sessionId)?.session) return
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

    answerQuestion: async (sessionId, callId, answer, skip?) => {
      if (!paneFor(get(), sessionId)?.session) return
      try {
        await authFetch(`/api/sessions/${sessionId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, answer, skip }),
        })
      } catch (error) {
        console.error('Error answering question:', error)
      }
      set((state) =>
        updatePane(state, sessionId, (p) => ({
          ...p,
          pendingQuestions: p.pendingQuestions.filter((q) => q.callId !== callId),
        })),
      )
    },

    queueAsap: async (sessionId, content, attachments, messageKind?) => {
      if (!paneFor(get(), sessionId)?.session) return
      await postMessage(sessionId, content, attachments, messageKind, set)
    },

    queueCompletion: async (sessionId, content, attachments, messageKind?) => {
      if (!paneFor(get(), sessionId)?.session) return
      await postMessage(sessionId, content, attachments, messageKind, set)
    },

    cancelQueued: async (sessionId, queueId) => {
      if (!paneFor(get(), sessionId)?.session) return
      try {
        const res = await authFetch(`/api/sessions/${sessionId}/queue/${queueId}`, {
          method: 'DELETE',
        })
        const data = await res.json()
        if (data.queueState) {
          set((state) => updatePane(state, sessionId, (p) => ({ ...p, queuedMessages: data.queueState })))
        }
      } catch (error) {
        console.error('Error canceling queued message:', error)
      }
    },

    clearError: () => {
      const sid = get().focusedSessionId ?? get().currentSession?.id
      if (!sid) return
      set((s) => updatePane(s, sid, (p) => ({ ...p, error: null })))
    },

    clearRestoredInput: (sessionId?: string | null) => {
      const sid = sessionId ?? get().focusedSessionId ?? get().currentSession?.id
      if (!sid) return
      set((s) => updatePane(s, sid, (p) => ({ ...p, restoredInput: null })))
    },

    resetPendingSessionCreate: () => {
      set({ pendingSessionCreate: false as boolean | string })
    },

    queueUpdate: (sessionId: string) => {
      set({ pendingUpdate: sessionId })
    },

    triggerPendingUpdate: () => {
      const pending = get().pendingUpdate
      if (!pending) return
      set({ pendingUpdate: null })
      wsClient.send('context.applyDynamic', { sessionId: pending })
    },

    handleServerMessage: (message) => {
      handleMessage(message, set, get)
    },
  }
})
