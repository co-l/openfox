import type { Session } from '@shared/types.js'
import type { SessionState, SessionPane } from './types'

export function emptyPane(): SessionPane {
  return {
    session: null,
    messages: [],
    hiddenCount: 0,
    currentTodos: [],
    contextState: null,
    subAgentContextStates: {},
    pendingPathConfirmations: [],
    pendingQuestions: [],
    visionFallbackByMessage: {},
    queuedMessages: [],
    abortInProgress: false,
    restoredInput: null,
    activeWorkflowExecution: null,
    gitStatus: null,
    error: null,
    llmRetry: null,
    liveTurnStats: null,
  }
}

/** Materialize a pane from the flat (legacy focused) fields. */
export function paneFromFlat(state: SessionState): SessionPane {
  return {
    session: state.currentSession,
    messages: state.messages,
    hiddenCount: state.hiddenCount,
    currentTodos: state.currentTodos,
    contextState: state.contextState,
    subAgentContextStates: state.subAgentContextStates,
    pendingPathConfirmations: state.pendingPathConfirmations,
    pendingQuestions: state.pendingQuestions,
    visionFallbackByMessage: state.visionFallbackByMessage,
    queuedMessages: state.queuedMessages,
    abortInProgress: state.abortInProgress,
    restoredInput: state.restoredInput,
    activeWorkflowExecution: state.activeWorkflowExecution,
    gitStatus: state.gitStatus,
    error: state.error,
    llmRetry: state.llmRetry,
    liveTurnStats: state.liveTurnStats,
  }
}

/** Mirror a pane back into the flat "current" aliases. */
export function mirror(pane: SessionPane): Partial<SessionState> {
  return {
    currentSession: pane.session,
    messages: pane.messages,
    hiddenCount: pane.hiddenCount,
    currentTodos: pane.currentTodos,
    contextState: pane.contextState,
    subAgentContextStates: pane.subAgentContextStates,
    pendingPathConfirmations: pane.pendingPathConfirmations,
    pendingQuestions: pane.pendingQuestions,
    visionFallbackByMessage: pane.visionFallbackByMessage,
    queuedMessages: pane.queuedMessages,
    abortInProgress: pane.abortInProgress,
    restoredInput: pane.restoredInput,
    activeWorkflowExecution: pane.activeWorkflowExecution,
    gitStatus: pane.gitStatus,
    error: pane.error,
    llmRetry: pane.llmRetry,
    liveTurnStats: pane.liveTurnStats,
  }
}

/**
 * The session the "current" aliases represent. Falls back to the legacy
 * `currentSession` so pre-split tests and flows keep behaving identically.
 */
export function effectiveFocusedId(state: SessionState): string | null {
  return state.focusedSessionId ?? state.currentSession?.id ?? null
}

// Resolve a session's projectId from any source available in state: the
// sessions list, the live pane, or the current session. Used to scope
// post-mutation reloads to the right project instead of fetching globally.
export function resolveSessionProjectId(state: SessionState, sessionId: string): string | undefined {
  const summary = state.sessions.find((s) => s.id === sessionId)
  if (summary?.projectId) return summary.projectId
  const pane = state.panes[sessionId]
  if (pane?.session?.projectId) return pane.session.projectId
  if (state.currentSession?.id === sessionId && state.currentSession.projectId) {
    return state.currentSession.projectId
  }
  return undefined
}

/** True when the session is focused or already an open pane (live updates). */
export function isLivePane(state: SessionState, sessionId: string | undefined): boolean {
  if (!sessionId) return false
  return effectiveFocusedId(state) === sessionId || state.panes[sessionId] !== undefined
}

/**
 * Apply an incremental update to a pane. When the session is focused but no
 * pane exists yet (legacy single-session flow), it is materialized from the
 * flat fields first, updated, then mirrored back — net behaviour is identical
 * to the old flat-only store.
 */
export function updatePane(
  state: SessionState,
  sessionId: string,
  updater: (pane: SessionPane) => SessionPane,
): SessionState {
  const pane = state.panes[sessionId]
  const focused = effectiveFocusedId(state) === sessionId
  if (!pane) {
    if (!focused) return state
    const next = updater(paneFromFlat(state))
    return {
      ...state,
      panes: { ...state.panes, [sessionId]: next },
      ...mirror(next),
    }
  }
  const next = updater(pane)
  const base = { ...state, panes: { ...state.panes, [sessionId]: next } }
  return focused ? { ...base, ...mirror(next) } : base
}

/** Replace a whole pane (session.state / REST load). */
export function replacePane(state: SessionState, sessionId: string, pane: SessionPane): SessionState {
  const focused = effectiveFocusedId(state) === sessionId
  const base = { ...state, panes: { ...state.panes, [sessionId]: pane } }
  return focused ? { ...base, ...mirror(pane) } : base
}

/** Update only the session object inside a pane. */
export function updatePaneSession(
  state: SessionState,
  sessionId: string,
  updater: (session: Session) => Session,
): SessionState {
  return updatePane(state, sessionId, (pane) => (pane.session ? { ...pane, session: updater(pane.session) } : pane))
}

/**
 * Remove a pane. If it was focused, focus the last remaining pane (or clear
 * the focus entirely when no panes are left).
 */
export function dropPane(state: SessionState, sessionId: string): SessionState {
  if (state.panes[sessionId] === undefined && state.openSessionIds.includes(sessionId) === false) {
    return state
  }
  const panes = { ...state.panes }
  delete panes[sessionId]
  const openSessionIds = state.openSessionIds.filter((id) => id !== sessionId)
  let focusedSessionId = state.focusedSessionId
  let flat: Partial<SessionState> = {}
  if (state.focusedSessionId === sessionId) {
    focusedSessionId = openSessionIds.length > 0 ? openSessionIds[openSessionIds.length - 1]! : null
    flat = focusedSessionId ? mirror(panes[focusedSessionId] ?? emptyPane()) : mirror(emptyPane())
  }
  return {
    ...state,
    panes,
    openSessionIds,
    focusedSessionId,
    ...flat,
  }
}
