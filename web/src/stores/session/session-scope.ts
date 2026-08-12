import { createContext, useCallback, useContext } from 'react'
import { useSessionStore } from '../session'
import { wsClient } from '../../lib/ws'
import type { SessionPane, SessionState } from './types'

/**
 * Resolves the session a component's actions should target. Wrapped by
 * SessionScopeProvider inside split panes; outside a pane it falls back to the
 * focused session so existing single-session components keep working.
 */
export const SessionScopeContext = createContext<string | null>(null)

export const SessionScopeProvider = SessionScopeContext.Provider

export function useSessionScope(): string | null {
  const scoped = useContext(SessionScopeContext)
  const focused = useSessionStore((state) => state.focusedSessionId ?? state.currentSession?.id ?? null)
  return scoped || focused
}

/**
 * Select a per-session field with a flat fallback: when the scoped session is
 * still flat-backed (pane not yet materialized, or legacy test seeding), read
 * the focused flat field instead of returning a bare default.
 */
export function useScopedPaneState<T>(
  scopeId: string | null | undefined,
  pick: (pane: SessionPane) => T,
  flatPick: (state: SessionState) => T,
  fallback: T,
): T {
  return useSessionStore((state) => {
    if (scopeId) {
      const pane = state.panes?.[scopeId]
      if (pane) return pick(pane)
      if (state.currentSession?.id === scopeId) return flatPick(state)
      return fallback
    }
    return flatPick(state)
  })
}

/**
 * Context state and session for the current pane (or the focused session when
 * not inside a split pane). Shared by the components that render the dynamic
 * context (system prompt) UI.
 */
export function useScopedContext() {
  const sessionId = useSessionScope()
  const contextState = useScopedPaneState(
    sessionId,
    (pane) => pane.contextState ?? null,
    (state) => state.contextState,
    null,
  )
  const currentSession = useScopedPaneState(
    sessionId,
    (pane) => pane.session ?? null,
    (state) => state.currentSession,
    null,
  )
  return { sessionId, contextState, currentSession }
}

/**
 * Apply dynamic context changes for the current pane's session: queues the
 * update while the session is running (applied when it stops) or sends it
 * immediately otherwise.
 */
export function useApplyDynamicContext() {
  const sessionId = useSessionScope()
  const queueUpdate = useSessionStore((state) => state.queueUpdate)
  return useCallback(
    (isRunning: boolean) => {
      if (isRunning) {
        if (sessionId) queueUpdate(sessionId)
      } else {
        wsClient.send('context.applyDynamic', { ...(sessionId ? { sessionId } : {}) })
      }
    },
    [sessionId, queueUpdate],
  )
}
