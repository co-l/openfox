import { memo } from 'react'
import { OptionalScrollArea } from './OptionalScrollArea'
import { useT } from '../../hooks/useT'
import type { Translation } from '@shared/i18n/index.js'

interface ProjectTasksViewProps {
  result: string
  action: string
}

interface TaskGate {
  gateId: string
  value: string
}

interface TaskView {
  id: string
  prompt: string
  status: string
  runState?: string
  queuePosition?: number
  boundSession?: string
  model?: string
  attachments?: number
  gates: TaskGate[]
}

interface GateConfigView {
  id: string
  name: string
  description: string
  required: boolean
  variant: string
}

interface ListData {
  gates?: GateConfigView[]
  tasks?: TaskView[]
}

const STATUS_META: Record<string, { label: Translation; className: string }> = {
  todo: {
    label: { en: 'To Do', fr: 'À faire' },
    className: 'bg-accent-warning/10 text-accent-warning border-accent-warning/30',
  },
  in_progress: {
    label: { en: 'In Progress', fr: 'En cours' },
    className: 'bg-accent-primary/10 text-accent-primary border-accent-primary/30',
  },
  done: {
    label: { en: 'Done', fr: 'Terminées' },
    className: 'bg-accent-success/10 text-accent-success border-accent-success/30',
  },
}

const SINGLE_TASK_ACTIONS = new Set(['get', 'create', 'edit', 'move', 'set_gate_value', 'duplicate', 'reorder'])

export const ProjectTasksView = memo(function ProjectTasksView({ result, action }: ProjectTasksViewProps) {
  const t = useT()
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    return <RawFallback result={result} />
  }

  if (action === 'list') {
    return (
      <OptionalScrollArea className="max-h-[60vh]">
        <Board data={parsed as ListData} t={t} />
      </OptionalScrollArea>
    )
  }
  if (action === 'set_gates') {
    const gates = (parsed as Record<string, unknown>)['gates']
    return (
      <OptionalScrollArea className="max-h-[60vh]">
        <GateList gates={Array.isArray(gates) ? (gates as GateConfigView[]) : []} t={t} />
      </OptionalScrollArea>
    )
  }
  if (action === 'delete') {
    const message = (parsed as Record<string, unknown>)['message']
    if (typeof message === 'string' && message.trim() !== '') {
      return <div className="text-xs text-text-primary">{message}</div>
    }
    return <RawFallback result={result} />
  }
  if (SINGLE_TASK_ACTIONS.has(action)) {
    return (
      <OptionalScrollArea className="max-h-[60vh]">
        <TaskCard task={parseTask(parsed)} t={t} />
      </OptionalScrollArea>
    )
  }
  return <RawFallback result={result} />
})

function RawFallback({ result }: { result: string }) {
  return (
    <OptionalScrollArea horizontal className="max-h-[60vh]">
      <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">{result}</pre>
    </OptionalScrollArea>
  )
}

function Board({
  data,
  t,
}: {
  data: ListData
  t: (tx: Translation, vars?: Record<string, string | number>) => string
}) {
  const tasks = (data.tasks ?? []).map(parseTask)
  const gates = data.gates ?? []
  const todo = tasks.filter((t) => t.status === 'todo')
  const inProgress = tasks.filter((t) => t.status === 'in_progress')
  const done = tasks.filter((t) => t.status === 'done')
  const other = tasks.filter((t) => t.status !== 'todo' && t.status !== 'in_progress' && t.status !== 'done')

  return (
    <div className="space-y-2 text-xs">
      <div className="text-text-muted">
        {t(
          {
            en: { one: 'Task board · {{count}} task', other: 'Task board · {{count}} tasks' },
            fr: { one: 'Tableau des tâches · {{count}} tâche', other: 'Tableau des tâches · {{count}} tâches' },
          },
          { count: tasks.length },
        )}
        {gates.length > 0 && (
          <span>
            {t(
              { en: ' — Gates: {{gates}}', fr: ' — Portes : {{gates}}' },
              {
                gates: gates
                  .map(
                    (g) =>
                      `${g.name} (${g.required ? t({ en: 'required', fr: 'requise' }) : t({ en: 'optional', fr: 'facultative' })})`,
                  )
                  .join(', '),
              },
            )}
          </span>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="text-text-muted italic">
          {t({ en: 'No tasks on the board', fr: 'Aucune tâche sur le tableau' })}
        </div>
      ) : (
        <>
          <Column title={t({ en: 'To Do', fr: 'À faire' })} tasks={todo} t={t} />
          <Column title={t({ en: 'In Progress', fr: 'En cours' })} tasks={inProgress} t={t} />
          <Column title={t({ en: 'Done', fr: 'Terminées' })} tasks={done} t={t} />
          <Column title={t({ en: 'Other', fr: 'Autres' })} tasks={other} t={t} />
        </>
      )}
    </div>
  )
}

function Column({
  title,
  tasks,
  t,
}: {
  title: string
  tasks: TaskView[]
  t: (tx: Translation, vars?: Record<string, string | number>) => string
}) {
  if (tasks.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="text-text-muted">
        {title} · {tasks.length}
      </div>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} t={t} />
      ))}
    </div>
  )
}

function TaskCard({
  task,
  t,
}: {
  task: TaskView
  t: (tx: Translation, vars?: Record<string, string | number>) => string
}) {
  const meta = STATUS_META[task.status] ?? null
  return (
    <div className="rounded-md border border-border bg-bg-tertiary px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta?.className ?? 'bg-bg-tertiary text-text-secondary border-border'}`}
        >
          {meta ? t(meta.label) : task.status}
        </span>
        {task.runState === 'running' && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-success/40 bg-accent-success/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
            {t({ en: 'Running', fr: 'En cours d’exécution' })}
          </span>
        )}
        {task.runState === 'queued' && (
          <span className="inline-flex items-center rounded border border-accent-warning/40 bg-accent-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-warning">
            {t({ en: 'Queued · #{{pos}}', fr: 'En file · #{{pos}}' }, { pos: task.queuePosition ?? 1 })}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-text-primary leading-snug break-words whitespace-pre-wrap line-clamp-3">
        {task.prompt}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
        {task.boundSession && (
          <span>{t({ en: 'Bound: {{session}}', fr: 'Liée à : {{session}}' }, { session: task.boundSession })}</span>
        )}
        {task.model && <span className="px-1.5 py-0.5 rounded bg-bg-secondary border border-border">{task.model}</span>}
        {task.attachments !== undefined && task.attachments > 0 && (
          <span>
            {t(
              {
                en: { one: '{{count}} attachment', other: '{{count}} attachments' },
                fr: { one: '{{count}} pièce jointe', other: '{{count}} pièces jointes' },
              },
              { count: task.attachments },
            )}
          </span>
        )}
        {task.gates.map((gate) => (
          <span key={gate.gateId} className="font-mono px-1.5 py-0.5 rounded border border-border bg-bg-secondary">
            {gate.gateId}: {gate.value}
          </span>
        ))}
      </div>
    </div>
  )
}

function GateList({
  gates,
  t,
}: {
  gates: GateConfigView[]
  t: (tx: Translation, vars?: Record<string, string | number>) => string
}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="text-text-muted mb-1">{t({ en: 'Gate configuration', fr: 'Configuration des portes' })}</div>
      {gates.length === 0 ? (
        <div className="text-text-muted italic">{t({ en: 'No gates configured', fr: 'Aucune porte configurée' })}</div>
      ) : (
        gates.map((gate) => (
          <div key={gate.id} className="flex items-start gap-2">
            <span className="font-mono text-accent-primary shrink-0">{gate.id}</span>
            <div className="min-w-0">
              <div className="text-text-primary">
                {gate.name}{' '}
                <span className="ml-0.5 px-1.5 py-0.5 rounded border border-border bg-bg-tertiary text-[10px]">
                  {gate.required ? t({ en: 'required', fr: 'requise' }) : t({ en: 'optional', fr: 'facultative' })}
                </span>
                {gate.variant && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded border border-border bg-bg-tertiary text-[10px]">
                    {gate.variant}
                  </span>
                )}
              </div>
              {gate.description && <div className="text-text-muted">{gate.description}</div>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNum(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function parseGates(raw: unknown): TaskGate[] {
  if (!Array.isArray(raw)) return []
  const gates: TaskGate[] = []
  for (const entry of raw) {
    const rec = asRecord(entry)
    if (!rec) continue
    const gateId = Object.keys(rec).find((key) => key !== 'actor' && key !== 'timestamp')
    if (!gateId) continue
    const value = rec[gateId]
    if (typeof value !== 'string') continue
    gates.push({ gateId, value })
  }
  return gates
}

function parseTask(raw: unknown): TaskView {
  const rec = asRecord(raw) ?? {}
  const runState = asStr(rec['runState'])
  const queuePosition = asNum(rec['queuePosition'])
  const attachments = asNum(rec['attachments'])
  return {
    id: asStr(rec['id']),
    prompt: asStr(rec['prompt']),
    status: asStr(rec['status']),
    ...(runState ? { runState } : {}),
    ...(queuePosition !== undefined ? { queuePosition } : {}),
    ...(asStr(rec['boundSession']) ? { boundSession: asStr(rec['boundSession']) } : {}),
    ...(asStr(rec['model']) ? { model: asStr(rec['model']) } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
    gates: parseGates(rec['gateValues']),
  }
}
