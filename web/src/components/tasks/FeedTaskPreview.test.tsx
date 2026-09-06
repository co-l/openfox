// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FeedTaskPreview } from './FeedTaskPreview'
import { clearCache } from '../../lib/resourceCache'
import { boardResource } from '../../lib/resources'
import { authFetch } from '../../lib/api'
import type { ProjectTask } from '@shared/types.js'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const navigateMock = vi.fn()
vi.mock('wouter', () => ({
  useLocation: () => ['/', navigateMock],
}))

const { capturedModalProps } = vi.hoisted(() => ({
  capturedModalProps: { isOpen: false, projectId: null as string | null },
}))

vi.mock('./TasksModal', () => ({
  TasksModal: (props: { isOpen: boolean; onClose: () => void; projectId: string }) => {
    capturedModalProps.isOpen = props.isOpen
    capturedModalProps.projectId = props.projectId
    return props.isOpen ? <div data-testid="tasks-modal" /> : null
  },
}))

const task = (
  overrides: Partial<import('@shared/types.js').ProjectTask> = {},
): import('@shared/types.js').ProjectTask => ({
  id: 't1',
  projectId: 'proj-1',
  prompt: 'Investigate the redirect bug',
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

const okJson = async () => ({})

function seedBoard(tasks: ProjectTask[]) {
  boardResource.write(
    {
      tasks,
      settings: { slotLimit: 1, queuePaused: false },
      counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
      gates: [],
    },
    'proj-1',
  )
}

describe('FeedTaskPreview', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    capturedModalProps.isOpen = false
    capturedModalProps.projectId = null
    navigateMock.mockClear()
    clearCache()
    seedBoard([])
    vi.mocked(authFetch).mockReset()
    vi.mocked(authFetch).mockImplementation(async () => ({ ok: true, json: okJson }) as unknown as Response)
  })

  it('shows nothing when no unclaimed To Do task exists', () => {
    seedBoard([])
    const { container } = render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    expect(container.textContent).not.toContain('Up next')
    expect(container.textContent).not.toContain('Manage tasks')
  })

  it('lists up to four unclaimed To Do tasks in position order, skipping claimed ones', () => {
    seedBoard([
      task({ id: 'later', prompt: 'Later task', position: 2 }),
      task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 }),
      task({ id: 'mid', prompt: 'Middle task', position: 1 }),
      task({ id: 'claimed', prompt: 'Bound elsewhere', position: 3, sessionIds: ['sess-x'] }),
    ])

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    expect(screen.getByText('Investigate the redirect bug')).toBeTruthy()
    expect(screen.getByText('Middle task')).toBeTruthy()
    expect(screen.getByText('Later task')).toBeTruthy()
    expect(screen.queryByText('Bound elsewhere')).toBeNull()
  })

  it('caps the list at four tasks', () => {
    seedBoard(Array.from({ length: 7 }, (_, i) => task({ id: `t${i}`, prompt: `Task ${i}`, position: i })))

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    expect(screen.getAllByRole('button', { name: /^Start$/ }).length).toBe(4)
  })

  it('claims exactly the clicked task', async () => {
    seedBoard([
      task({ id: 'later', prompt: 'Later task', position: 1 }),
      task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 }),
    ])

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    fireEvent.click(screen.getByText('Later task').closest('li')!.querySelector('button')!)

    await waitFor(() => {
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/later/move',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('claims the task into the current session without navigating', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: task({ id: 'top', status: 'in_progress', runState: 'running' }),
        sessionId: 'sess-current',
      }),
    } as unknown as Response)
    seedBoard([task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 })])

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    fireEvent.click(screen.getByText('Investigate the redirect bug').closest('li')!.querySelector('button')!)

    await waitFor(() => {
      expect(vi.mocked(authFetch)).toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/top/move',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sessionId":"sess-current"'),
        }),
      )
    })
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('surfaces a dismissible queued notice without hiding the list', async () => {
    const top = task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 })
    const board = {
      tasks: [top],
      settings: { slotLimit: 1, queuePaused: false },
      counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
      gates: [],
    }
    seedBoard(board.tasks)

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    // moveTask's defensive board refresh refetches /tasks — return the canonical
    // board there so the preview list survives the queued move.
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.endsWith('/move')) {
        return {
          ok: true,
          json: async () => ({
            task: task({ id: 'top', status: 'in_progress', runState: 'queued', queuePosition: 1 }),
          }),
        } as unknown as Response
      }
      return { ok: true, json: async () => board } as unknown as Response
    })

    fireEvent.click(screen.getByText('Investigate the redirect bug').closest('li')!.querySelector('button')!)
    await waitFor(() => {
      expect(screen.getByText(/Investigate the redirect bug.*queued/i)).toBeTruthy()
    })
    // The preview list stays visible after queueing.
    expect(screen.getByText('Investigate the redirect bug')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Dismiss'))
    expect(screen.queryByText(/queued/i)).toBeNull()
  })

  it('opens the tasks modal from the Manage tasks button', () => {
    seedBoard([task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 })])

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    expect(capturedModalProps.isOpen).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /manage tasks/i }))
    expect(capturedModalProps.isOpen).toBe(true)
    expect(capturedModalProps.projectId).toBe('proj-1')
    expect(screen.getByTestId('tasks-modal')).toBeTruthy()
  })

  it('shows a running indicator when at least one task is running', () => {
    seedBoard([
      task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 }),
      task({
        id: 'live',
        prompt: 'Already in flight',
        status: 'in_progress',
        runState: 'running',
        sessionIds: ['sess-live'],
        position: 5,
      }),
    ])

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    expect(screen.getByText(/1 running/i)).toBeTruthy()
  })

  it('omits the running indicator when nothing is running', () => {
    seedBoard([
      task({ id: 'top', prompt: 'Investigate the redirect bug', position: 0 }),
      task({
        id: 'waiting',
        prompt: 'Queued behind others',
        status: 'in_progress',
        runState: 'queued',
        sessionIds: ['sess-q'],
        position: 5,
      }),
    ])

    render(<FeedTaskPreview projectId="proj-1" sessionId="sess-current" />)
    expect(screen.queryByText(/running/i)).toBeNull()
  })
})
