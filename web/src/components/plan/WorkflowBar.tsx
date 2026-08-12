import { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'

export function WorkflowBar() {
  const sessionId = useSessionScope()
  const activeWorkflowExecution = useScopedPaneState(
    sessionId,
    (pane) => pane.activeWorkflowExecution ?? null,
    (state) => state.activeWorkflowExecution,
    null,
  )
  const exitWorkflow = useSessionStore((state) => state.exitWorkflow)
  const [exiting, setExiting] = useState(false)

  // Reset exiting state when a new workflow execution appears
  useEffect(() => {
    setExiting(false)
  }, [activeWorkflowExecution?.id])

  const handleExit = useCallback(() => {
    if (exiting || !sessionId) return
    setExiting(true)
    exitWorkflow(sessionId)
  }, [exiting, exitWorkflow, sessionId])

  if (!activeWorkflowExecution) return null
  if (activeWorkflowExecution.status !== 'running' && activeWorkflowExecution.status !== 'waiting') return null

  const color =
    activeWorkflowExecution.workflowColor && /^#[0-9a-fA-F]{6}$/.test(activeWorkflowExecution.workflowColor)
      ? activeWorkflowExecution.workflowColor
      : '#3b82f6'

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="font-medium text-text-primary truncate">{activeWorkflowExecution.workflowName}</span>
      {activeWorkflowExecution.currentStepName && (
        <>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted truncate">{activeWorkflowExecution.currentStepName}</span>
        </>
      )}
      <div className="ml-auto shrink-0">
        <button
          onClick={handleExit}
          disabled={exiting}
          className="text-xs px-2 py-0.5 rounded text-text-tool-error hover:bg-text-tool-error/10 transition-colors disabled:opacity-50"
        >
          {exiting ? 'Exiting...' : '✕ Exit'}
        </button>
      </div>
    </div>
  )
}
