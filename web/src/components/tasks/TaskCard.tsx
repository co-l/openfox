import { useState } from 'react'
import { Link } from 'wouter'
import { getLocale } from '@shared/i18n/index.js'
import type { ProjectTask, TaskStatus } from '@shared/types.js'
import type { AgentInfo } from '../../lib/agents-actions'
import { getAgentColor } from '../../lib/agents-actions'
import { useT } from '../../hooks/useT'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import { TaskScheduleBadge } from './TaskScheduleBadge'
import {
  EllipsisIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlayIcon,
  PauseIcon,
  CopyIcon,
  TrashIcon,
  EditSmallIcon,
  OpenExternalIcon,
  InfoIcon,
} from '../shared/icons'

/** Drag-and-drop callbacks shared by cards and columns. */
export interface TaskDragHandlers {
  onDragStart: (task: ProjectTask) => void
}

/** Interaction callbacks shared by cards and columns (columns forward them to cards). */
export interface TaskCallbacks {
  onEdit: (task: ProjectTask) => void
  onMove: (task: ProjectTask, to: TaskStatus) => void
  onMoveUp: (task: ProjectTask) => void
  onMoveDown: (task: ProjectTask) => void
  onDuplicate: (task: ProjectTask) => void
  onDelete: (task: ProjectTask) => void
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
  onDragStart,
  onDropOnCard,
  onOpenSession,
}: TaskCardProps) {
  const t = useT()
  const [showAudit, setShowAudit] = useState(false)

  const agent = agents.find((a) => a.id === task.agentId)
  const agentColor = task.agentId ? getAgentColor(agents, task.agentId) : undefined
  const images = task.attachments.filter((a) => a.mimeType.startsWith('image/'))
  const sessionToOpen = task.activeSessionId ?? task.sessionIds[task.sessionIds.length - 1]

  const menuItems: DropdownMenuItem[] = [
    {
      label: t({ en: 'Edit', fr: 'Modifier' }),
      icon: <EditSmallIcon className="w-3.5 h-3.5" />,
      onClick: () => onEdit(task),
    },
    {
      label: t({ en: 'History & evidence', fr: 'Historique et preuves' }),
      icon: <InfoIcon className="w-3.5 h-3.5" />,
      onClick: () => setShowAudit((prev) => !prev),
    },
    {
      label: (
        <div className="px-3 py-2 text-text-muted text-xs font-medium cursor-default">
          {t({ en: 'Move to…', fr: 'Déplacer vers…' })}
        </div>
      ),
      onClick: () => {},
    },
    { label: t({ en: 'To Do', fr: 'À faire' }), onClick: () => onMove(task, 'todo') },
    { label: t({ en: 'In Progress', fr: 'En cours' }), onClick: () => onMove(task, 'in_progress') },
    { label: t({ en: 'Done', fr: 'Terminé' }), onClick: () => onMove(task, 'done') },
    {
      label: t({ en: 'Move up', fr: 'Monter' }),
      icon: <ChevronUpIcon className="w-3.5 h-3.5" />,
      onClick: () => onMoveUp(task),
    },
    {
      label: t({ en: 'Move down', fr: 'Descendre' }),
      icon: <ChevronDownIcon className="w-3.5 h-3.5" />,
      onClick: () => onMoveDown(task),
    },
  ]

  const menuFooterItems: DropdownMenuItem[] = [
    {
      label: t({ en: 'Duplicate', fr: 'Dupliquer' }),
      icon: <CopyIcon className="w-3.5 h-3.5" />,
      onClick: () => onDuplicate(task),
    },
    {
      label: t({ en: 'Delete', fr: 'Supprimer' }),
      icon: <TrashIcon className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => onDelete(task),
    },
  ]

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
          {task.runState === 'running'
            ? t({ en: 'Running', fr: 'En cours' })
            : t(
                { en: 'Queued{{pos}}', fr: 'En file{{pos}}' },
                { pos: queuePosition !== undefined ? ` · ${queuePosition}` : '' },
              )}
        </span>
      )}

      <p className="pr-8 text-sm text-text-primary leading-relaxed line-clamp-3 break-words whitespace-pre-wrap">
        {task.prompt}
      </p>

      <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          items={menuItems}
          footerItems={menuFooterItems}
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
        {task.status === 'todo' && task.schedule && <TaskScheduleBadge schedule={task.schedule} />}
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
