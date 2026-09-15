// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

const SERVER_AT = '2026-09-13T05:06:07.008Z'

const defaultFetch = () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }), status: 200 } as never)

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(defaultFetch)
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
})

const wsMocks = vi.hoisted(() => ({
  send: vi.fn(() => 'message-id'),
  subscribe: vi.fn(() => () => undefined),
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(() => undefined),
  onStatusChange: vi.fn(() => undefined),
}))

vi.mock('../../lib/ws', () => ({ wsClient: wsMocks }))
vi.mock('../../lib/sound', () => ({
  playNotification: vi.fn(),
  playAchievement: vi.fn(),
  playIntervention: vi.fn(),
  playWaitingForUser: vi.fn(),
  playNewMessage: vi.fn(),
}))

async function loadSessionStore() {
  vi.resetModules()
  const module = await import('../session')
  return module.useSessionStore
}

function summary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    projectId: 'p1',
    workdir: '/tmp/p1',
    mode: 'planner',
    phase: 'plan',
    isRunning: false,
    isFavorite: false,
    createdAt: 'a',
    updatedAt: 'b',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
    ...over,
  }
}

function seed(useSessionStore: Awaited<ReturnType<typeof loadSessionStore>>, sessions: Record<string, unknown>[]) {
  useSessionStore.setState((state) => ({ ...state, sessions: sessions as never }) as never)
}

describe('endSession / cancelEndSession', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('marks the session closing when the server ran the routine', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary()])

    // POST end-session -> closing, then the scoped list reload
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ closing: true, command: 'end-of-session' }),
    } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [summary({ closingAt: '2026-09-13T00:00:00.000Z' })], hasMore: false }),
    } as never)

    const result = await useSessionStore.getState().endSession('s1')

    expect(result).toBe('closing')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/s1/end-session')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(useSessionStore.getState().sessions[0]?.closingAt).toBe('2026-09-13T00:00:00.000Z')
  })

  it('reports a plain delete when the routine is disabled server-side', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary()])

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ deleted: true }),
    } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], hasMore: false }),
    } as never)

    const result = await useSessionStore.getState().endSession('s1')

    expect(result).toBe('deleted')
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('cancelEndSession clears the closing marker', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary({ closingAt: '2026-09-13T00:00:00.000Z' })])

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [summary()], hasMore: false }),
    } as never)

    await useSessionStore.getState().cancelEndSession('s1')

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
    expect(useSessionStore.getState().sessions[0]?.closingAt).toBeUndefined()
  })
})

describe('final deleteSession', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  afterEach(() => {
    fetchMock.mockImplementation(defaultFetch)
  })

  it('treats an already-deleted session (404) as gone', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary({ closingAt: '2026-09-13T00:00:00.000Z' })])
    useSessionStore.setState((state) => ({ ...state, currentSession: summary() }) as never as never)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' && String(input) === '/api/sessions/s1'
        ? Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [], hasMore: false }),
          } as never),
    )

    const deleted = await useSessionStore.getState().deleteSession('s1')

    expect(deleted).toBe(true)
    expect(useSessionStore.getState().sessions).toEqual([])
    expect(useSessionStore.getState().currentSession).toBeNull()
  })

  it('resyncs the session list when the delete fails', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary({ closingAt: '2026-09-13T00:00:00.000Z' })])

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' && String(input) === '/api/sessions/s1'
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ sessions: [summary({ closingAt: '2026-09-13T00:00:00.000Z' })], hasMore: false }),
          } as never),
    )

    const deleted = await useSessionStore.getState().deleteSession('s1')

    expect(deleted).toBe(false)
    // DELETE first, then the reconciliation reload - a silent no-op would stop
    // after the first call.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/sessions/s1')
    expect(String(fetchMock.mock.calls[1]?.[0]).startsWith('/api/sessions?')).toBe(true)
    expect(useSessionStore.getState().sessions[0]?.closingAt).toBe('2026-09-13T00:00:00.000Z')
  })

  it('resyncs when the delete request never reaches the server', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary({ closingAt: '2026-09-13T00:00:00.000Z' })])

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' && String(input) === '/api/sessions/s1'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ sessions: [summary({ closingAt: '2026-09-13T00:00:00.000Z' })], hasMore: false }),
          } as never),
    )

    const deleted = await useSessionStore.getState().deleteSession('s1')

    expect(deleted).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useSessionStore.getState().sessions[0]?.closingAt).toBe('2026-09-13T00:00:00.000Z')
  })
})

describe('session.closing websocket event', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('patches the closing badge across the session list without a refetch', async () => {
    const useSessionStore = await loadSessionStore()
    seed(useSessionStore, [summary()])

    useSessionStore.getState().handleServerMessage({
      type: 'session.closing',
      sessionId: 's1',
      payload: { closingAt: '2026-09-13T01:00:00.000Z' },
    } as never)

    expect(useSessionStore.getState().sessions[0]?.closingAt).toBe('2026-09-13T01:00:00.000Z')

    useSessionStore.getState().handleServerMessage({
      type: 'session.closing',
      sessionId: 's1',
      payload: { closingAt: null },
    } as never)
    expect(useSessionStore.getState().sessions[0]?.closingAt).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('closing state in an open pane', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  afterEach(() => {
    fetchMock.mockImplementation(defaultFetch)
  })

  function seedPane(useSessionStore: Awaited<ReturnType<typeof loadSessionStore>>, closingAt?: string) {
    seed(useSessionStore, [summary(closingAt ? { closingAt } : {})])
    useSessionStore.setState(((state: Record<string, unknown>) => ({
      ...state,
      focusedSessionId: 's1',
      panes: { ...(state.panes as object), s1: { session: summary(closingAt ? { closingAt } : {}) } },
    })) as never)
  }

  const paneClosingAt = (useSessionStore: Awaited<ReturnType<typeof loadSessionStore>>) =>
    useSessionStore.getState().panes['s1']?.session?.closingAt

  it('patches the open pane with the server timestamp, not a client clock', async () => {
    const useSessionStore = await loadSessionStore()
    seedPane(useSessionStore)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(input) === '/api/sessions/s1/end-session'
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ closing: true, command: 'end-of-session' }),
          } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [summary({ closingAt: SERVER_AT })], hasMore: false }),
          } as never),
    )

    expect(await useSessionStore.getState().endSession('s1')).toBe('closing')
    expect(paneClosingAt(useSessionStore)).toBe(SERVER_AT)
  })

  it('reports closing when the response is lost but the session survived', async () => {
    const useSessionStore = await loadSessionStore()
    seedPane(useSessionStore)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(input) === '/api/sessions/s1/end-session'
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [summary({ closingAt: SERVER_AT })], hasMore: false }),
          } as never),
    )

    expect(await useSessionStore.getState().endSession('s1')).toBe('closing')
    expect(paneClosingAt(useSessionStore)).toBe(SERVER_AT)
  })

  it('reports deleted when the session is gone after a failed request', async () => {
    const useSessionStore = await loadSessionStore()
    seedPane(useSessionStore)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(input) === '/api/sessions/s1/end-session'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [], hasMore: false }),
          } as never),
    )

    expect(await useSessionStore.getState().endSession('s1')).toBe('deleted')
  })

  it('keeps the closing state when cancelling fails', async () => {
    const useSessionStore = await loadSessionStore()
    seedPane(useSessionStore, SERVER_AT)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' && String(input) === '/api/sessions/s1/end-session'
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [summary({ closingAt: SERVER_AT })], hasMore: false }),
          } as never),
    )

    await useSessionStore.getState().cancelEndSession('s1')

    expect(paneClosingAt(useSessionStore)).toBe(SERVER_AT)
    expect(useSessionStore.getState().sessions[0]?.closingAt).toBe(SERVER_AT)
  })

  it('clears the closing state when cancelling succeeds', async () => {
    const useSessionStore = await loadSessionStore()
    seedPane(useSessionStore, SERVER_AT)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' && String(input) === '/api/sessions/s1/end-session'
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [summary()], hasMore: false }),
          } as never),
    )

    await useSessionStore.getState().cancelEndSession('s1')

    expect(paneClosingAt(useSessionStore)).toBeUndefined()
  })

  it('reports an error without touching the session when the routine cannot run', async () => {
    const useSessionStore = await loadSessionStore()
    seedPane(useSessionStore, SERVER_AT)

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(input) === '/api/sessions/s1/end-session'
        ? Promise.resolve({
            ok: false,
            status: 409,
            json: () => Promise.resolve({ error: 'End-of-session command "ghost" cannot run', reason: 'not_found' }),
          } as never)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ sessions: [summary({ closingAt: SERVER_AT })], hasMore: false }),
          } as never),
    )

    expect(await useSessionStore.getState().endSession('s1')).toBe('error')
    // Nothing was deleted and no closing badge was painted over the pane.
    expect(useSessionStore.getState().sessions.find((s) => s.id === 's1')).toBeDefined()
    expect(useSessionStore.getState().currentSession?.closingAt).toBeUndefined()
  })
})
