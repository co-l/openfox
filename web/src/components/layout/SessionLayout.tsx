import type { ReactNode } from 'react'
import { useSessionStore } from '../../stores/session'
import { SummaryDisplay } from '../plan/SummaryDisplay'
import type { Message } from '@shared/types.js'

interface SessionLayoutProps {
  children: ReactNode
  criteriaSidebarOpen?: boolean
  onCriteriaSidebarToggle?: () => void
  messages: Message[]
}

export function SessionLayout({ children, criteriaSidebarOpen = true, onCriteriaSidebarToggle, messages }: SessionLayoutProps) {
  const session = useSessionStore(state => state.currentSession)

  return (
    <div className="relative h-full overflow-hidden">
      {/* Backdrop - mobile only, when sidebar is open */}
      {criteriaSidebarOpen && (
        <div
          className="fixed md:hidden inset-0 bg-black/50 z-40"
          onClick={onCriteriaSidebarToggle}
        />
      )}

      {/* Main Content */}
      <div className="flex h-full">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {children}
        </div>

        {/* Summary Sidebar - mobile: fixed overlay, desktop: flex item */}
        {criteriaSidebarOpen ? (
          <aside className="hidden md:block w-[320px] shrink-0 border-l border-border p-4 overflow-y-auto bg-bg-secondary">
            <SummaryDisplay summary={session?.summary ?? null} messages={messages} workdir={session?.workdir} />
          </aside>
        ) : (
          <aside className="hidden md:block w-0 shrink-0 overflow-hidden border-l-0" />
        )}

        {/* Mobile sidebar - always rendered but conditionally visible */}
        <aside
          className={`
            md:hidden
            p-4 overflow-y-auto bg-bg-secondary
            transition-all duration-300 ease-in-out
            fixed right-0 top-[32px] h-[calc(100vh-32px)] z-50
            ${criteriaSidebarOpen
              ? 'w-[320px] translate-x-0 border-l border-border'
              : 'w-[320px] translate-x-full'
            }
          `}
        >
          <SummaryDisplay summary={session?.summary ?? null} messages={messages} workdir={session?.workdir} />
        </aside>
      </div>
    </div>
  )
}
