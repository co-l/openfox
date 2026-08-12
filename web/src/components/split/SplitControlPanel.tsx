import { useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { ChevronUpIcon, ChevronDownIcon, XCloseIcon, PlusIcon } from '../shared/icons'
import { AggregateStats } from './AggregateStats'
import { SplitNewSessionModal } from './SplitNewSessionModal'
import type { SplitLayoutMode } from '../../lib/splitPersistence'
import type { SessionSummary } from '@shared/types.js'

function sessionLabel(sessionId: string, title: string | undefined): string {
  return title ?? sessionId.slice(0, 8)
}

interface SplitControlPanelProps {
  collapsed?: boolean
  layout: SplitLayoutMode
  onLayoutChange: (layout: SplitLayoutMode) => void
}

/**
 * Left control column of the split view: the open panes (with close and
 * reorder controls) followed by every session across projects — running first,
 * then most recent. Clicking a session opens it as a pane.
 */
export function SplitControlPanel({ collapsed = false, layout, onLayoutChange }: SplitControlPanelProps) {
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const openSessionIds = useSessionStore((state) => state.openSessionIds)
  const focusedSessionId = useSessionStore((state) => state.focusedSessionId ?? state.currentSession?.id)
  const panes = useSessionStore((state) => state.panes)
  const sessions = useSessionStore((state) => state.sessions)
  const focusPane = useSessionStore((state) => state.focusPane)
  const closePane = useSessionStore((state) => state.closePane)
  const reorderPane = useSessionStore((state) => state.reorderPane)
  const openPane = useSessionStore((state) => state.openPane)
  const isPaneOpen = useSessionStore((state) => state.isPaneOpen)
  const projects = useProjectStore((state) => state.projects)
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

  return (
    <aside
      data-testid="split-control-panel"
      className={`shrink-0 border-r border-border bg-secondary flex flex-col min-h-0 transition-[width] duration-200 ${
        collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-56'
      }`}
      aria-hidden={collapsed}
    >
      <div className="flex items-center gap-1 px-2 h-9 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">
          Split view
        </span>
        <span className="text-xs text-text-muted ml-auto">{openSessionIds.length}</span>
        <div className="flex items-center rounded bg-bg-tertiary p-0.5 ml-1" role="group" aria-label="Pane layout">
          <button
            type="button"
            onClick={() => onLayoutChange('columns')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              layout === 'columns'
                ? 'bg-accent-primary/25 text-text-primary'
                : 'text-text-muted hover:text-text-primary'
            }`}
            title="Stack panes as columns"
            aria-label="Columns layout"
            aria-pressed={layout === 'columns'}
          >
            Columns
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange('grid')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              layout === 'grid' ? 'bg-accent-primary/25 text-text-primary' : 'text-text-muted hover:text-text-primary'
            }`}
            title="Arrange panes in a grid"
            aria-label="Grid layout"
            aria-pressed={layout === 'grid'}
          >
            Grid
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pt-3 pb-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-1">Open panes</h2>
          {openSessionIds.length === 0 ? (
            <p className="text-xs text-text-muted">No panes open — pick a session below.</p>
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
                        title="Move pane left"
                        aria-label="Move pane left"
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
                        title="Move pane right"
                        aria-label="Move pane right"
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
                        title="Close pane"
                        aria-label="Close pane"
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
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Sessions</h2>
            <button
              type="button"
              onClick={() => setNewSessionOpen(true)}
              className="ml-auto p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title="New session"
              aria-label="New session"
            >
              <PlusIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          {sortedSessions.length === 0 ? (
            <p className="text-xs text-text-muted">No sessions yet.</p>
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
                    title={open ? 'Focus pane' : 'Open in split view'}
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
}
