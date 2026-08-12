import { memo } from 'react'
import { OptionalScrollArea } from './OptionalScrollArea'

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

const STATUS_META: Record<string, { label: string; className: string }> = {
  todo: { label: 'To Do', className: 'bg-accent-warning/10 text-accent-warning border-accent-warning/30' },
  in_progress: {
    label: 'In Progress',
    className: 'bg-accent-primary/10 text-accent-primary border-accent-primary/30',
  },
  done: { label: 'Done', className: 'bg-accent-success/10 text-accent-success border-accent-success/30' },
}

const SINGLE_TASK_ACTIONS = new Set(['get', 'create', 'edit', 'move', 'set_gate_value', 'duplicate', 'reorder'])

export const ProjectTasksView = memo(function ProjectTasksView({ result, action }: ProjectTasksViewProps) {
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    return <RawFallback result={result} />
  }

  if (action === 'list') {
    return (
      <OptionalScrollArea className="max-h-[60vh]">
        <Board data={parsed as ListData} />
      </OptionalScrollArea>
    )
  }
  if (action === 'set_gates') {
    const gates = (parsed as Record<string, unknown>)['gates']
    return (
      <OptionalScrollArea className="max-h-[60vh]">
        <GateList gates={Array.isArray(gates) ? (gates as GateConfigView[]) : []} />
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
        <TaskCard task={parseTask(parsed)} />
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

function Board({ data }: { data: ListData }) {
  const tasks = (data.tasks ?? []).map(parseTask)
  const gates = data.gates ?? []
  const todo = tasks.filter((t) => t.status === 'todo')
  const inProgress = tasks.filter((t) => t.status === 'in_progress')
  const done = tasks.filter((t) => t.status === 'done')
  const other = tasks.filter((t) => t.status !== 'todo' && t.status !== 'in_progress' && t.status !== 'done')

  return (
    <div className="space-y-2 text-xs">
      <div className="text-text-muted">
        Task board · {tasks.length} task{tasks.length === 1 ? '' : 's'}
        {gates.length > 0 && (
          <span> — Gates: {gates.map((g) => `${g.name} (${g.required ? 'required' : 'optional'})`).join(', ')}</span>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="text-text-muted italic">No tasks on the board</div>
      ) : (
        <>
          <Column title="To Do" tasks={todo} />
          <Column title="In Progress" tasks={inProgress} />
          <Column title="Done" tasks={done} />
          <Column title="Other" tasks={other} />
        </>
      )}
    </div>
  )
}

function Column({ title, tasks }: { title: string; tasks: TaskView[] }) {
  if (tasks.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="text-text-muted">
        {title} · {tasks.length}
      </div>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  )
}

function TaskCard({ task }: { task: TaskView }) {
  const meta = STATUS_META[task.status] ?? {
    label: task.status,
    className: 'bg-bg-tertiary text-text-secondary border-border',
  }
  return (
    <div className="rounded-md border border-border bg-bg-tertiary px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
        >
          {meta.label}
        </span>
        {task.runState === 'running' && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-success/40 bg-accent-success/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-success">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse" />
            Running
          </span>
        )}
        {task.runState === 'queued' && (
          <span className="inline-flex items-center rounded border border-accent-warning/40 bg-accent-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-warning">
            Queued · #{task.queuePosition ?? 1}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-text-primary leading-snug break-words whitespace-pre-wrap line-clamp-3">
        {task.prompt}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
        {task.boundSession && <span>Bound: {task.boundSession}</span>}
        {task.model && <span className="px-1.5 py-0.5 rounded bg-bg-secondary border border-border">{task.model}</span>}
        {task.attachments !== undefined && task.attachments > 0 && (
          <span>
            {task.attachments} attachment{task.attachments === 1 ? '' : 's'}
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

function GateList({ gates }: { gates: GateConfigView[] }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="text-text-muted mb-1">Gate configuration</div>
      {gates.length === 0 ? (
        <div className="text-text-muted italic">No gates configured</div>
      ) : (
        gates.map((gate) => (
          <div key={gate.id} className="flex items-start gap-2">
            <span className="font-mono text-accent-primary shrink-0">{gate.id}</span>
            <div className="min-w-0">
              <div className="text-text-primary">
                {gate.name}{' '}
                <span className="ml-0.5 px-1.5 py-0.5 rounded border border-border bg-bg-tertiary text-[10px]">
                  {gate.required ? 'required' : 'optional'}
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
