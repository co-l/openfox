// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTasksStore } from './tasks'
import { clearCache } from '../lib/resourceCache'
import { boardResource, summariesResource, readBoard, type TaskCountsData } from '../lib/resources'
import { snapshot } from '../lib/resourceCache'
import type { TasksUpdatePayload } from '@shared/protocol.js'

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

const EMPTY_COUNTS = { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 }

function seedBoard(projectId = 'proj-1') {
  boardResource.write(
    { tasks: [], settings: { slotLimit: 1, queuePaused: false }, counts: EMPTY_COUNTS, gates: [] },
    projectId,
  )
}

describe('useTasksStore', () => {
  beforeEach(() => {
    clearCache()
    useTasksStore.setState({ lastError: null, lastAutoLaunch: null })
    seedBoard()
  })

  describe('handleTasksUpdate (WS write-through)', () => {
    it('writes the pushed payload into the board cache entry with no fetch', () => {
      const payload: TasksUpdatePayload = {
        projectId: 'proj-1',
        tasks: [makeTask('a', 'in_progress', { runState: 'queued' }) as never],
        settings: { slotLimit: 1, queuePaused: true },
        counts: { open: 1, backlog: 0, todo: 0, inProgress: 1, running: 1, queued: 0, review: 0, done: 0 },
      }
      useTasksStore.getState().handleTasksUpdate(payload)

      const board = readBoard('proj-1')
      expect(board?.tasks[0]?.runState).toBe('queued')
      expect(board?.settings.queuePaused).toBe(true)
      expect(board?.counts.open).toBe(1)
    })

    it('writes counts into the per-project summaries resource', () => {
      useTasksStore.getState().handleTasksUpdate({
        projectId: 'p-other',
        counts: { open: 2, backlog: 0, todo: 1, inProgress: 1, running: 1, queued: 0, review: 0, done: 0 },
      } as TasksUpdatePayload)
      expect(snapshot<TaskCountsData>(summariesResource.keyOf('p-other')).data?.counts.running).toBe(1)
    })

    it('captures auto-launched info and clears it on demand', () => {
      useTasksStore.getState().handleTasksUpdate({
        projectId: 'proj-1',
        autoLaunched: { taskId: 'a', taskTitle: 'Task A', sessionId: 'sess-1', projectId: 'proj-1' },
      } as TasksUpdatePayload)
      expect(useTasksStore.getState().lastAutoLaunch).toMatchObject({
        taskId: 'a',
        sessionId: 'sess-1',
        projectId: 'proj-1',
      })
      useTasksStore.getState().clearAutoLaunch()
      expect(useTasksStore.getState().lastAutoLaunch).toBeNull()
    })
  })

  describe('setSettings (optimistic stepper)', () => {
    it('reflects the change in the board cache before the server responds', async () => {
      const authFetch = (await import('../lib/api')).authFetch as ReturnType<typeof vi.fn>

      let resolveRequest!: (value: unknown) => void
      authFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )

      const inflight = useTasksStore.getState().setSettings('proj-1', { slotLimit: 2 })
      // Optimistic: the stepper sees the new limit while the PUT is still in flight.
      expect(readBoard('proj-1')?.settings.slotLimit).toBe(2)

      resolveRequest({
        ok: true,
        json: async () => ({ settings: { slotLimit: 2, queuePaused: false } }),
      } as unknown as Response)
      await expect(inflight).resolves.toBe(true)
    })

    it('does not clobber another project board with a non-active project write', async () => {
      const authFetch = (await import('../lib/api')).authFetch as ReturnType<typeof vi.fn>
      seedBoard('proj-2')
      authFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ settings: { slotLimit: 4, queuePaused: false } }),
      } as unknown as Response)

      await useTasksStore.getState().setSettings('proj-2', { slotLimit: 4 })
      expect(readBoard('proj-1')?.settings.slotLimit).toBe(1)
      expect(readBoard('proj-2')?.settings.slotLimit).toBe(4)
    })
  })
})
