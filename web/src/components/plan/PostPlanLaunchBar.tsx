import { useState } from 'react'
import { useLocation } from 'wouter'
import type { ProjectTask, WorkflowScope } from '@shared/types.js'
import type { WorkflowInfo } from '../../lib/workflows-actions'
import { useT } from '../../hooks/useT'
import { useTasksStore } from '../../stores/tasks'
import { columnMeta } from '../tasks/column-meta'
import { AutoLaunchCountdown } from './AutoLaunchCountdown'
import { WorkflowButton } from './WorkflowButton'
import { hexToRgba } from '../../lib/colors'

interface PostPlanLaunchBarProps {
  /** The board task this session planned, resolved from the task_links table. */
  task: ProjectTask
  projectId: string
  workflows: WorkflowInfo[]
  onLaunchWorkflow: (
    workflowId: string,
    subGroup?: string,
    params?: Record<string, string>,
    scope?: WorkflowScope,
  ) => void
  /** Pending favorite-workflow countdown for this session (rendered under its button). */
  autoLaunch?: { workflowId: string; deadline: number } | null
  onCancelAutoLaunch?: () => void
}

/**
 * Post-plan decision bar shown in a planner session once the plan workflow is
 * done: row 1 holds the column decisions (stay in To Do / switch to In
 * Progress), row 2 lists every workflow as a launch button. A workflow pick is
 * persisted on the task and launches it directly here.
 */
export function PostPlanLaunchBar({
  task,
  projectId,
  workflows,
  onLaunchWorkflow,
  autoLaunch,
  onCancelAutoLaunch,
}: PostPlanLaunchBarProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const moveTask = useTasksStore((s) => s.moveTask)
  const setWorkflowChoice = useTasksStore((s) => s.setWorkflowChoice)
  const lastError = useTasksStore((s) => s.lastError)
  const clearError = useTasksStore((s) => s.clearError)
  const [busy, setBusy] = useState(false)
  const [moveFailed, setMoveFailed] = useState(false)

  const todoColor = columnMeta('todo').stripeHex
  const inProgressColor = columnMeta('in_progress').stripeHex

  const switchToInProgress = async () => {
    setBusy(true)
    setMoveFailed(false)
    clearError()
    try {
      // The move resumes THIS session into the build (picked workflow when
      // set): stay in it — no navigation. Without a free slot or with the
      // queue paused, the task simply parks in the queue. Gate-blocked moves
      // fail here; surface the reason inline instead of failing silently.
      const result = await moveTask(projectId, task.id, 'in_progress')
      if (!result) setMoveFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const stayInTodo = async () => {
    // Already In Progress: demote back to To Do (sessions stay linked, just
    // deactivated), otherwise this just opens the board.
    if (task.status !== 'todo') {
      setBusy(true)
      try {
        await moveTask(projectId, task.id, 'todo')
      } finally {
        setBusy(false)
      }
    }
    navigate(`/p/${projectId}`)
  }

  const pickAndLaunch = (workflowId: string, subGroup?: string, scope?: WorkflowScope) => {
    void setWorkflowChoice(projectId, task.id, workflowId)
    onLaunchWorkflow(workflowId, subGroup, undefined, scope)
  }

  return (
    <div
      data-testid="post-plan-launch-bar"
      className="feed-item rounded-lg border border-border bg-bg-secondary/60 p-3 space-y-2"
    >
      <div className="flex justify-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => void stayInTodo()}
          disabled={busy}
          data-testid="post-plan-stay-todo"
          className="px-4 py-1.5 text-sm font-medium rounded border transition-colors disabled:opacity-50"
          style={{
            color: todoColor,
            borderColor: hexToRgba(todoColor, 0.3),
            backgroundColor: hexToRgba(todoColor, 0.12),
          }}
        >
          {t({ en: 'Stay in To Do', fr: 'Rester en À faire' })}
        </button>
        <button
          type="button"
          onClick={() => void switchToInProgress()}
          disabled={busy}
          data-testid="post-plan-switch-inprogress"
          className="px-4 py-1.5 text-sm font-medium rounded border transition-colors disabled:opacity-50"
          style={{
            color: inProgressColor,
            borderColor: hexToRgba(inProgressColor, 0.3),
            backgroundColor: hexToRgba(inProgressColor, 0.12),
          }}
        >
          {t({ en: 'Switch to In Progress', fr: 'Passer en En cours' })}
        </button>
      </div>
      {moveFailed && (
        <div data-testid="post-plan-move-error" className="text-xs text-red-400 text-center">
          {lastError ?? t({ en: 'Move failed', fr: 'Échec du déplacement' })}
        </div>
      )}
      <div className="pt-2 border-t border-border/60">
        <div className="text-xs text-text-muted mb-1.5 text-center">
          {t({ en: 'Or attach a workflow and launch it now:', fr: 'Ou attacher un workflow et le lancer :' })}
        </div>
        <div className="flex justify-center gap-2 flex-wrap items-start">
          {workflows.map((w) => {
            const c = w.color ?? '#3b82f6'
            return (
              <div
                key={`${w.id}-${w.scope}`}
                className="flex flex-col items-center gap-1"
                data-testid={`post-plan-workflow-${w.id}`}
              >
                <WorkflowButton
                  workflowName={w.name}
                  scope={w.scope}
                  color={c}
                  bg={hexToRgba(c, 0.12)}
                  bgHover={hexToRgba(c, 0.22)}
                  border={hexToRgba(c, 0.25)}
                  subGroups={w.subGroups}
                  onLaunch={(subGroup?: string) => pickAndLaunch(w.id, subGroup, w.scope)}
                />
                {autoLaunch?.workflowId === w.id && onCancelAutoLaunch && (
                  <AutoLaunchCountdown deadline={autoLaunch.deadline} color={c} onCancel={onCancelAutoLaunch} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
