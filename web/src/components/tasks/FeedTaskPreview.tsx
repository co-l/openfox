import { useMemo, useState } from 'react'
import { useTasksStore } from '../../stores/tasks'
import { useResource } from '../../hooks/useResource'
import { boardResource } from '../../lib/resources'
import { Button } from '../shared/Button'
import { TasksIcon, ArrowRightIcon } from '../shared/icons'
import { TasksModal } from './TasksModal'
import type { ProjectTask } from '@shared/types.js'
import { useT } from '../../hooks/useT'

const MAX_VISIBLE_TASKS = 4

interface FeedTaskPreviewProps {
  projectId: string
  /** The session whose empty feed shows the launchpad — Start hosts the task here. */
  sessionId: string
}

/**
 * "Up next" — the empty-feed launchpad. Shown only when the feed has no
 * messages and at least one open, unclaimed task exists. Lists the topmost
 * unclaimed To Do cards (not bound to a session); each row claims and starts
 * its task with one click, and a Manage tasks button opens the full board.
 */
export function FeedTaskPreview({ projectId, sessionId }: FeedTaskPreviewProps) {
  const t = useT()
  const { data: board } = useResource(boardResource, projectId)
  const tasks = board?.tasks ?? []
  const moveTask = useTasksStore((state) => state.moveTask)
  const lastError = useTasksStore((state) => state.lastError)

  const [tasksModalOpen, setTasksModalOpen] = useState(false)
  const [queuedNotice, setQueuedNotice] = useState<{ label: string } | null>(null)

  const nextTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'todo' && t.sessionIds.length === 0)
        .sort((a, b) => a.position - b.position)
        .slice(0, MAX_VISIBLE_TASKS),
    [tasks],
  )

  const runningCount = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && t.runState === 'running').length,
    [tasks],
  )

  if (nextTasks.length === 0) return null

  const startTask = async (task: ProjectTask) => {
    setQueuedNotice(null)
    // Host the task in the session we're already in — no orphan session, no
    // navigation. If it queues, the server keeps the earmark so auto-launch
    // still lands here.
    const result = await moveTask(projectId, task.id, 'in_progress', { sessionId })
    if (result?.task && result.task.status === 'in_progress' && result.task.runState === 'queued') {
      setQueuedNotice({ label: task.prompt.split('\n')[0]?.slice(0, 60) || t({ en: 'This task', fr: 'Cette tâche' }) })
    }
  }

  return (
    <div className="mx-auto max-w-xl w-full">
      <div className="rounded-lg border border-border bg-bg-secondary/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            <TasksIcon className="w-3.5 h-3.5" />
            {t({ en: 'Up next', fr: 'À suivre' })}
            {runningCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-emerald-400"
                title={t(
                  {
                    en: { one: '{{count}} task currently running', other: '{{count}} tasks currently running' },
                    fr: { one: '{{count}} tâche en cours d’exécution', other: '{{count}} tâches en cours d’exécution' },
                  },
                  { count: runningCount },
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t({ en: '{{count}} running', fr: '{{count}} en cours' }, { count: runningCount })}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => setTasksModalOpen(true)}>
            {t({ en: 'Manage tasks', fr: 'Gérer les tâches' })}
          </Button>
        </div>

        {queuedNotice && (
          <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-text-primary">
                {t(
                  {
                    en: '“{{label}}” is queued — it’ll start automatically when a slot frees.',
                    fr: '« {{label}} » est en file — elle démarrera automatiquement dès qu’un emplacement se libère.',
                  },
                  { label: queuedNotice.label },
                )}
              </p>
              <button
                type="button"
                onClick={() => setQueuedNotice(null)}
                title={t({ en: 'Dismiss', fr: 'Ignorer' })}
                className="shrink-0 text-xs text-text-muted underline hover:text-text-primary transition-colors"
              >
                {t({ en: 'Dismiss', fr: 'Ignorer' })}
              </button>
            </div>
          </div>
        )}

        <ul className="mt-3 space-y-2">
          {nextTasks.map((task, index) => (
            <li
              key={task.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg-secondary px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-medium leading-snug line-clamp-2 break-words whitespace-pre-wrap">
                  {task.prompt}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                  {task.attachments.length > 0 && <span>{`📎 ${task.attachments.length}`}</span>}
                  {task.model && (
                    <span className="px-1.5 py-0.5 rounded bg-bg-tertiary border border-border">{task.model}</span>
                  )}
                </div>
              </div>
              <Button
                variant={index === 0 ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => void startTask(task)}
                className="shrink-0 flex items-center gap-1"
              >
                {t({ en: 'Start', fr: 'Démarrer' })} <ArrowRightIcon className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>

        {lastError && <div className="mt-3 text-sm text-accent-error">{lastError}</div>}
      </div>

      <TasksModal isOpen={tasksModalOpen} onClose={() => setTasksModalOpen(false)} projectId={projectId} />
    </div>
  )
}
