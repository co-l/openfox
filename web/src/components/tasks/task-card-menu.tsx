import type { ProjectTask, TaskStatus } from '@shared/types.js'
import type { WorkflowInfo } from '../../lib/workflows-actions'
import type { useT } from '../../hooks/useT'
import type { DropdownMenuItem } from '../shared/DropdownMenu'
import { COLUMN_META, COLUMN_ORDER, columnMeta } from './column-meta'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EditSmallIcon,
  InfoIcon,
  MoveTargetLeftIcon,
  MoveTargetRightIcon,
  PlayIcon,
  TrashIcon,
} from '../shared/icons'

type T = ReturnType<typeof useT>

/** Interaction callbacks shared by cards, columns and the card menu. */
export interface CardActionCallbacks {
  onEdit: (task: ProjectTask) => void
  onMove: (task: ProjectTask, to: TaskStatus) => void
  onMoveUp: (task: ProjectTask) => void
  onMoveDown: (task: ProjectTask) => void
  onDuplicate: (task: ProjectTask) => void
  onDelete: (task: ProjectTask) => void
}

export interface CardMenuDeps extends CardActionCallbacks {
  t: T
  task: ProjectTask
  projectId: string
  workflows: WorkflowInfo[]
  onToggleAudit: () => void
  moveTask: (projectId: string, taskId: string, to: TaskStatus) => Promise<unknown>
  setWorkflowChoice: (projectId: string, taskId: string, workflowId: string | null) => Promise<unknown>
}

function headerItem(label: string): DropdownMenuItem {
  return { label: <span className="cursor-default text-xs font-semibold uppercase tracking-wide">{label}</span> }
}

/** Post-plan section: column decision then a workflow to launch with. */
export function buildPostPlanMenuItems(deps: CardMenuDeps): DropdownMenuItem[] {
  const { t, task, projectId, workflows, moveTask, setWorkflowChoice } = deps
  return [
    headerItem(t({ en: 'After plan', fr: 'Après le plan' })),
    {
      label: t({ en: 'Stay in To Do', fr: 'Rester en À faire' }),
      icon: <ChevronUpIcon className="w-3.5 h-3.5 rotate-45" />,
      stripeHex: columnMeta('todo').stripeHex,
      // Parity with the post-plan bar's decision row (spec): acknowledging
      // "stay" keeps the card parked — a deliberate confirmation, not a move.
      onClick: () => void moveTask(projectId, task.id, 'todo'),
    },
    {
      label: t({ en: 'Switch to In Progress', fr: 'Passer en En cours' }),
      icon: <PlayIcon className="w-3.5 h-3.5" />,
      stripeHex: columnMeta('in_progress').stripeHex,
      // Same semantics as the post-plan bar: launch when a slot is free and
      // the queue is not paused, otherwise park in the queue. The transitions
      // section drops its own In Progress entry while this runs, so it is
      // never a duplicate.
      onClick: () => void moveTask(projectId, task.id, 'in_progress'),
    },
    ...workflows.map<DropdownMenuItem>((w) => ({
      label: w.name,
      icon: <PlayIcon className="w-3.5 h-3.5" />,
      stripeHex: w.color ?? '#3b82f6',
      onClick: () => {
        // The launch resolves its workflow from the persisted choice — record
        // it first, then move; a failed PUT must not silently launch stale.
        void setWorkflowChoice(projectId, task.id, w.id).then(() => moveTask(projectId, task.id, 'in_progress'))
      },
    })),
  ]
}

/** Transitions list: the card's own column becomes a decorative position bar. */
export function buildTransitionMenuItems(deps: Pick<CardMenuDeps, 't' | 'task' | 'onMove'>): DropdownMenuItem[] {
  const { t, task, onMove } = deps
  return COLUMN_META.flatMap<DropdownMenuItem>((c) => {
    const targetIndex = COLUMN_ORDER.indexOf(c.status)
    const currentIndex = COLUMN_ORDER.indexOf(task.status)
    if (c.status === task.status) {
      // The card's own column: the no-op move entry becomes a full-width
      // horizontal position bar in the column's color, marking where the
      // task currently sits between its neighbours.
      return [{ label: '', decorativeBar: true, stripeClass: c.stripeClass }]
    }
    return [
      {
        label: t(c.title),
        icon:
          targetIndex < currentIndex ? (
            <MoveTargetLeftIcon className="w-3.5 h-3.5" />
          ) : (
            <MoveTargetRightIcon className="w-3.5 h-3.5" />
          ),
        stripeClass: c.stripeClass,
        onClick: () => onMove(task, c.status),
      },
    ]
  })
}

/** Body of the card menu (everything above Duplicate/Delete). */
export function buildCardMenuItems(deps: CardMenuDeps): DropdownMenuItem[] {
  const { t, task, onEdit, onToggleAudit, onMoveUp, onMoveDown } = deps
  const showPostPlan = !!task.planned && (task.status === 'todo' || task.status === 'in_progress')
  // While the post-plan "Switch to In Progress" entry is up, the transitions
  // section must not repeat the same move — but the own-column decorative bar
  // (identical stripe in in_progress) always stays.
  const transitions = buildTransitionMenuItems(deps).filter(
    (item) => !showPostPlan || item.decorativeBar || item.stripeClass !== columnMeta('in_progress').stripeClass,
  )
  return [
    {
      label: t({ en: 'Edit', fr: 'Modifier' }),
      icon: <EditSmallIcon className="w-3.5 h-3.5" />,
      onClick: () => onEdit(task),
    },
    {
      label: t({ en: 'History & evidence', fr: 'Historique et preuves' }),
      icon: <InfoIcon className="w-3.5 h-3.5" />,
      onClick: onToggleAudit,
    },
    ...transitions,
    ...(showPostPlan ? buildPostPlanMenuItems(deps) : []),
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
}

/** Danger-zone footer of the card menu. */
export function buildCardMenuFooterItems(deps: CardMenuDeps): DropdownMenuItem[] {
  const { t, task, onDuplicate, onDelete } = deps
  return [
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
}
