// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskEditor } from './TaskEditor'
import { useTasksStore } from '../../stores/tasks'
import { clearCache } from '../../lib/resourceCache'
import { workflowsResource, projectsResource } from '../../lib/resources'
import { authFetch } from '../../lib/api'
import type { ProjectTask } from '@shared/types.js'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const { mockAgents, mockRefreshAgents } = vi.hoisted(() => ({
  mockAgents: [] as Array<{
    id: string
    name: string
    description: string
    subagent: boolean
    allowedTools: string[]
  }>,
  mockRefreshAgents: vi.fn(),
}))

vi.mock('../../hooks/useAgents', () => ({
  useAgents: () => ({ agents: mockAgents, refresh: mockRefreshAgents }),
}))

const SCROLL_HEIGHT_DESC = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight')

let mockScrollHeight = 0

const task = (overrides: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 't-edit',
  projectId: 'proj-1',
  prompt: 'Existing prompt',
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

describe('TaskEditor', () => {
  beforeEach(() => {
    mockScrollHeight = 0
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return mockScrollHeight
      },
    })
    document.body.innerHTML = ''
    localStorage.clear()
    useTasksStore.setState({
      lastError: null,
      lastAutoLaunch: null,
    })
    // Real-world ordering: builder sorts first, but the configured default agent
    // is planner — a new task must NOT pin the first agent in the list.
    mockAgents.splice(
      0,
      mockAgents.length,
      { id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] },
      { id: 'planner', name: 'Planner', description: '', subagent: false, allowedTools: [] },
      { id: 'explorer', name: 'Explorer', description: '', subagent: false, allowedTools: [] },
    )
    // Neutralize the cold-start fetches (asserted in their own test) so other
    // tests can seed the stores directly without an async refetch wiping them.
    clearCache()
    vi.mocked(authFetch).mockReset()
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response)
  })

  afterEach(() => {
    if (SCROLL_HEIGHT_DESC) {
      Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', SCROLL_HEIGHT_DESC)
    }
  })

  it('shows the running-task note in edit mode for a launched task', () => {
    render(
      <TaskEditor
        projectId="proj-1"
        initialTask={task({ status: 'in_progress', runState: 'running' })}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(screen.getAllByText(/already in progress/i).length).toBeGreaterThan(0)
  })

  it('renders the loaded agent list in the dropdown so it is never empty', () => {
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('option', { name: 'Builder' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Planner' })).toBeTruthy()
  })

  it('restores an unsaved draft when editing (edit-mode draft preservation)', async () => {
    localStorage.setItem('openfox:task-draft:proj-1:t-edit', JSON.stringify({ prompt: 'Draft prompt content' }))
    render(<TaskEditor projectId="proj-1" initialTask={task()} onClose={() => {}} onSaved={() => {}} />)
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement).value).toBe(
        'Draft prompt content',
      )
    })
  })

  it('persists typed edits to the draft store in edit mode', async () => {
    render(<TaskEditor projectId="proj-1" initialTask={task()} onClose={() => {}} onSaved={() => {}} />)
    const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    fireEvent.change(promptEl, { target: { value: 'Unsaved edit text' } })
    await waitFor(() => {
      const raw = localStorage.getItem('openfox:task-draft:proj-1:t-edit')
      expect(raw).toBeTruthy()
      expect(JSON.parse(raw!).prompt).toBe('Unsaved edit text')
    })
  })

  it('saves via Ctrl+Enter and clears the draft', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: task({ prompt: 'Save me' }) }),
    } as unknown as Response)
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
      }),
    } as unknown as Response)

    render(<TaskEditor projectId="proj-1" initialTask={task()} onClose={() => {}} onSaved={() => {}} />)
    const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    fireEvent.change(promptEl, { target: { value: 'Save me' } })
    fireEvent.keyDown(promptEl, { key: 'Enter', ctrlKey: true })
    await waitFor(() => {
      expect(localStorage.getItem('openfox:task-draft:proj-1:t-edit')).toBeNull()
    })
  })

  it('lets plain Enter insert a newline without saving', async () => {
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    fireEvent.change(promptEl, { target: { value: 'First line' } })
    fireEvent.keyDown(promptEl, { key: 'Enter' })
    // Simulate the browser's default newline insertion — the handler must not
    // swallow Enter, so no task create/update is dispatched.
    fireEvent.change(promptEl, { target: { value: 'First line\nSecond line' } })
    expect(promptEl.value).toBe('First line\nSecond line')
    await waitFor(() => {
      expect(vi.mocked(authFetch)).not.toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(vi.mocked(authFetch)).not.toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t-edit',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  it('lets Shift+Enter insert a newline without saving', async () => {
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    fireEvent.change(promptEl, { target: { value: 'First line' } })
    fireEvent.keyDown(promptEl, { key: 'Enter', shiftKey: true })
    fireEvent.change(promptEl, { target: { value: 'First line\nSecond line' } })
    expect(promptEl.value).toBe('First line\nSecond line')
    await waitFor(() => {
      expect(vi.mocked(authFetch)).not.toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(vi.mocked(authFetch)).not.toHaveBeenCalledWith(
        '/api/projects/proj-1/tasks/t-edit',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  it('disables spell checking on the prompt textarea', () => {
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    expect(promptEl.getAttribute('spellcheck')).toBe('false')
  })

  describe('auto-resize', () => {
    const promptEl = () => screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement

    it('grows on mount when editing a task with a large prompt', () => {
      mockScrollHeight = 240
      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ prompt: 'line one\nline two\nline three\nline four' })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      expect(promptEl().style.height).toBe('248px')
      expect(promptEl().className).toContain('resize-y')
    })

    it('grows as the prompt grows while typing', () => {
      mockScrollHeight = 160
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.change(promptEl(), { target: { value: 'Some longer content that needs more room' } })
      expect(promptEl().style.height).toBe('168px')
    })

    it('shrinks back to the content height when the prompt is edited down', () => {
      mockScrollHeight = 160
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.change(promptEl(), { target: { value: 'Longer content that needs a taller box' } })
      mockScrollHeight = 90
      fireEvent.change(promptEl(), { target: { value: 'Short' } })
      expect(promptEl().style.height).toBe('98px')
    })

    it('lets the CSS min-height govern when the prompt is emptied', () => {
      mockScrollHeight = 240
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.change(promptEl(), { target: { value: 'Some content' } })
      fireEvent.change(promptEl(), { target: { value: '' } })
      expect(promptEl().style.height).toBe('auto')
    })
  })

  it('renders the slash autocomplete into a portal so it is not clipped by the modal', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url === '/api/workflows') {
        return {
          ok: true,
          json: async () => ({
            defaults: [{ id: 'review', name: 'PR Review', description: '', version: '1', scope: 'builtin' }],
            userItems: [],
            projectItems: [],
          }),
        } as unknown as Response
      }
      return { ok: true, json: async () => ({}) } as unknown as Response
    })
    await workflowsResource.refresh()
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    const user = userEvent.setup()
    await user.click(promptEl)
    await user.type(promptEl, '/rev')
    await waitFor(() => {
      const listbox = document.body.querySelector('[role="listbox"]')
      expect(listbox).toBeTruthy()
      expect(listbox!.className).toContain('fixed')
    })
  })

  it('loads workflows and commands via the resource cache so the slash menu is populated from a cold start', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url === '/api/projects') {
        return {
          ok: true,
          json: async () => ({
            projects: [
              { id: 'proj-1', name: 'Proj', workdir: '/tmp/proj', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
            ],
          }),
        } as unknown as Response
      }
      return { ok: true, json: async () => ({}) } as unknown as Response
    })
    await projectsResource.refresh()
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/workflows?workdir=%2Ftmp%2Fproj')
      expect(authFetch).toHaveBeenCalledWith('/api/commands?workdir=%2Ftmp%2Fproj')
    })
  })

  describe('agent selection', () => {
    const agentSelect = () => screen.getByRole('combobox') as HTMLSelectElement
    const typePrompt = () => {
      const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
      fireEvent.change(promptEl, { target: { value: 'Do the thing' } })
      return promptEl
    }
    const postedBody = () => {
      const post = vi
        .mocked(authFetch)
        .mock.calls.find(([url, init]) => url === '/api/projects/proj-1/tasks' && init?.method === 'POST')
      return post ? JSON.parse(String(post[1]?.body)) : null
    }
    const putBody = () => {
      const put = vi
        .mocked(authFetch)
        .mock.calls.find(([url, init]) => url === '/api/projects/proj-1/tasks/t-edit' && init?.method === 'PUT')
      return put ? JSON.parse(String(put[1]?.body)) : null
    }

    it('defaults a new task to the default agent (nothing pinned)', () => {
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      const select = agentSelect()
      expect(select.value).toBe('')
      expect(select.options[select.selectedIndex]?.text).toBe('Default agent')
    })

    it('omits agentId when saving a new task with the default agent', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Do the thing' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)

      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      typePrompt()
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(postedBody()).toBeTruthy())
      expect(postedBody()).not.toHaveProperty('agentId')
    })

    it('pins an explicitly chosen agent on create', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Do the thing', agentId: 'explorer' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)

      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.change(agentSelect(), { target: { value: 'explorer' } })
      typePrompt()
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(postedBody()).toBeTruthy())
      expect(postedBody().agentId).toBe('explorer')
    })

    it('shows the pinned agent when editing a task that has one', () => {
      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ agentId: 'explorer' })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      expect(agentSelect().value).toBe('explorer')
    })

    it('sends agentId null when the agent is cleared back to default on edit', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Do the thing' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)

      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ agentId: 'explorer' })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      fireEvent.change(agentSelect(), { target: { value: '' } })
      typePrompt()
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(putBody()).toBeTruthy())
      expect(putBody().agentId).toBeNull()
    })
  })

  describe('model selection', () => {
    const typePrompt = () => {
      const promptEl = screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
      fireEvent.change(promptEl, { target: { value: 'Do the thing' } })
      return promptEl
    }
    const putBody = () => {
      const put = vi
        .mocked(authFetch)
        .mock.calls.find(([url, init]) => url === '/api/projects/proj-1/tasks/t-edit' && init?.method === 'PUT')
      return put ? JSON.parse(String(put[1]?.body)) : null
    }
    const clearModelViaPicker = async () => {
      // Open the picker (button shows the pinned short model name) and choose
      // "Default (global model)", which reports an explicit clear.
      fireEvent.click(screen.getByRole('button', { name: /gpt/i }))
      fireEvent.click(await screen.findByText('Default (global model)'))
    }

    it('shows the pinned model when editing a task that has one', () => {
      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ model: 'gpt-4o', providerId: 'openai' })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      expect(screen.getByRole('button', { name: /gpt/i })).toBeTruthy()
    })

    it('sends model/provider null when cleared back to default on edit', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Do the thing' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)

      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ model: 'gpt-4o', providerId: 'openai' })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      await clearModelViaPicker()
      typePrompt()
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(putBody()).toBeTruthy())
      expect(putBody().model).toBeNull()
      expect(putBody().providerId).toBeNull()
    })
  })

  describe('schedule', () => {
    const promptEl = () => screen.getByPlaceholderText(/Describe the task/i) as HTMLTextAreaElement
    const typePrompt = () => {
      fireEvent.change(promptEl(), { target: { value: 'Do the thing' } })
    }
    const save = async () => {
      fireEvent.keyDown(promptEl(), { key: 'Enter', ctrlKey: true })
    }
    const postedBody = () => {
      const post = vi
        .mocked(authFetch)
        .mock.calls.find(([url, init]) => url === '/api/projects/proj-1/tasks' && init?.method === 'POST')
      return post ? JSON.parse(String(post[1]?.body)) : null
    }
    const putBody = () => {
      const put = vi
        .mocked(authFetch)
        .mock.calls.find(([url, init]) => url === '/api/projects/proj-1/tasks/t-edit' && init?.method === 'PUT')
      return put ? JSON.parse(String(put[1]?.body)) : null
    }
    const mockSave = () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Do the thing' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)
    }

    it('submits a one-off schedule with the chosen run time', async () => {
      mockSave()
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /run once/i }))
      fireEvent.change(screen.getByLabelText(/run at/i), { target: { value: '2030-01-01T09:00' } })
      typePrompt()
      await save()
      await waitFor(() => expect(postedBody()).toBeTruthy())
      expect(postedBody().schedule).toMatchObject({ type: 'once' })
      expect(new Date(postedBody().schedule.runAt).toISOString()).toBe(new Date('2030-01-01T09:00').toISOString())
    })

    it('submits a weekly recurring schedule with selected weekdays', async () => {
      mockSave()
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /repeat/i }))
      fireEvent.change(screen.getByLabelText(/first run/i), { target: { value: '2030-01-01T09:00' } })
      fireEvent.change(screen.getByLabelText(/repeat unit/i), { target: { value: 'week' } })
      const thuBtn = screen.getByRole('button', { name: /^thu$/i })
      if (thuBtn.getAttribute('aria-pressed') !== 'true') {
        fireEvent.click(thuBtn)
      }
      typePrompt()
      await save()
      await waitFor(() => expect(postedBody()).toBeTruthy())
      expect(postedBody().schedule.type).toBe('recurring')
      expect(postedBody().schedule.freq).toBe('week')
      expect(postedBody().schedule.weekdays).toContain(4)
      expect(postedBody().schedule.end).toEqual({ kind: 'never' })
      expect(postedBody().schedule.startAt).toBe(new Date('2030-01-01T09:00').toISOString())
    })

    it('submits a monthly recurrence ending after N occurrences', async () => {
      mockSave()
      render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /repeat/i }))
      fireEvent.change(screen.getByLabelText(/repeat unit/i), { target: { value: 'month' } })
      fireEvent.change(screen.getByLabelText(/day of month/i), { target: { value: '15' } })
      fireEvent.click(screen.getByLabelText(/after .*occurrences/i))
      fireEvent.change(screen.getByLabelText('Occurrences'), { target: { value: '5' } })
      typePrompt()
      await save()
      await waitFor(() => expect(postedBody()).toBeTruthy())
      expect(postedBody().schedule.type).toBe('recurring')
      expect(postedBody().schedule.freq).toBe('month')
      expect(postedBody().schedule.monthDay).toBe(15)
      expect(postedBody().schedule.end).toEqual({ kind: 'count', count: 5 })
    })

    it('clearing the schedule on edit sends schedule null', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Do the thing' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)

      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ schedule: { type: 'once', runAt: '2030-01-01T09:00:00' } })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /no schedule/i }))
      typePrompt()
      await save()
      await waitFor(() => expect(putBody()).toBeTruthy())
      expect(putBody().schedule).toBeNull()
    })

    it('prefills the schedule controls when editing a scheduled task', () => {
      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({ schedule: { type: 'once', runAt: '2030-01-01T09:00:00' } })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      expect(screen.getByRole('button', { name: /run once/i }).getAttribute('aria-pressed')).toBe('true')
      expect((screen.getByLabelText(/run at/i) as HTMLInputElement).value).toBe('2030-01-01T09:00')
    })

    it('does not resend the schedule when editing only the prompt of a recurring task', async () => {
      vi.mocked(authFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task: task({ prompt: 'Edited prompt' }) }),
      } as unknown as Response)
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          tasks: [],
          settings: { slotLimit: 1, queuePaused: false },
          counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        }),
      } as unknown as Response)

      render(
        <TaskEditor
          projectId="proj-1"
          initialTask={task({
            prompt: 'Original',
            schedule: {
              type: 'recurring',
              freq: 'day',
              interval: 1,
              startAt: '2026-01-01T09:00:00',
              end: { kind: 'never' },
              occurrencesDone: 5,
              nextRunAt: '2099-01-01T09:00:00',
            },
          })}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      )
      fireEvent.change(screen.getByPlaceholderText(/Describe the task/i), { target: { value: 'Edited prompt' } })
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(putBody()).toBeTruthy())
      // Schedule untouched → omitted so the server keeps nextRunAt + count.
      expect(putBody()).not.toHaveProperty('schedule')
    })
  })
})
