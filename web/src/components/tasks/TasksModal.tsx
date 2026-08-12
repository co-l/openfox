import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLocation } from 'wouter'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { ConfirmModal } from '../shared/ConfirmModal'
import { PauseIcon, PlayIcon, SearchIcon, PlusIcon } from '../shared/icons'
import { useTasksStore } from '../../stores/tasks'
import { useAgents } from '../../hooks/useAgents'
import { useProjectStore } from '../../stores/project'
import { ModalCrumbTitle } from '../shared/ModalCrumbTitle'
import { TaskColumn } from './TaskColumn'
import { TaskEditor } from './TaskEditor'
import { GatesEditor } from './GatesEditor'
import type { ProjectTask, TaskStatus } from '@shared/types.js'

interface TasksModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
}

export function TasksModal({ isOpen, onClose, projectId }: TasksModalProps) {
  const [, navigate] = useLocation()
  const tasks = useTasksStore((state) => state.tasks)
  const settings = useTasksStore((state) => state.settings)
  const loadBoard = useTasksStore((state) => state.loadBoard)
  const loadGates = useTasksStore((state) => state.loadGates)
  const moveTask = useTasksStore((state) => state.moveTask)
  const reorderTask = useTasksStore((state) => state.reorderTask)
  const deleteTask = useTasksStore((state) => state.deleteTask)
  const duplicateTask = useTasksStore((state) => state.duplicateTask)
  const setSettings = useTasksStore((state) => state.setSettings)
  const lastError = useTasksStore((state) => state.lastError)
  const project = useProjectStore((state) => state.projects.find((p) => p.id === projectId))

  const { agents, fetchAgents } = useAgents()

  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; task: ProjectTask } | null>(null)
  const [gatesOpen, setGatesOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProjectTask | null>(null)

  const draggedRef = useRef<{ task: ProjectTask } | null>(null)

  useEffect(() => {
    if (isOpen) {
      void loadBoard(projectId)
      void loadGates(projectId)
      // Agents load lazily elsewhere; refresh so card chips render even when
      // the board is opened from the homepage.
      void fetchAgents()
    }
  }, [isOpen, projectId, loadBoard, loadGates, fetchAgents])

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.prompt.toLowerCase().includes(q))
  }, [tasks, search])

  const byColumn = useMemo(() => {
    const todo = filteredTasks.filter((t) => t.status === 'todo').sort((a, b) => a.position - b.position)
    const inProgress = filteredTasks
      .filter((t) => t.status === 'in_progress')
      .sort((a, b) => {
        if ((a.runState === 'running') !== (b.runState === 'running')) return a.runState === 'running' ? -1 : 1
        return a.position - b.position
      })
    const done = filteredTasks.filter((t) => t.status === 'done').sort((a, b) => a.position - b.position)
    return { todo, in_progress: inProgress, done }
  }, [filteredTasks])

  const queueRank = useMemo(() => {
    // Unfiltered: search must not skew queue positions or the header counters.
    const queued = tasks
      .filter((t) => t.status === 'in_progress' && t.runState === 'queued')
      .sort((a, b) => a.position - b.position)
    const map = new Map<string, number>()
    queued.forEach((t, i) => map.set(t.id, i + 1))
    return map
  }, [tasks])

  const runningCount = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && t.runState === 'running').length,
    [tasks],
  )
  const queuedCount = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && t.runState === 'queued').length,
    [tasks],
  )

  const queuePositionOf = useCallback(
    (task: ProjectTask) => {
      if (task.runState !== 'queued') return undefined
      // Server truth first (the tool and modal agree); client rank as a
      // streaming fallback while the pushed snapshot is settling.
      if (task.queuePosition !== undefined) return task.queuePosition
      return queueRank.get(task.id)
    },
    [queueRank],
  )

  const handleMove = useCallback(
    async (task: ProjectTask, to: TaskStatus) => {
      const result = await moveTask(projectId, task.id, to)
      // Human drag/Start-task claims a NEW session — navigate the user to it.
      if (result?.sessionId) {
        navigate(`/p/${projectId}/s/${result.sessionId}`)
      }
    },
    [moveTask, projectId, navigate],
  )

  const handleDropOnColumn = useCallback(
    async (to: TaskStatus) => {
      const dragged = draggedRef.current
      draggedRef.current = null
      if (!dragged) return
      if (dragged.task.status === to) return
      await handleMove(dragged.task, to)
    },
    [handleMove],
  )

  const handleDropOnCard = useCallback(
    async (target: { task: ProjectTask }) => {
      const dragged = draggedRef.current
      draggedRef.current = null
      if (!dragged || dragged.task.id === target.task.id) return
      const index = byColumn[target.task.status].findIndex((t) => t.id === target.task.id)
      if (index < 0) return
      if (dragged.task.status === target.task.status) {
        await reorderTask(projectId, dragged.task.id, target.task.status, index)
      } else {
        await handleMove(dragged.task, target.task.status)
        await reorderTask(projectId, dragged.task.id, target.task.status, index)
      }
    },
    [byColumn, reorderTask, projectId, handleMove],
  )

  const handleMoveUp = useCallback(
    (task: ProjectTask) => {
      const index = byColumn[task.status].findIndex((t) => t.id === task.id)
      if (index > 0) void reorderTask(projectId, task.id, task.status, index - 1)
    },
    [byColumn, reorderTask, projectId],
  )

  const handleMoveDown = useCallback(
    (task: ProjectTask) => {
      const index = byColumn[task.status].findIndex((t) => t.id === task.id)
      if (index >= 0 && index < byColumn[task.status].length - 1)
        void reorderTask(projectId, task.id, task.status, index + 1)
    },
    [byColumn, reorderTask, projectId],
  )

  const handleDuplicate = useCallback(
    (task: ProjectTask) => {
      void duplicateTask(projectId, task.id)
    },
    [duplicateTask, projectId],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await deleteTask(projectId, deleteTarget.id)
    setDeleteTarget(null)
  }, [deleteTarget, deleteTask, projectId])

  const adjustSlot = (delta: number) => {
    // Read the freshest value: closures over the render-scoped `settings` can
    // be stale between rapid clicks, making +/− appear to skip or ignore
    // presses.
    const current = useTasksStore.getState().settings.slotLimit
    const next = Math.max(1, Math.min(10, current + delta))
    if (next !== current) void setSettings(projectId, { slotLimit: next })
  }

  const togglePause = () => {
    const paused = useTasksStore.getState().settings.queuePaused
    void setSettings(projectId, { queuePaused: !paused })
  }

  const columnProps = {
    projectId,
    agents,
    queuePositionOf,
    onEdit: (task: ProjectTask) => setEditor({ mode: 'edit', task }),
    onMove: (task: ProjectTask, to: TaskStatus) => void handleMove(task, to),
    onMoveUp: handleMoveUp,
    onMoveDown: handleMoveDown,
    onDuplicate: handleDuplicate,
    onDelete: (task: ProjectTask) => setDeleteTarget(task),
    onDragStart: (task: ProjectTask) => {
      draggedRef.current = { task }
    },
    onOpenSession: () => onClose(),
  }

  const renderColumn = (status: TaskStatus) => {
    const meta = {
      todo: {
        title: 'To Do',
        accentClass: 'border-t-2 border-t-blue-500/60',
      },
      in_progress: {
        title: 'In Progress',
        accentClass: 'border-t-2 border-t-amber-500/60',
        hint: 'Moving a task here starts it automatically.',
      },
      done: {
        title: 'Done',
        accentClass: 'border-t-2 border-t-emerald-500/60',
      },
    }[status]!

    return (
      <TaskColumn
        key={status}
        title={meta.title}
        accentClass={meta.accentClass}
        hint={'hint' in meta ? meta.hint : undefined}
        tasks={byColumn[status]}
        headerAction={
          status === 'todo' ? (
            <Button variant="primary" onClick={() => setEditor({ mode: 'create' })}>
              <PlusIcon className="w-4 h-4 mr-1 inline-block" /> New Task
            </Button>
          ) : status === 'done' ? (
            <Button onClick={() => setGatesOpen(true)}>Gates</Button>
          ) : undefined
        }
        footer={status === 'in_progress' ? queueFooter : undefined}
        onDropOnColumn={() => void handleDropOnColumn(status)}
        onDropOnCard={(task) => void handleDropOnCard({ task })}
        {...columnProps}
      />
    )
  }

  const queueFooter = (
    <div className="px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text-muted">Parallel slots</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => adjustSlot(-1)}
            disabled={settings.slotLimit <= 1}
            aria-label="Decrease slot limit"
            className="w-7 h-7 rounded-md bg-bg-tertiary border border-border text-text-primary text-lg leading-none hover:bg-border disabled:opacity-40 disabled:hover:bg-bg-tertiary transition-colors"
          >
            −
          </button>
          <span
            className="w-9 text-center text-sm font-semibold text-text-primary tabular-nums"
            title="Parallel-slot limit"
          >
            {settings.slotLimit}
          </span>
          <button
            type="button"
            onClick={() => adjustSlot(1)}
            disabled={settings.slotLimit >= 10}
            aria-label="Increase slot limit"
            className="w-7 h-7 rounded-md bg-bg-tertiary border border-border text-text-primary text-lg leading-none hover:bg-border disabled:opacity-40 disabled:hover:bg-bg-tertiary transition-colors"
          >
            +
          </button>
        </div>
      </div>

      <div className="pt-3 border-t border-border/70">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-text-muted" title="Active tasks / limit">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <strong className="text-text-primary tabular-nums">{runningCount}</strong> / {settings.slotLimit} running
            </span>
            {queuedCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <strong className="text-text-primary tabular-nums">{queuedCount}</strong> queued
              </span>
            )}
          </span>
          <Button
            size="sm"
            onClick={togglePause}
            className={`shrink-0 flex items-center gap-1 whitespace-nowrap border ${
              settings.queuePaused
                ? 'border-amber-400/40 text-amber-400 hover:bg-amber-400/10'
                : 'border-border text-text-muted hover:bg-bg-tertiary'
            }`}
            title={settings.queuePaused ? 'Resume auto-launch of queued tasks' : 'Pause auto-launch of queued tasks'}
          >
            {settings.queuePaused ? <PlayIcon className="w-3 h-3" /> : <PauseIcon className="w-3 h-3" />}
            {settings.queuePaused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={<ModalCrumbTitle projectName={project?.name ?? projectId}>Tasks</ModalCrumbTitle>}
        size="full"
        showCloseButton
        closeOnBackdropClick
        scrollable={false}
        headerRight={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 min-w-0 sm:min-w-64">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks…"
                className="pl-7 pr-2 w-full text-sm"
              />
            </div>
          </div>
        }
      >
        {lastError && (
          <div className="mb-2 px-3 py-2 rounded bg-accent-error/10 border border-accent-error/30 text-sm text-accent-error flex items-center justify-between">
            <span>{lastError}</span>
            <button
              type="button"
              onClick={() => useTasksStore.setState({ lastError: null })}
              className="text-sm underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex gap-3 overflow-x-auto pb-2 h-full">
          {renderColumn('todo')}
          {renderColumn('in_progress')}
          {renderColumn('done')}
        </div>
      </Modal>

      {editor && (
        <TaskEditor
          projectId={projectId}
          initialTask={editor.mode === 'edit' ? editor.task : null}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}

      {gatesOpen && <GatesEditor projectId={projectId} onClose={() => setGatesOpen(false)} />}

      {deleteTarget && (
        <ConfirmModal
          isOpen
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
          title="Delete task?"
          message={`“${deleteTarget.prompt.slice(0, 60)}” will be removed from the board. Its sessions and history stay untouched.`}
          confirmLabel="Delete task"
          confirmVariant="danger"
        />
      )}
    </>
  )
}
