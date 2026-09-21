import { useSessionScope, useScopedPaneState } from '../stores/session/session-scope'

/** The active session's project workdir (pane-aware; falls back to the focused session). */
export function useSessionWorkdir(): string | undefined {
  const sessionId = useSessionScope()
  return useScopedPaneState(
    sessionId,
    (pane) => pane.session?.workdir ?? undefined,
    (state) => state.currentSession?.workdir,
    undefined,
  )
}
