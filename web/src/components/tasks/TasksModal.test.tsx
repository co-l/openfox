// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TasksModal } from './TasksModal'
import { useTasksStore } from '../../stores/tasks'
import type { ProjectTask, ProjectTaskSettings, ProjectTaskCounts } from '@shared/types.js'
import { authFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const task = (overrides: Partial<ProjectTask>): ProjectTask => ({
  id: 'x',
  projectId: 'proj-1',
  prompt: 'Do it',
  attachments: [],
  status: 'todo',
  position: 0,
  version: 1,
  sessionIds: [],
  gateValues: [],
  auditTrail: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const board: { tasks: ProjectTask[]; settings: ProjectTaskSettings; counts: ProjectTaskCounts } = {
  tasks: [
    task({
      id: 't1',
      prompt: 'Investigate and fix the flaky test in CI',
      attachments: [
        { id: 'a1', filename: 'pic.png', mimeType: 'image/png', size: 10, data: 'data:image/png;base64,x' },
      ],
    }),
    task({
      id: 't2',
      prompt: 'Wire the kanban',
      status: 'in_progress',
      runState: 'running',
      sessionIds: ['sess-1'],
      activeSessionId: 'sess-1',
    }),
    task({
      id: 't3',
      prompt: 'Tighten the spacing',
      status: 'in_progress',
      runState: 'queued',
      position: 1,
    }),
    task({ id: 't4', prompt: 'Write docs', status: 'done' }),
  ],
  settings: { slotLimit: 1, queuePaused: false },
  counts: { open: 3, todo: 1, inProgress: 2, running: 1, queued: 1, done: 1 },
}

describe('TasksModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useTasksStore.setState({
      tasks: board.tasks,
      settings: board.settings,
      counts: board.counts,
      gates: [],
      activeProjectId: 'proj-1',
      lastError: null,
      lastAutoLaunch: null,
    })
    const authFetchMock = vi.mocked(authFetch)
    authFetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/tasks/gates')) {
        return { ok: true, json: async () => ({ gates: [] }) } as unknown as Response
      }
      return { ok: true, json: async () => board } as unknown as Response
    })
  })

  it('renders three columns with per-column counts and all task cards', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    expect(screen.getByText('To Do')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('Investigate and fix the flaky test in CI')).toBeTruthy()
    expect(screen.getByText('Wire the kanban')).toBeTruthy()
    expect(screen.getByText('Tighten the spacing')).toBeTruthy()
    expect(screen.getByText('Write docs')).toBeTruthy()
  })

  it('shows Running and Queued badges with queue position', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText(/Queued · 1/)).toBeTruthy()
  })

  it('shows the In Progress launch hint', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    expect(screen.getByText('Moving a task here starts it automatically.')).toBeTruthy()
  })

  it('opens the task editor via New Task in the To Do column header', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByText('New Task'))
    expect(screen.getByText('Create task')).toBeTruthy()
  })

  it('filters cards by search text', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.change(screen.getByPlaceholderText('Search tasks…'), { target: { value: 'flaky' } })
    expect(screen.getByText('Investigate and fix the flaky test in CI')).toBeTruthy()
    expect(screen.queryByText('Wire the kanban')).toBeNull()
  })

  it('lists move destinations directly in the card menu (no nested fly-out)', async () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: /actions for investigate/i }))
    await screen.findByText('Move to…')
    // Destinations render inline in the menu — the column headers contribute the second match.
    expect(screen.getAllByText('To Do').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(2)
    // Close the menu so no portal'd menu outlives the test.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Move to…')).toBeNull())
  })

  it('runs Delete from the card menu with confirmation', async () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: /actions for investigate/i }))
    fireEvent.click(await screen.findByText('Delete'))
    expect(await screen.findByText('Delete task?')).toBeTruthy()
    // Dismiss so the modal portal unmounts cleanly — an abandoned portal wrecks
    // the next test's happy-dom teardown (removeChild on a wiped body).
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByText('Delete task?')).toBeNull())
  })

  it('opens the editor when a card is clicked', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByText('Investigate and fix the flaky test in CI'))
    expect(screen.getByText('Edit task')).toBeTruthy()
    expect((screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement).value).toBe(
      'Investigate and fix the flaky test in CI',
    )
  })

  it('does not open the editor when clicking the card menu', async () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: /actions for investigate/i }))
    await screen.findByText('Move to…')
    expect(screen.queryByText('Edit task')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Move to…')).toBeNull())
  })

  it('shows an Open session link on Done cards that keep session history', async () => {
    const customTasks = [
      task({
        id: 't-done-linked',
        prompt: 'Was worked on',
        status: 'done',
        sessionIds: ['sess-old', 'sess-last'],
      }),
      task({ id: 't-todo-plain', prompt: 'Brand new idea', status: 'todo', sessionIds: [] }),
    ]
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: customTasks,
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 1, todo: 1, inProgress: 0, running: 0, queued: 0, done: 1 },
      }),
    } as unknown as Response)
    useTasksStore.setState({
      tasks: customTasks,
      settings: { slotLimit: 1, queuePaused: false },
      counts: { open: 1, todo: 1, inProgress: 0, running: 0, queued: 0, done: 1 },
    })
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)

    // A todo card with no bound session shows no link; the done card links to
    // its most recent attempt.
    const openSessionButtons = await waitFor(() => screen.getAllByText('Open session'))
    expect(openSessionButtons.length).toBe(1)
    expect(screen.queryByText('Brand new idea')).toBeTruthy()
  })

  it('renders Open session as a real link to the session and closes the modal on click', async () => {
    const onClose = vi.fn()
    render(<TasksModal isOpen onClose={onClose} projectId="proj-1" />)

    const link = await screen.findByRole('link', { name: /open session/i })
    expect(link.getAttribute('href')).toBe('/p/proj-1/s/sess-1')
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps queue counters accurate while a search filters the columns', async () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    // The board has 1 running + 1 queued. Searching away the queued card must
    // NOT change the live queue/active numbers.
    fireEvent.change(screen.getByPlaceholderText('Search tasks…'), { target: { value: 'ship' } })

    const header = await waitFor(() => screen.getByTitle('Active tasks / limit'))
    expect(header.textContent).toContain('1 / 1 running')
    expect(header.textContent).toContain('1 queued')
  })

  it('spreads the actions across the column headers and keeps the modal header lean', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    // Modal header: just the wide search.
    expect(screen.getByPlaceholderText('Search tasks…')).toBeTruthy()
    // New Task lives in the To Do column header, Gates in the Done column header.
    expect(screen.getByText('New Task')).toBeTruthy()
    expect(screen.getByText('Gates')).toBeTruthy()
    // Slot stepper, queue status and pause live in the In Progress column footer.
    expect(screen.getByText('Parallel slots')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decrease slot limit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Increase slot limit' })).toBeTruthy()
    expect(screen.getByText('Pause')).toBeTruthy()
    // The full-width bottom create button is gone.
    expect(screen.queryByText(/New task$/)).toBeNull()
  })

  it('drops column collapse affordances and the extra hints', () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    // Only the In Progress hint remains.
    expect(screen.getByText('Moving a task here starts it automatically.')).toBeTruthy()
    expect(screen.queryByText(/Nothing waiting/)).toBeNull()
    expect(screen.queryByText(/Reverting is always allowed/)).toBeNull()
    // Columns are not collapsible anymore.
    expect(screen.queryByTitle(/Collapse column/)).toBeNull()
    expect(screen.queryByTitle(/Expand column/)).toBeNull()
  })

  it('steps the slot limit on rapid clicks without waiting for the server', async () => {
    // Keep the on-open board load pending so it can't race/overwrite the
    // clicks; the settings PUT itself resolves normally.
    vi.mocked(authFetch).mockImplementation((url: string) => {
      if (url.endsWith('/tasks/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ settings: { slotLimit: 3, queuePaused: false } }),
        } as unknown as Response)
      }
      return new Promise(() => {})
    })

    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    const plus = screen.getByRole('button', { name: 'Increase slot limit' })
    fireEvent.click(plus)
    fireEvent.click(plus)

    const slot = await screen.findByTitle('Parallel-slot limit')
    // Two immediate clicks from 1 must land on 3 (1 -> 2 -> 3), not stall on 1.
    expect(slot.textContent).toContain('3')
  })
})
