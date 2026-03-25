import type { ReactNode } from 'react'
import { useSessionStore } from '../../stores/session'
import { SummaryDisplay } from '../plan/SummaryDisplay'
import type { Message } from '@shared/types.js'

interface SessionLayoutProps {
  children: ReactNode
  criteriaSidebarOpen?: boolean
  messages: Message[]
}

const SUMMARY_SIDEBAR_CLASSES = 'w-[320px] min-w-[320px] shrink-0 border-l border-border p-4 overflow-y-auto'

export function SessionLayout({ children, criteriaSidebarOpen = true, messages }: SessionLayoutProps) {
  const session = useSessionStore(state => state.currentSession)
  
  return (
    <div className="flex h-full overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {children}
      </div>
      
      {/* Summary Sidebar - auto-collapses on mobile/tablet, visible on desktop when criteriaSidebarOpen is true */}
      <aside
        className={`
          ${SUMMARY_SIDEBAR_CLASSES}
          hidden md:block
          ${criteriaSidebarOpen ? 'md:block' : 'md:hidden'}
        `}
      >
        <SummaryDisplay summary={session?.summary ?? null} messages={messages} workdir={session?.workdir} />
      </aside>
    </div>
  )
}
