import { useRef } from 'react'
import { useSessionStore } from '../../stores/session'
import { XCloseIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'

/**
 * Mobile-only tab strip for the split view: one scrollable tab per open pane so
 * a phone user can hop between live sessions without opening a browser tab per
 * session. Panes themselves stay alive in the store — this only changes which
 * one is displayed.
 */
export function SessionTabStrip() {
  const t = useT()
  const openSessionIds = useSessionStore((state) => state.openSessionIds)
  const focusedSessionId = useSessionStore((state) => state.focusedSessionId)
  const panes = useSessionStore((state) => state.panes)
  const focusPane = useSessionStore((state) => state.focusPane)
  const closePane = useSessionStore((state) => state.closePane)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  if (openSessionIds.length === 0) return null

  return (
    <div
      data-testid="session-tab-strip"
      role="tablist"
      className="flex items-stretch gap-px overflow-x-auto bg-border border-r border-border flex-1 min-w-0"
    >
      {openSessionIds.map((sessionId) => {
        const pane = panes[sessionId]
        const focused = sessionId === focusedSessionId
        const isRunning = pane?.session?.isRunning ?? false
        const questions = pane?.pendingQuestions.length ?? 0
        const confirmations = pane?.pendingPathConfirmations.length ?? 0
        const attention = questions + confirmations
        const title = pane?.session?.metadata?.title ?? sessionId.slice(0, 8)

        return (
          <div
            key={sessionId}
            data-testid="session-tab"
            data-session={sessionId}
            data-focused={focused ? 'true' : 'false'}
            className={`flex items-center shrink-0 min-w-0 max-w-[62%] ${focused ? 'bg-primary' : 'bg-secondary'}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={focused}
              title={title}
              ref={(el) => {
                if (el) tabRefs.current.set(sessionId, el)
                else tabRefs.current.delete(sessionId)
              }}
              tabIndex={focused ? 0 : -1}
              onClick={() => {
                if (!focused) focusPane(sessionId)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  const next = openSessionIds[openSessionIds.indexOf(sessionId) + (e.key === 'ArrowRight' ? 1 : -1)]
                  if (!next) return
                  focusPane(next)
                  // Roving tabindex: DOM focus must follow the selection, or
                  // repeated presses would keep resolving from the same tab.
                  tabRefs.current.get(next)?.focus()
                }
              }}
              className={`flex items-center gap-1.5 px-2.5 h-8 min-w-0 cursor-pointer ${
                focused ? 'text-text-primary' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {isRunning ? (
                <span
                  data-testid="session-tab-running"
                  className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-400 animate-pulse"
                />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-muted/30" />
              )}
              <span className="text-xs truncate">{title}</span>
              {attention > 0 && (
                <span
                  data-testid="session-tab-attention"
                  className="shrink-0 text-[9px] font-medium text-amber-400"
                  title={t({
                    en: `${questions} question(s), ${confirmations} confirmation(s) pending`,
                    fr: `${questions} question(s), ${confirmations} confirmation(s) en attente`,
                  })}
                >
                  {questions > 0 ? `${questions}q` : ''}
                  {questions > 0 && confirmations > 0 ? ' ' : ''}
                  {confirmations > 0 ? `${confirmations}c` : ''}
                </span>
              )}
            </button>
            {focused && (
              <span
                role="button"
                tabIndex={0}
                data-testid="session-tab-close"
                onClick={() => closePane(sessionId)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  closePane(sessionId)
                }}
                className="p-1.5 pr-2.5 cursor-pointer text-text-muted hover:text-text-primary transition-colors shrink-0"
                title={t({ en: 'Close pane', fr: 'Fermer le panneau' })}
                aria-label={t({ en: 'Close pane', fr: 'Fermer le panneau' })}
              >
                <XCloseIcon className="w-3 h-3" />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
