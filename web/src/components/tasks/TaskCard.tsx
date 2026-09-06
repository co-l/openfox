import { useState } from 'react'
import { Link } from 'wouter'
import { getLocale } from '@shared/i18n/index.js'
import type { ProjectTask } from '@shared/types.js'
import type { AgentInfo } from '../../lib/agents-actions'
import { getAgentColor } from '../../lib/agents-actions'
import { useT } from '../../hooks/useT'
import { useSetting } from '../../hooks/useSetting'
import { useProject } from '../../hooks/useProject'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useProjects } from '../../hooks/useProjects'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useTasksStore } from '../../stores/tasks'
import { DropdownMenu } from '../shared/DropdownMenu'
import {
  buildCardMenuItems,
  buildCardMenuFooterItems,
  type CardActionCallbacks,
  type CardMenuDeps,
} from './task-card-menu'
import { EllipsisIcon, PlayIcon, PauseIcon, OpenExternalIcon } from '../shared/icons'

type T = ReturnType<typeof useT>

/** Shared "Running / Queued · n" status label (card badge and edit-menu bar). */
function runStateLabel(t: T, task: ProjectTask, queuePosition?: number): string {
  return task.runState === 'running'
    ? t({ en: 'Running', fr: 'En cours' })
    : t(
        { en: 'Queued{{pos}}', fr: 'En file{{pos}}' },
        { pos: queuePosition !== undefined ? ` · ${queuePosition}` : '' },
      )
}

/** Drag-and-drop callbacks shared by cards and columns. */
export interface TaskDragHandlers {
  onDragStart: (task: ProjectTask) => void
}

/** Interaction callbacks shared by cards and columns (columns forward them to cards). */
export interface TaskCallbacks extends CardActionCallbacks {
  onStartPlan: (task: ProjectTask) => void
  onDropOnCard: (task: ProjectTask) => void
  /** Invoked when a card's session link is opened (lets a host modal dismiss itself). */
  onOpenSession?: (sessionId: string) => void
}

interface TaskCardProps extends TaskDragHandlers, TaskCallbacks {
  task: ProjectTask
  projectId: string
  agents: AgentInfo[]
  queuePosition?: number
}

export function TaskCard({
  task,
  projectId,
  agents,
  queuePosition,
  onEdit,
  onMove,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onStartPlan,
  onDragStart,
  onDropOnCard,
  onOpenSession,
}: TaskCardProps) {
  const t = useT()
  const [showAudit, setShowAudit] = useState(false)

  // A configured favorite workflow auto-picks the build after planning, so
  // the manual "Start" entry point is hidden in that case.
  const { project } = useProject(projectId)
  const globalFavorite = useSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW).value
  const hasFavoriteWorkflow = !!(project?.favoriteWorkflowId ?? globalFavorite)

  const moveTask = useTasksStore((s) => s.moveTask)
  const setWorkflowChoice = useTasksStore((s) => s.setWorkflowChoice)
  const { projects } = useProjects()
  const workdir = projects.find((p) => p.id === projectId)?.workdir
  const { workflows } = useWorkflows(workdir)

  const agent = agents.find((a) => a.id === task.agentId)
  const agentColor = task.agentId ? getAgentColor(agents, task.agentId) : undefined
  const images = task.attachments.filter((a) => a.mimeType.startsWith('image/'))
  const sessionToOpen = task.activeSessionId ?? task.sessionIds[task.sessionIds.length - 1]

  const menuDeps: CardMenuDeps = {
    t,
    task,
    projectId,
    workflows,
    onEdit,
    onToggleAudit: () => setShowAudit((prev) => !prev),
    onMove,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onDelete,
    moveTask,
    setWorkflowChoice,
  }

  return (
    <div
      draggable
      onClick={() => onEdit(task)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(task)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnCard(task)
      }}
      className={`group relative cursor-pointer bg-bg-tertiary border border-border rounded-lg p-2.5 hover:border-accent-primary/40 transition-colors ${
        task.status === 'in_progress' ? 'ring-1 ring-inset ring-accent-primary/20' : ''
      }`}
    >
      {task.status === 'in_progress' && (
        <span
          className={`mb-1.5 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
            task.runState === 'running' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          {task.runState === 'running' ? <PlayIcon className="w-2.5 h-2.5" /> : <PauseIcon className="w-2.5 h-2.5" />}
          {runStateLabel(t, task, queuePosition)}
        </span>
      )}

      <p className="pr-8 text-sm text-text-primary leading-relaxed line-clamp-3 break-words whitespace-pre-wrap">
        {task.prompt}
      </p>

      <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          items={buildCardMenuItems(menuDeps)}
          footerItems={buildCardMenuFooterItems(menuDeps)}
          minWidth="176px"
          align="right"
          trigger={
            <button
              type="button"
              className="p-1 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title={t({ en: 'Task actions', fr: 'Actions de la tâche' })}
              aria-label={`Actions for ${task.prompt.slice(0, 40)}`}
            >
              <EllipsisIcon className="w-4 h-4" />
            </button>
          }
        />
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {task.status === 'todo' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStartPlan(task)
            }}
            className="text-xs px-1.5 py-1 rounded bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 flex items-center gap-1"
          >
            <PlayIcon className="w-2.5 h-2.5" /> {t({ en: 'Start plan', fr: 'Démarrer le plan' })}
          </button>
        )}
        {task.status === 'todo' && task.planned && !hasFavoriteWorkflow && sessionToOpen && (
          <Link
            href={`/p/${projectId}/s/${sessionToOpen}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenSession?.(sessionToOpen)
            }}
            className="text-xs px-1.5 py-1 rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 flex items-center gap-1"
          >
            <PlayIcon className="w-2.5 h-2.5" /> {t({ en: 'Start', fr: 'Démarrer' })}
          </Link>
        )}
        {task.attachments.length > 0 && (
          <span
            className="text-xs text-text-muted flex items-center gap-1"
            title={t(
              {
                en: { one: '{{count}} attachment', other: '{{count}} attachments' },
                fr: { one: '{{count}} pièce jointe', other: '{{count}} pièces jointes' },
              },
              { count: task.attachments.length },
            )}
          >
            {`📎 ${task.attachments.length}`}
          </span>
        )}
        {images.length > 0 && (
          <span className="flex -space-x-1">
            {images.slice(0, 3).map((img) => (
              <img
                key={img.id}
                src={img.data}
                alt={''}
                className="w-6 h-6 rounded object-cover ring-2 ring-bg-tertiary"
              />
            ))}
          </span>
        )}
        {task.model && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-text-muted truncate max-w-36"
            title={task.model}
          >
            {task.model}
          </span>
        )}
        {agent && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-bg-secondary border border-border flex items-center gap-1"
            style={{ color: agentColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agentColor }} />
            {agent.name}
          </span>
        )}
        {sessionToOpen && (
          <Link
            href={`/p/${projectId}/s/${sessionToOpen}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenSession?.(sessionToOpen)
            }}
            className="ml-auto text-xs px-1.5 py-1 rounded bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 flex items-center gap-1"
          >
            {t({ en: 'Open session', fr: 'Ouvrir la session' })} <OpenExternalIcon className="w-2.5 h-2.5" />
          </Link>
        )}
      </div>

      {showAudit && task.auditTrail.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t({ en: 'History', fr: 'Historique' })}
          </div>
          {task.auditTrail.map((entry) => (
            <div key={entry.id} className="text-xs text-text-muted leading-relaxed">
              <span className="text-text-primary">{entry.action}</span>
              {entry.detail && <span> — {entry.detail}</span>}
              <span className="text-text-muted/70">
                {' '}
                · {entry.actor}
                {entry.actorName && entry.actorName !== entry.actor ? ` (${entry.actorName})` : ''} ·{' '}
                {new Date(entry.timestamp).toLocaleString(getLocale())}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
