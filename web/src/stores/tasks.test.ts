// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTasksStore } from './tasks'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const makeTask = (
  id: string,
  status: 'todo' | 'in_progress' | 'done' = 'todo',
  extra: Record<string, unknown> = {},
) => ({
  id,
  projectId: 'proj-1',
  title: `Task ${id}`,
  prompt: 'Do the thing',
  attachments: [],
  status,
  position: 0,
  version: 1,
  sessionIds: [],
  gateValues: [],
  auditTrail: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

describe('useTasksStore', () => {
  beforeEach(() => {
    useTasksStore.setState({
      tasks: [],
      gates: [],
      settings: { slotLimit: 1, queuePaused: false },
      counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
      summaries: {},
      activeProjectId: null,
      lastError: null,
      lastAutoLaunch: null,
    })
  })

  describe('handleTasksUpdate (streaming/fetch parity)', () => {
    it('ignores updates for a different project', () => {
      useTasksStore.getState().handleTasksUpdate({
        projectId: 'other',
        tasks: [makeTask('a')],
        settings: { slotLimit: 2, queuePaused: false },
        counts: { open: 1, todo: 1, inProgress: 0, running: 0, queued: 0, done: 0 },
      })
      expect(useTasksStore.getState().tasks).toHaveLength(0)
    })

    it('applies updates for the active project with the same shape as fetch', () => {
      useTasksStore.setState({ activeProjectId: 'proj-1' })
      useTasksStore.getState().handleTasksUpdate({
        projectId: 'proj-1',
        tasks: [makeTask('a', 'in_progress', { runState: 'queued' })],
        settings: { slotLimit: 1, queuePaused: true },
        counts: { open: 1, todo: 0, inProgress: 1, running: 1, queued: 0, done: 0 },
      })
      const state = useTasksStore.getState()
      expect(state.tasks).toHaveLength(1)
      expect(state.tasks[0]?.runState).toBe('queued')
      expect(state.settings.queuePaused).toBe(true)
      expect(state.counts.open).toBe(1)
    })

    it('captures auto-launched info and clears it on demand', () => {
      useTasksStore.setState({ activeProjectId: 'proj-1' })
      useTasksStore.getState().handleTasksUpdate({
        projectId: 'proj-1',
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
        autoLaunched: { taskId: 'a', taskTitle: 'Task A', sessionId: 'sess-1', projectId: 'proj-1' },
      })
      expect(useTasksStore.getState().lastAutoLaunch).toMatchObject({
        taskId: 'a',
        sessionId: 'sess-1',
        projectId: 'proj-1',
      })
      useTasksStore.getState().clearAutoLaunch()
      expect(useTasksStore.getState().lastAutoLaunch).toBeNull()
    })
  })

  describe('summaries (per-project counts for the homepage)', () => {
    it('loads counts per project into the summaries map', async () => {
      const authFetch = (await import('../lib/api')).authFetch as ReturnType<typeof vi.fn>
      authFetch.mockImplementation(async (url: string) => {
        if (url.includes('/p1/tasks/count')) {
          return {
            ok: true,
            json: async () => ({
              counts: { open: 3, todo: 1, inProgress: 2, running: 1, queued: 1, done: 1 },
            }),
          } as unknown as Response
        }
        if (url.includes('/p2/tasks/count')) {
          return {
            ok: true,
            json: async () => ({
              counts: { open: 0, todo: 0, inProgress: 0, running: 0, queued: 0, done: 0 },
            }),
          } as unknown as Response
        }
        return { ok: true, json: async () => ({}) } as unknown as Response
      })

      await useTasksStore.getState().loadSummaries(['p1', 'p2'])

      const { summaries } = useTasksStore.getState()
      expect(summaries['p1']?.running).toBe(1)
      expect(summaries['p1']?.queued).toBe(1)
      expect(summaries['p1']?.done).toBe(1)
      expect(summaries['p2']?.todo).toBe(0)
    })

    it('refreshes summaries from WS updates even for non-active projects', () => {
      useTasksStore.setState({ activeProjectId: 'other' })
      useTasksStore.getState().handleTasksUpdate({
        projectId: 'p1',
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 2, todo: 1, inProgress: 1, running: 1, queued: 0, done: 0 },
      })

      // Summary updated although p1 is not the active board…
      expect(useTasksStore.getState().summaries['p1']?.running).toBe(1)
      // …while the single-board state stays untouched.
      expect(useTasksStore.getState().tasks).toHaveLength(0)
    })
  })

  describe('setSettings (optimistic stepper)', () => {
    it('reflects the change locally before the server responds', async () => {
      const authFetch = (await import('../lib/api')).authFetch as ReturnType<typeof vi.fn>
      useTasksStore.setState({ activeProjectId: 'proj-1', settings: { slotLimit: 1, queuePaused: false } })

      let resolveRequest!: (value: unknown) => void
      authFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )

      const inflight = useTasksStore.getState().setSettings('proj-1', { slotLimit: 2 })
      // Optimistic: the stepper sees the new limit while the PUT is still in flight.
      expect(useTasksStore.getState().settings.slotLimit).toBe(2)

      resolveRequest({
        ok: true,
        json: async () => ({ settings: { slotLimit: 2, queuePaused: false } }),
      } as unknown as Response)
      await expect(inflight).resolves.toBe(true)
    })

    it('does not clobber the active board settings with a non-active project write', async () => {
      const authFetch = (await import('../lib/api')).authFetch as ReturnType<typeof vi.fn>
      useTasksStore.setState({ activeProjectId: 'proj-1', settings: { slotLimit: 1, queuePaused: false } })
      authFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ settings: { slotLimit: 4, queuePaused: false } }),
      } as unknown as Response)

      await useTasksStore.getState().setSettings('proj-2', { slotLimit: 4 })
      expect(useTasksStore.getState().settings.slotLimit).toBe(1)
    })
  })
})
