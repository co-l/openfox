import type { ReactNode } from 'react'
import { useSessionStore } from '../../stores/session'
import { CriteriaEditor } from '../plan/CriteriaEditor'

interface SessionLayoutProps {
  children: ReactNode
  criteriaEditable?: boolean
  validationStatus?: ReactNode
}

const CRITERIA_SIDEBAR_CLASSES = 'w-[640px] min-w-[640px] shrink-0 border-l border-border p-4 overflow-y-auto'

export function SessionLayout({ 
  children, 
  criteriaEditable = false,
  validationStatus 
}: SessionLayoutProps) {
  const session = useSessionStore(state => state.currentSession)
  const editCriteria = useSessionStore(state => state.editCriteria)
  const acceptCriteria = useSessionStore(state => state.acceptCriteria)
  
  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {children}
      </div>
      
      {/* Criteria Sidebar */}
      <div className={CRITERIA_SIDEBAR_CLASSES}>
        <CriteriaEditor
          criteria={session?.criteria ?? []}
          editable={criteriaEditable}
          onUpdate={editCriteria}
          onAccept={acceptCriteria}
        />
        {validationStatus}
      </div>
    </div>
  )
}
