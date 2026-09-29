import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { SessionPane } from './SessionPane'
import { SessionTabStrip } from './SessionTabStrip'
import { SplitControlPanel } from './SplitControlPanel'
import { readSplitLayoutMode, writeSplitLayoutMode } from '../../lib/splitPersistence'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useT } from '../../hooks/useT'
import { MenuIcon } from '../shared/icons'

/** Opens the mobile session picker. Lives in a row of its own, never floating
 *  over the chat composer (whose send button sits bottom-right on phones). */
function SheetTrigger({ onClick }: { onClick: () => void }) {
  const t = useT()
  const openCount = useSessionStore((state) => state.openSessionIds.length)
  return (
    <button
      type="button"
      data-testid="split-sheet-open"
      onClick={onClick}
      className="flex items-center gap-1 px-2 h-full text-text-muted hover:text-text-primary transition-colors shrink-0 bg-secondary"
      title={t({ en: 'Sessions', fr: 'Sessions' })}
      aria-label={t({ en: 'Sessions', fr: 'Sessions' })}
    >
      <MenuIcon className="w-4 h-4" />
      <span className="text-xs tabular-nums">{openCount}</span>
    </button>
  )
}

interface SplitViewProps {
  /** When false the left control column collapses (toggled from the header). */
  controlOpen?: boolean
}

export function SplitView({ controlOpen = true }: SplitViewProps) {
  const t = useT()
  const openSessionIds = useSessionStore((state) => state.openSessionIds)
  const focusedSessionId = useSessionStore((state) => state.focusedSessionId ?? state.currentSession?.id)
  const focusPane = useSessionStore((state) => state.focusPane)
  const closePane = useSessionStore((state) => state.closePane)
  const listHomeSessions = useSessionStore((state) => state.listHomeSessions)
  const [layout, setLayout] = useState(readSplitLayoutMode)
  const isMobile = useIsMobile()

  // On mobile the control column is a bottom sheet, so its open state is local
  // to this component rather than driven by the desktop header toggle. It
  // starts closed: with no panes open the shell reports controlOpen=true to
  // keep the desktop column reachable, which would otherwise bury the whole
  // phone screen behind an 85vh sheet on first render.
  const [sheetOpen, setSheetOpen] = useState(false)
  const prevControlOpenRef = useRef(controlOpen)
  useEffect(() => {
    if (!isMobile) {
      setSheetOpen(controlOpen)
    } else if (!prevControlOpenRef.current && controlOpen) {
      setSheetOpen(true)
    }
    prevControlOpenRef.current = controlOpen
  }, [isMobile, controlOpen])

  useEffect(() => {
    writeSplitLayoutMode(layout)
  }, [layout])

  // Keep the control-panel session list fresh while the split view is the
  // active route. Sessions created, renamed or deleted in other windows — and
  // in other projects, which the server's session.created broadcast skips for
  // a differently-focused client — only reach this window via a poll.
  useEffect(() => {
    void listHomeSessions()
    const interval = setInterval(() => void listHomeSessions(), 20_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void listHomeSessions()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [listHomeSessions])

  const emptyState = (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm text-text-muted px-4 text-center">
        {isMobile
          ? t({
              en: 'No sessions open — tap the button below to pick one.',
              fr: 'Aucune session ouverte — appuyez sur le bouton ci-dessous pour en choisir une.',
            })
          : t({
              en: 'No panes open — pick a session on the left to open it in split view.',
              fr: 'Aucun panneau ouvert — choisissez une session à gauche pour l’ouvrir en vue divisée.',
            })}
      </p>
    </div>
  )

  // Mobile: one pane at a time behind a tab strip. Unfocused panes are left
  // unmounted on purpose — the WebSocket dispatches into panes[sessionId] in
  // the store, so their streaming and state survive being off screen.
  if (isMobile) {
    const focusedId = openSessionIds.includes(focusedSessionId ?? '') ? focusedSessionId : openSessionIds[0]
    return (
      <div className="flex-1 min-w-0 relative flex flex-col h-full min-h-0 bg-primary">
        {openSessionIds.length > 0 ? (
          <div className="flex items-stretch shrink-0 border-b border-border">
            <SessionTabStrip />
            <SheetTrigger onClick={() => setSheetOpen(true)} />
          </div>
        ) : (
          // No tabs yet: the trigger has to live on its own row so the picker
          // stays reachable without floating over the empty state.
          <div className="flex items-center justify-end h-8 px-2 border-b border-border shrink-0 bg-secondary">
            <SheetTrigger onClick={() => setSheetOpen(true)} />
          </div>
        )}
        {focusedId ? (
          <SessionPane
            // Keyed by session: without it React reuses the same
            // SessionPane → PlanPanel → ChatInput instance across tab switches,
            // leaking the previous session's draft into the new composer.
            key={focusedId}
            className="flex-1"
            sessionId={focusedId}
            focused
            onFocus={() => focusPane(focusedId)}
            onClose={() => closePane(focusedId)}
          />
        ) : (
          emptyState
        )}
        <SplitControlPanel
          mobile
          collapsed={!sheetOpen}
          layout={layout}
          onLayoutChange={setLayout}
          onClose={() => setSheetOpen(false)}
        />
      </div>
    )
  }

  const panesArea =
    openSessionIds.length === 0 ? (
      emptyState
    ) : layout === 'columns' ? (
      <div className="flex gap-px bg-border flex-1 min-w-0 min-h-0">
        {openSessionIds.map((sessionId) => {
          const focused = sessionId === focusedSessionId
          return (
            <SessionPane
              key={sessionId}
              className="flex-1"
              sessionId={sessionId}
              focused={focused}
              onFocus={() => focusPane(sessionId)}
              onClose={() => closePane(sessionId)}
            />
          )
        })}
      </div>
    ) : (
      <div
        className={`grid gap-px bg-border flex-1 min-w-0 min-h-0 ${
          openSessionIds.length <= 1 ? 'grid-cols-1' : 'grid-cols-2'
        }`}
      >
        {openSessionIds.map((sessionId) => {
          const focused = sessionId === focusedSessionId
          return (
            <SessionPane
              key={sessionId}
              sessionId={sessionId}
              focused={focused}
              onFocus={() => focusPane(sessionId)}
              onClose={() => closePane(sessionId)}
            />
          )
        })}
      </div>
    )

  return (
    <div className="flex-1 min-w-0 flex h-full min-h-0 bg-primary">
      <SplitControlPanel collapsed={!controlOpen} layout={layout} onLayoutChange={setLayout} />
      {panesArea}
    </div>
  )
}
