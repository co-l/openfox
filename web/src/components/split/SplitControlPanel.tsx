import { useEffect, useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { useProjects } from '../../hooks/useProjects'
import { ChevronUpIcon, ChevronDownIcon, XCloseIcon, PlusIcon } from '../shared/icons'
import { AggregateStats } from './AggregateStats'
import { SplitNewSessionModal } from './SplitNewSessionModal'
import type { SplitLayoutMode } from '../../lib/splitPersistence'
import type { SessionSummary } from '@shared/types.js'
import { useT } from '../../hooks/useT'

function sessionLabel(sessionId: string, title: string | undefined): string {
  return title ?? sessionId.slice(0, 8)
}

interface SplitControlPanelProps {
  collapsed?: boolean
  layout: SplitLayoutMode
  onLayoutChange: (layout: SplitLayoutMode) => void
  /**
   * Render as a bottom sheet overlaying the panes instead of an inline column.
   * A phone-width w-56 column would starve the chat, so the sheet takes the
   * panel out of the horizontal flow entirely.
   */
  mobile?: boolean
  /** Called when the sheet is dismissed (backdrop tap, close button, Escape). */
  onClose?: () => void
}

/**
 * Left control column of the split view: the open panes (with close and
 * reorder controls) followed by every session across projects — running first,
 * then most recent. Clicking a session opens it as a pane.
 */
export function SplitControlPanel({
  collapsed = false,
  layout,
  onLayoutChange,
  mobile = false,
  onClose,
}: SplitControlPanelProps) {
  const t = useT()
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const sheetOpen = mobile && !collapsed

  useEffect(() => {
    if (!sheetOpen || !onClose) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sheetOpen, onClose])
  const openSessionIds = useSessionStore((state) => state.openSessionIds)
  const focusedSessionId = useSessionStore((state) => state.focusedSessionId ?? state.currentSession?.id)
  const panes = useSessionStore((state) => state.panes)
  const sessions = useSessionStore((state) => state.sessions)
  const focusPane = useSessionStore((state) => state.focusPane)
  const closePane = useSessionStore((state) => state.closePane)
  const reorderPane = useSessionStore((state) => state.reorderPane)
  const openPane = useSessionStore((state) => state.openPane)
  const isPaneOpen = useSessionStore((state) => state.isPaneOpen)
  const { projects } = useProjects()
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [sessions])

  const handleSessionClick = (session: SessionSummary) => {
    if (isPaneOpen(session.id)) {
      focusPane(session.id)
    } else {
      void openPane(session.id, { focus: true })
    }
  }

  // On mobile the panel body becomes a bottom sheet: a dimmed backdrop closes
  // it on tap, and Escape / the close button are wired above. The inline column
  // keeps its exact desktop markup.
  const body = (
    <aside
      data-testid="split-control-panel"
      className={
        mobile
          ? // h-full is required: as a block-level child of the fixed-height
            // sheet dialog the aside would otherwise size to its content and
            // the inner scroller would never get a bounded height.
            'flex h-full flex-col min-h-0 w-full bg-secondary'
          : `shrink-0 border-r border-border bg-secondary flex flex-col min-h-0 transition-[width] duration-200 ${
              collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-56'
            }`
      }
      aria-hidden={!mobile && collapsed}
    >
      {mobile && (
        <div className="relative flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 top-1.5 w-9 h-1 rounded-full bg-border"
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">
            {t({ en: 'Split view', fr: 'Vue divisée' })}
          </span>
          <span className="text-xs text-text-muted">{openSessionIds.length}</span>
          <button
            type="button"
            data-testid="split-sheet-close"
            onClick={() => onClose?.()}
            className="ml-auto p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={t({ en: 'Close', fr: 'Fermer' })}
            aria-label={t({ en: 'Close', fr: 'Fermer' })}
          >
            <XCloseIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className={`flex items-center gap-1 px-2 h-9 border-b border-border shrink-0 ${mobile ? 'hidden' : ''}`}>
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">
          {t({ en: 'Split view', fr: 'Vue divisée' })}
        </span>
        <span className="text-xs text-text-muted ml-auto">{openSessionIds.length}</span>
        <div
          className="flex items-center rounded bg-bg-tertiary p-0.5 ml-1"
          role="group"
          aria-label={t({ en: 'Pane layout', fr: 'Disposition des panneaux' })}
        >
          <button
            type="button"
            onClick={() => onLayoutChange('columns')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              layout === 'columns'
                ? 'bg-accent-primary/25 text-text-primary'
                : 'text-text-muted hover:text-text-primary'
            }`}
            title={t({ en: 'Stack panes as columns', fr: 'Empiler les panneaux en colonnes' })}
            aria-label={t({ en: 'Columns layout', fr: 'Disposition en colonnes' })}
            aria-pressed={layout === 'columns'}
          >
            {t({ en: 'Columns', fr: 'Colonnes' })}
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange('grid')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              layout === 'grid' ? 'bg-accent-primary/25 text-text-primary' : 'text-text-muted hover:text-text-primary'
            }`}
            title={t({ en: 'Arrange panes in a grid', fr: 'Disposer les panneaux en grille' })}
            aria-label={t({ en: 'Grid layout', fr: 'Disposition en grille' })}
            aria-pressed={layout === 'grid'}
          >
            {t({ en: 'Grid', fr: 'Grille' })}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pt-3 pb-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-1">
            {t({ en: 'Open panes', fr: 'Panneaux ouverts' })}
          </h2>
          {openSessionIds.length === 0 ? (
            <p className="text-xs text-text-muted">
              {t({
                en: 'No panes open — pick a session below.',
                fr: 'Aucun panneau ouvert — choisissez une session ci-dessous.',
              })}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {openSessionIds.map((sessionId, index) => {
                const focused = sessionId === focusedSessionId
                const title = sessionLabel(sessionId, panes[sessionId]?.session?.metadata?.title)
                return (
                  <li
                    key={sessionId}
                    className={`group flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer ${
                      focused ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
                    }`}
                    onClick={() => focusPane(sessionId)}
                    data-open-pane={sessionId}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        focused ? 'bg-accent-primary' : 'bg-text-muted/40'
                      }`}
                    />
                    <span className="text-xs text-text-primary truncate flex-1 min-w-0" title={title}>
                      {title}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          reorderPane(sessionId, -1)
                        }}
                        disabled={index === 0}
                        className="p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-default"
                        title={t({ en: 'Move pane left', fr: 'Déplacer le panneau à gauche' })}
                        aria-label={t({ en: 'Move pane left', fr: 'Déplacer le panneau à gauche' })}
                      >
                        <ChevronUpIcon className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          reorderPane(sessionId, 1)
                        }}
                        disabled={index === openSessionIds.length - 1}
                        className="p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-default"
                        title={t({ en: 'Move pane right', fr: 'Déplacer le panneau à droite' })}
                        aria-label={t({ en: 'Move pane right', fr: 'Déplacer le panneau à droite' })}
                      >
                        <ChevronDownIcon className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          closePane(sessionId)
                        }}
                        className="p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary"
                        title={t({ en: 'Close pane', fr: 'Fermer le panneau' })}
                        aria-label={t({ en: 'Close pane', fr: 'Fermer le panneau' })}
                      >
                        <XCloseIcon className="w-3 h-3" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-3 pt-3 pb-4 border-t border-border">
          <AggregateStats />
        </div>

        <div className="px-3 pt-3 pb-4 border-t border-border">
          <div className="flex items-center mb-1">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {t({ en: 'Sessions', fr: 'Sessions' })}
            </h2>
            <button
              type="button"
              onClick={() => setNewSessionOpen(true)}
              className="ml-auto p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title={t({ en: 'New session', fr: 'Nouvelle session' })}
              aria-label={t({ en: 'New session', fr: 'Nouvelle session' })}
            >
              <PlusIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          {sortedSessions.length === 0 ? (
            <p className="text-xs text-text-muted">
              {t({ en: 'No sessions yet.', fr: 'Aucune session pour l’instant.' })}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {sortedSessions.map((session) => {
                const open = isPaneOpen(session.id)
                return (
                  <li
                    key={session.id}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer hover:bg-bg-tertiary/50"
                    onClick={() => handleSessionClick(session)}
                    data-session-item={session.id}
                    title={
                      open
                        ? t({ en: 'Focus pane', fr: 'Se concentrer sur le panneau' })
                        : t({ en: 'Open in split view', fr: 'Ouvrir en vue divisée' })
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        session.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-text-muted/40'
                      }`}
                    />
                    <span className="text-xs text-text-primary truncate flex-1 min-w-0">
                      {sessionLabel(session.id, session.title)}
                    </span>
                    <span className="text-[9px] text-accent-primary truncate max-w-[60px] shrink-0">
                      {projectById.get(session.projectId)?.name ?? session.projectId.slice(0, 8)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      <SplitNewSessionModal isOpen={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
    </aside>
  )

  if (!mobile) return body

  if (!sheetOpen) return null

  return (
    <div data-testid="split-sheet" data-modal-root="true" className="fixed inset-0 z-50 flex items-end">
      <div
        data-testid="split-sheet-backdrop"
        aria-hidden="true"
        onClick={() => onClose?.()}
        className="absolute inset-0 bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t({ en: 'Split view controls', fr: 'Contrôles de la vue divisée' })}
        className="relative w-full h-[85vh] max-h-[85vh] rounded-t-xl overflow-hidden shadow-2xl"
      >
        {body}
      </div>
    </div>
  )
}
