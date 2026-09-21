import { ScrollArea } from '../shared/ScrollArea'
import { ResizeHandle } from '../shared/ResizeHandle'
import { PluginZone } from '../plugins/PluginZone'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useScopedPaneState } from '../../stores/session/session-scope'
import { useResizable } from '../../hooks/useResizable'
import { useSidebarStore } from '../../stores/sidebar'
import { SessionSidebar } from '../plan/SessionSidebar'

interface SessionLayoutProps {
  children: ReactNode
  criteriaSidebarOpen?: boolean
  /** When true, render the criteria sidebar as an overlay. When false, inline. */
  criteriaSidebarOverlay?: boolean
  onCriteriaSidebarToggle?: () => void
  /** When set, resolve the session/workdir from this pane instead of the focused session. */
  sessionId?: string | null
}

export function SessionLayout({
  children,
  criteriaSidebarOpen = true,
  criteriaSidebarOverlay = false,
  onCriteriaSidebarToggle,
  sessionId,
}: SessionLayoutProps) {
  const session = useScopedPaneState(
    sessionId,
    (pane) => pane.session ?? null,
    (state) => state.currentSession,
    null,
  )

  const { width: rightSidebarWidth, handleMouseDown: handleResizeMouseDown } = useResizable({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 600,
    direction: 'right',
  })

  useEffect(() => {
    useSidebarStore.getState().setRightWidth(rightSidebarWidth)
  }, [rightSidebarWidth])

  return (
    <div className="relative h-full overflow-hidden">
      {/* Backdrop - overlay mode only, when sidebar is open */}
      {criteriaSidebarOpen && criteriaSidebarOverlay && (
        <div className="absolute inset-0 bg-secondary/50 z-40" onClick={onCriteriaSidebarToggle} />
      )}

      {/* Main Content */}
      <div className="flex h-full">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-secondary">
          <PluginZone
            id="session.content"
            context={{
              ...(session?.id ? { sessionId: session.id } : {}),
              ...(session?.workdir ? { workdir: session.workdir } : {}),
              ...(session?.projectId ? { projectId: session.projectId } : {}),
            }}
            className="flex-1 min-w-0 flex flex-col overflow-hidden"
          >
            {children}
          </PluginZone>
        </div>

        {criteriaSidebarOverlay ? (
          /* Overlay sidebar - floats over the feed so it keeps its full width */
          <aside
            className={`bg-secondary transition-all duration-300 ease-in-out absolute right-0 top-0 h-full z-50 ${
              criteriaSidebarOpen ? 'w-[320px] translate-x-0 border-l border-border' : 'w-[320px] translate-x-full'
            }`}
          >
            <div className="h-full p-4">
              <ScrollArea className="h-full">
                <SessionSidebar workdir={session?.workspace ?? session?.workdir} />
              </ScrollArea>
            </div>
          </aside>
        ) : criteriaSidebarOpen ? (
          /* Inline sidebar - flex item sharing the row with the feed */
          <aside className="shrink-0 border-l border-border bg-secondary relative" style={{ width: rightSidebarWidth }}>
            <ResizeHandle side="left" onMouseDown={handleResizeMouseDown} />
            <ScrollArea className="h-full p-4">
              <SessionSidebar workdir={session?.workspace ?? session?.workdir} />
            </ScrollArea>
          </aside>
        ) : (
          <aside className="w-0 shrink-0 overflow-hidden border-l-0" />
        )}
      </div>
    </div>
  )
}
