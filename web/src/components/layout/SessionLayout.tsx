import type { ReactNode } from 'react'
import { useSessionStore } from '../../stores/session'
import { CriteriaEditor } from '../plan/CriteriaEditor'

interface SessionLayoutProps {
  children: ReactNode
  criteriaSidebarOpen: boolean
}

const CRITERIA_SIDEBAR_CLASSES = 'w-[320px] min-w-[320px] shrink-0 border-l border-border p-4 overflow-y-auto'

export function SessionLayout({ children, criteriaSidebarOpen }: SessionLayoutProps) {
  const session = useSessionStore(state => state.currentSession)
  
  return (
    <div className="flex h-full overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {children}
      </div>
      
      {/* Criteria Sidebar - auto-collapses on mobile/tablet, visible on desktop */}
      <aside
        className={`
          ${CRITERIA_SIDEBAR_CLASSES}
          hidden md:block
        `}
      >
        <CriteriaEditor criteria={session?.criteria ?? []} />
      </aside>
    </div>
  )
}