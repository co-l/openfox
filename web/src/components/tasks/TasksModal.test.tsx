// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TasksModal } from './TasksModal'
import { clearCache } from '../../lib/resourceCache'
import { boardResource } from '../../lib/resources'
import type { ProjectTask, ProjectTaskSettings, ProjectTaskCounts } from '@shared/types.js'
import { authFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const navigateMock = vi.fn()
vi.mock('wouter', () => ({
  Link: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode
    href: string
    onClick?: (e: React.MouseEvent) => void
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  useLocation: () => [undefined, navigateMock],
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
    task({ id: 't5', prompt: 'Plan twice ship once', planned: true }),
  ],
  settings: { slotLimit: 1, queuePaused: false },
  counts: { open: 3, backlog: 0, todo: 1, inProgress: 2, running: 1, queued: 1, review: 0, done: 1 },
}

describe('TasksModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearCache()
    boardResource.write(
      {
        tasks: board.tasks,
        settings: board.settings,
        counts: board.counts,
        gates: [],
      },
      'proj-1',
    )
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

  it('lists move destinations directly in the card menu with column stripes', async () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: /actions for investigate/i }))
    await screen.findByText('History & evidence')
    // Every other column shows as a direct move entry (column header + menu item);
    // the card itself sits in To Do, so "To Do" only appears as the header.
    expect(screen.getAllByText('Backlog').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(2)
    expect(document.querySelectorAll('.w-1.bg-zinc-500, .w-1.bg-purple-500').length).toBeGreaterThanOrEqual(2)
    // Close the menu so no portal'd menu outlives the test.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('History & evidence')).toBeNull())
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
    await screen.findByText('History & evidence')
    expect(screen.queryByText('Edit task')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('History & evidence')).toBeNull())
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
        counts: { open: 1, backlog: 0, todo: 1, inProgress: 0, running: 0, queued: 0, review: 0, done: 1 },
      }),
    } as unknown as Response)
    boardResource.write(
      {
        tasks: customTasks,
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 1, backlog: 0, todo: 1, inProgress: 0, running: 0, queued: 0, review: 0, done: 1 },
        gates: [],
      },
      'proj-1',
    )
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

  it('stays on the board when a task moves to In Progress and returns a session', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.endsWith('/move')) {
        return {
          ok: true,
          json: async () => ({
            task: task({
              id: 't1',
              prompt: 'Investigate and fix the flaky test in CI',
              status: 'in_progress',
              runState: 'running',
              sessionIds: ['sess-new'],
              activeSessionId: 'sess-new',
            }),
            sessionId: 'sess-new',
          }),
        } as unknown as Response
      }
      if (url.endsWith('/tasks/gates')) {
        return { ok: true, json: async () => ({ gates: [] }) } as unknown as Response
      }
      return { ok: true, json: async () => board } as unknown as Response
    })
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)

    fireEvent.click(screen.getByRole('button', { name: /actions for investigate/i }))
    const menu = await screen.findByTestId('session-dropdown-menu')
    fireEvent.click(within(menu).getByText('In Progress'))

    await waitFor(() => {
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t1/move',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    // No autonavigation: the board stays mounted instead of leaving for the session.
    expect(screen.getByPlaceholderText('Search tasks…')).toBeTruthy()
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

  it('renders a full-width position bar at the current column and no Running header in the card menu', async () => {
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: /actions for wire the kanban/i }))
    const menu = await screen.findByTestId('session-dropdown-menu')
    // t2 sits in In Progress (running): the no-op entry is a decorative bar.
    const bar = within(menu).getByTestId('menu-decorative-bar')
    expect(bar.className).toContain('bg-amber-500')
    // Positional: the bar sits between the Backlog and Review move entries.
    const bars = menu.querySelectorAll('[data-testid="menu-decorative-bar"]')
    expect(bars.length).toBe(1)
    // Running state stays on the card badge only — never a clickable menu row.
    expect(within(menu).queryByText('Running')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('session-dropdown-menu')).toBeNull())
  })

  it('shows post-plan launch entries for a planned To Do task and wires them to the API', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/api/workflows')) {
        return {
          ok: true,
          json: async () => ({
            defaults: [],
            userItems: [{ id: 'fixit', name: 'Fix it', description: '', version: '1.0.0', scope: 'user' }],
            projectItems: [],
            activeWorkflowId: 'default',
          }),
        } as unknown as Response
      }
      if (url.endsWith('/workflow-choice')) {
        return { ok: true, json: async () => ({ task: task({ id: 't5', planned: true }) }) } as unknown as Response
      }
      if (url.endsWith('/tasks/gates')) {
        return { ok: true, json: async () => ({ gates: [] }) } as unknown as Response
      }
      return { ok: true, json: async () => board } as unknown as Response
    })
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)
    fireEvent.click(screen.getByRole('button', { name: /actions for plan twice/i }))
    const menu = await screen.findByTestId('session-dropdown-menu')

    fireEvent.click(within(menu).getByText('Stay in To Do'))
    await waitFor(() => {
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t5/move',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"todo"') }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /actions for plan twice/i }))
    const menu2 = await screen.findByTestId('session-dropdown-menu')
    fireEvent.click(within(menu2).getByText(/Fix it/))
    await waitFor(() => {
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t5/workflow-choice',
        expect.objectContaining({ method: 'PUT', body: expect.stringContaining('fixit') }),
      )
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t5/move',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"in_progress"') }),
      )
    })
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  it('navigates to the created session after clicking Start plan', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.endsWith('/start-plan')) {
        return {
          ok: true,
          json: async () => ({ task: task({ id: 't5', planned: false }), sessionId: 'sess-planner' }),
        } as unknown as Response
      }
      if (url.endsWith('/tasks/gates')) {
        return { ok: true, json: async () => ({ gates: [] }) } as unknown as Response
      }
      return { ok: true, json: async () => board } as unknown as Response
    })
    render(<TasksModal isOpen onClose={() => {}} projectId="proj-1" />)

    const card = screen.getByText('Plan twice ship once').closest('div[draggable]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Start plan/ }))
    await waitFor(() => {
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t5/start-plan',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(navigateMock).toHaveBeenCalledWith('/p/proj-1/s/sess-planner')
    })
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
