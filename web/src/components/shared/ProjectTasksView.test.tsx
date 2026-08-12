// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectTasksView } from './ProjectTasksView'

const gateConfig = [
  { id: 'commit', name: 'Commit', description: 'needs a commit sha', required: true, variant: 'done' },
  { id: 'verified', name: 'Verified', description: 'peer reviewed', required: false, variant: 'done' },
]

const todoTask = {
  id: 'tk_01',
  prompt: 'Write the docs',
  status: 'todo',
  version: 2,
  attachments: 1,
  gateValues: [],
  auditTrail: [],
  updatedAt: '2026-08-10T00:00:00.000Z',
}

const runningTask = {
  id: 'tk_02',
  prompt: 'Fix the flaky test',
  status: 'in_progress',
  runState: 'running',
  boundSession: 'sess-abc',
  model: 'deepseek-v4-flash',
  version: 5,
  attachments: 0,
  gateValues: [{ commit: 'abc123', actor: 'agent', timestamp: '2026-08-10T00:00:00.000Z' }],
  auditTrail: [],
  updatedAt: '2026-08-10T00:00:05.000Z',
}

const queuedTask = {
  id: 'tk_03',
  prompt: 'Polish the landing page',
  status: 'in_progress',
  runState: 'queued',
  queuePosition: 1,
  version: 3,
  attachments: 0,
  gateValues: [],
  auditTrail: [],
  updatedAt: '2026-08-10T00:00:06.000Z',
}

const doneTask = {
  id: 'tk_04',
  prompt: 'Ship the release',
  status: 'done',
  version: 9,
  attachments: 0,
  gateValues: [],
  auditTrail: [],
  updatedAt: '2026-08-10T00:00:07.000Z',
}

function listResult(tasks: unknown[], gates: unknown[] = gateConfig): string {
  return JSON.stringify({ gates, tasks })
}

afterEach(cleanup)

describe('ProjectTasksView — list', () => {
  it('renders a board grouped by column with counts', () => {
    const { container } = render(
      <ProjectTasksView action="list" result={listResult([todoTask, runningTask, queuedTask, doneTask])} />,
    )

    const text = container.textContent ?? ''
    expect(text).toContain('Task board · 4 tasks')
    expect(text).toContain('To Do · 1')
    expect(text).toContain('In Progress · 2')
    expect(text).toContain('Done · 1')
  })

  it('shows each task prompt and status', () => {
    const { container } = render(<ProjectTasksView action="list" result={listResult([todoTask, doneTask])} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Write the docs')
    expect(text).toContain('To Do')
    expect(text).toContain('Ship the release')
    expect(text).toContain('Done')
  })

  it('marks running and queued tasks with their badges', () => {
    const { container } = render(<ProjectTasksView action="list" result={listResult([runningTask, queuedTask])} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Running')
    expect(text).toContain('Queued · #1')
    expect(text).toContain('Bound: sess-abc')
  })

  it('styles the running and queued badges with semantic accent tokens', () => {
    const { container } = render(<ProjectTasksView action="list" result={listResult([runningTask, queuedTask])} />)

    const runningDot = container.querySelector('.animate-pulse')
    expect(runningDot?.className).toContain('bg-accent-success')
    expect(within(container as HTMLElement).getByText('Queued · #1').className).toContain('accent-warning')
  })

  it('groups tasks with unrecognized statuses into an Other column', () => {
    const legacy = { ...todoTask, id: 'tk_09', prompt: 'Legacy item', status: 'archived' }
    const { container } = render(<ProjectTasksView action="list" result={listResult([todoTask, legacy])} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Task board · 2 tasks')
    expect(text).toContain('Other · 1')
    expect(text).toContain('Legacy item')
  })

  it('shows model, attachment count, and filled gates', () => {
    const { container } = render(<ProjectTasksView action="list" result={listResult([todoTask, runningTask])} />)

    const text = container.textContent ?? ''
    expect(text).toContain('deepseek-v4-flash')
    expect(text).toContain('1 attachment')
    expect(text).toContain('commit: abc123')
  })

  it('summarizes the gate configuration in the header', () => {
    const { container } = render(<ProjectTasksView action="list" result={listResult([todoTask])} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Commit (required)')
    expect(text).toContain('Verified (optional)')
  })

  it('shows an empty state when there are no tasks', () => {
    const { container } = render(<ProjectTasksView action="list" result={listResult([])} />)

    expect(container.textContent).toContain('No tasks on the board')
  })
})

describe('ProjectTasksView — single task actions', () => {
  it('renders a task card for move', () => {
    const { container } = render(<ProjectTasksView action="move" result={JSON.stringify(runningTask)} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Fix the flaky test')
    expect(text).toContain('In Progress')
    expect(text).toContain('Running')
    expect(text).toContain('Bound: sess-abc')
    expect(text).toContain('commit: abc123')
  })

  it('renders a task card for get', () => {
    const { container } = render(<ProjectTasksView action="get" result={JSON.stringify(doneTask)} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Ship the release')
    expect(text).toContain('Done')
  })
})

describe('ProjectTasksView — set_gates', () => {
  it('renders each gate with name, id, requirement, variant, and description', () => {
    const gates = [
      ...gateConfig,
      { id: 'planned', name: 'Planned', description: 'has a plan', required: true, variant: 'ready' },
    ]
    const { container } = render(<ProjectTasksView action="set_gates" result={JSON.stringify({ gates })} />)

    const text = container.textContent ?? ''
    expect(text).toContain('Gate configuration')
    expect(text).toContain('Commit')
    expect(text).toContain('commit')
    expect(text).toContain('required')
    expect(text).toContain('optional')
    expect(text).toContain('needs a commit sha')
    expect(text).toContain('peer reviewed')
    expect(text).toContain('Planned')
    expect(text).toContain('ready')
    expect(text).toContain('done')
  })
})

describe('ProjectTasksView — fallbacks', () => {
  it('shows a friendly confirmation with the deleted task prompt, not the uuid', () => {
    const { container } = render(
      <ProjectTasksView
        action="delete"
        result={JSON.stringify({
          message: 'Deleted: Write the docs',
          taskId: 'a4504f37-36b4-4e2c-8f22-48d820c931e4',
          prompt: 'Write the docs',
        })}
      />,
    )

    const text = container.textContent ?? ''
    expect(text).toContain('Deleted: Write the docs')
    expect(text).not.toContain('a4504f37')
  })

  it('falls back to a pre block for non-JSON delete results', () => {
    const { container } = render(
      <ProjectTasksView action="delete" result="Task a4504f37 deleted (linked sessions untouched)" />,
    )

    expect(container.querySelector('pre')?.textContent).toContain('Task a4504f37 deleted')
  })

  it('falls back to a pre block for malformed JSON', () => {
    const { container } = render(<ProjectTasksView action="list" result="{not json" />)

    expect(container.querySelector('pre')?.textContent).toContain('{not json')
  })
})
