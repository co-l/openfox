// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskEditor } from './TaskEditor'
import { useTasksStore } from '../../stores/tasks'
import { useAgentsStore } from '../../stores/agents'
import { authFetch } from '../../lib/api'
import type { ProjectTask } from '@shared/types.js'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

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
    document.body.innerHTML = ''
    localStorage.clear()
    useTasksStore.setState({
      tasks: [],
      gates: [],
      settings: { slotLimit: 1, queuePaused: false },
      counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
      activeProjectId: null,
      lastError: null,
      lastAutoLaunch: null,
    })
    // Real-world ordering: builder sorts first, but the configured default agent
    // is planner — a new task must NOT pin the first agent in the list.
    useAgentsStore.setState({
      defaults: [
        { id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] },
        { id: 'planner', name: 'Planner', description: '', subagent: false, allowedTools: [] },
        { id: 'explorer', name: 'Explorer', description: '', subagent: false, allowedTools: [] },
      ],
      userItems: [],
    })
    vi.mocked(authFetch).mockReset()
    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response)
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

  it('loads the agent list on mount so the dropdown is never empty', () => {
    const fetchAgents = vi.fn()
    useAgentsStore.setState({ defaults: [], userItems: [], fetchAgents })
    render(<TaskEditor projectId="proj-1" onClose={() => {}} onSaved={() => {}} />)
    expect(fetchAgents).toHaveBeenCalled()
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

  it('saves via Shift+Enter and clears the draft', async () => {
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
    fireEvent.keyDown(promptEl, { key: 'Enter', shiftKey: true })
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
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', shiftKey: true })
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
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', shiftKey: true })
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
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', shiftKey: true })
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
      fireEvent.keyDown(screen.getByPlaceholderText(/Describe the task/i), { key: 'Enter', shiftKey: true })
      await waitFor(() => expect(putBody()).toBeTruthy())
      expect(putBody().model).toBeNull()
      expect(putBody().providerId).toBeNull()
    })
  })
})
