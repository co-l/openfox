import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, snapshot } from './resourceCache'
import {
  boardResource,
  summariesResource,
  readBoard,
  unlinkSessionFromBoards,
  EMPTY_TASK_COUNTS,
  type BoardData,
} from './resources'
import type { ProjectTask } from '@shared/types.js'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

describe('boardResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes the cache key by projectId so wrong-scope data is impossible', () => {
    expect(boardResource.keyOf('p1')).toBe('tasks:board:p1')
    expect(boardResource.keyOf('p2')).toBe('tasks:board:p2')
    expect(boardResource.keyOf('p1')).not.toBe(boardResource.keyOf('p2'))
  })

  it('fetches the board scoped to the project endpoint', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ tasks: [], settings: {}, counts: {}, gates: [] }))
    await boardResource.refresh('p1')
    expect(authFetch).toHaveBeenCalledWith('/api/projects/p1/tasks')
  })

  it('normalizes a missing board response to empty collections', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    await boardResource.refresh('p1')
    expect(readBoard('p1')).toEqual({
      tasks: [],
      settings: { slotLimit: 1, queuePaused: false },
      counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
      gates: [],
    })
  })

  it('keeps different project boards fully isolated in the cache', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const id = url.split('/')[3]!
      return jsonResponse({ tasks: [{ id: `task-${id}` }], settings: {}, counts: {}, gates: [] })
    })
    await boardResource.refresh('p1')
    await boardResource.refresh('p2')
    expect(readBoard('p1')?.tasks[0]?.id).toBe('task-p1')
    expect(readBoard('p2')?.tasks[0]?.id).toBe('task-p2')
  })
})

describe('summariesResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes counts by projectId and hits the count endpoint', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ counts: { running: 2 } }))
    const data = await summariesResource.refresh('p1')
    expect(authFetch).toHaveBeenCalledWith('/api/projects/p1/tasks/count')
    expect(data?.counts.running).toBe(2)
    expect(summariesResource.keyOf('p1')).toBe('tasks:counts:p1')
    expect(summariesResource.keyOf('p2')).not.toBe(summariesResource.keyOf('p1'))
  })

  it('guards an empty projectId without issuing a malformed request', async () => {
    const data = await summariesResource.refresh('')
    expect(data?.counts).toEqual(EMPTY_TASK_COUNTS)
    expect(authFetch).not.toHaveBeenCalled()
  })

  it('board guards an empty projectId without issuing a malformed request', async () => {
    const data = await boardResource.refresh('')
    expect(data?.tasks).toEqual([])
    expect(authFetch).not.toHaveBeenCalled()
  })
})

describe('WS write-through reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('WS push writes into the board entry with no duplicate fetch', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ tasks: [{ id: 'a' }], settings: {}, counts: {}, gates: [] }))
    await boardResource.refresh('p1')
    expect(authFetch).toHaveBeenCalledTimes(1)

    const pushed = {
      tasks: [{ id: 'b' }],
      settings: { slotLimit: 3, queuePaused: true },
      counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
      gates: [],
    } as unknown as BoardData
    boardResource.write(
      {
        ...(readBoard('p1') as unknown as BoardData),
        ...pushed,
      },
      'p1',
    )
    expect(readBoard('p1')?.tasks[0]?.id).toBe('b')
    expect(readBoard('p1')?.settings.slotLimit).toBe(3)
    // No refetch storm: the push only wrote into the cache.
    expect(authFetch).toHaveBeenCalledTimes(1)
  })

  it('WS push on a never-fetched key materializes the entry without fetching', () => {
    boardResource.write(
      {
        tasks: [],
        settings: { slotLimit: 1, queuePaused: false },
        counts: { open: 0, backlog: 0, todo: 0, inProgress: 0, running: 0, queued: 0, review: 0, done: 0 },
        gates: [],
      },
      'p2',
    )
    expect(snapshot<BoardData>(boardResource.keyOf('p2')).data?.settings.slotLimit).toBe(1)
    expect(authFetch).not.toHaveBeenCalled()
  })
})

describe('unlinkSessionFromBoards (instant detach on session.deleted)', () => {
  const task = (id: string, extra: Record<string, unknown> = {}): ProjectTask => ({
    id,
    projectId: 'p1',
    prompt: 'x',
    attachments: [],
    status: 'todo' as const,
    position: 0,
    version: 1,
    sessionIds: [],
    gateValues: [],
    auditTrail: [],
    createdAt: '',
    updatedAt: '',
    ...extra,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('drops the deleted session from cached boards immediately', () => {
    boardResource.write(
      {
        tasks: [
          task('t1', { sessionIds: ['s-dead', 's-alive'], activeSessionId: 's-dead' }),
          task('t2', { sessionIds: ['s-other'] }),
        ],
        settings: { slotLimit: 1, queuePaused: false },
        counts: EMPTY_TASK_COUNTS,
        gates: [],
      },
      'p1',
    )

    unlinkSessionFromBoards('s-dead')

    const board = readBoard('p1')!
    expect(board.tasks.find((t) => t.id === 't2')?.sessionIds).toEqual(['s-other'])
    const t1 = board.tasks.find((t) => t.id === 't1')!
    expect(t1.sessionIds).toEqual(['s-alive'])
    expect(t1.activeSessionId).toBeUndefined()
  })

  it('clears the planned flag when the last session of a planned todo card dies', () => {
    boardResource.write(
      {
        tasks: [task('t1', { sessionIds: ['s-dead'], activeSessionId: 's-dead', planned: true })],
        settings: { slotLimit: 1, queuePaused: false },
        counts: EMPTY_TASK_COUNTS,
        gates: [],
      },
      'p1',
    )

    unlinkSessionFromBoards('s-dead')

    const t1 = readBoard('p1')!.tasks.find((t) => t.id === 't1')!
    expect(t1.planned).toBeFalsy()
  })

  it('invalidates from-session views keyed by the deleted session', async () => {
    const { taskFromSessionResource } = await import('./resources')
    taskFromSessionResource.write(task('t1', { sessionIds: ['s-dead'] }) as never, 'p1', 's-dead')

    unlinkSessionFromBoards('s-dead')

    expect(snapshot(taskFromSessionResource.keyOf('p1', 's-dead')).data).toBeUndefined()
  })
})
