import { ScrollArea } from '../shared/ScrollArea'
import { ResizeHandle } from '../shared/ResizeHandle'
import type { ReactNode } from 'react'
import { useSessionStore } from '../../stores/session'
import { useResizable } from '../../hooks/useResizable'
import { SessionSidebar } from '../plan/SessionSidebar'
import type { Message } from '@shared/types.js'

interface SessionLayoutProps {
  children: ReactNode
  criteriaSidebarOpen?: boolean
  onCriteriaSidebarToggle?: () => void
  messages: Message[]
}

export function SessionLayout({
  children,
  criteriaSidebarOpen = true,
  onCriteriaSidebarToggle,
  messages,
}: SessionLayoutProps) {
  const session = useSessionStore((state) => state.currentSession)

  const { width: rightSidebarWidth, handleMouseDown: handleResizeMouseDown } = useResizable({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 600,
    direction: 'right',
  })

  return (
    <div className="relative h-full overflow-hidden">
      {/* Backdrop - mobile only, when sidebar is open */}
      {criteriaSidebarOpen && (
        <div className="fixed md:hidden inset-0 bg-secondary/50 z-40" onClick={onCriteriaSidebarToggle} />
      )}

      {/* Main Content */}
      <div className="flex h-full">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-secondary">{children}</div>

        {/* Session Sidebar - mobile: fixed overlay, desktop: flex item */}
        {criteriaSidebarOpen ? (
          <aside
            className="hidden md:block shrink-0 border-l border-border bg-secondary relative"
            style={{ width: rightSidebarWidth }}
          >
            <ResizeHandle side="left" onMouseDown={handleResizeMouseDown} />
            <ScrollArea className="h-full p-4">
              <SessionSidebar messages={messages} workdir={session?.workspace ?? session?.workdir} />
            </ScrollArea>
          </aside>
        ) : (
          <aside className="hidden md:block w-0 shrink-0 overflow-hidden border-l-0" />
        )}

        {/* Mobile sidebar - always rendered but conditionally visible */}
        <aside
          className={`
            md:hidden
            bg-secondary
            transition-all duration-300 ease-in-out
            fixed right-0 top-[32px] h-[calc(100vh-32px)] z-50
            ${criteriaSidebarOpen ? 'w-[320px] translate-x-0 border-l border-border' : 'w-[320px] translate-x-full'}
          `}
        >
          <div className="h-full p-4">
            <ScrollArea className="h-full">
              <SessionSidebar messages={messages} workdir={session?.workspace ?? session?.workdir} />
            </ScrollArea>
          </div>
        </aside>
      </div>
    </div>
  )
}
