// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

const fetchMock = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }), status: 200 }),
)
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
})

const { wsSendMock, wsSubscribeMock, wsConnectMock, wsDisconnectMock, wsStatusMock } = vi.hoisted(() => ({
  wsSendMock: vi.fn(() => 'message-id'),
  wsSubscribeMock: vi.fn(() => () => undefined),
  wsConnectMock: vi.fn(async () => undefined),
  wsDisconnectMock: vi.fn(() => undefined),
  wsStatusMock: vi.fn(() => undefined),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: wsSendMock,
    subscribe: wsSubscribeMock,
    connect: wsConnectMock,
    disconnect: wsDisconnectMock,
    onStatusChange: wsStatusMock,
  },
}))

vi.mock('../../lib/sound', () => ({
  playNotification: vi.fn(),
  playAchievement: vi.fn(),
  playIntervention: vi.fn(),
  playWaitingForUser: vi.fn(),
  playNewMessage: vi.fn(),
}))

type SessionStoreModule = typeof import('../session')

async function loadSessionStore(): Promise<SessionStoreModule['useSessionStore']> {
  vi.resetModules()
  const module = await import('../session')
  return module.useSessionStore
}

describe('reconnect refreshes current session content', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    fetchMock.mockClear()
  })

  it('calls loadSession when reconnecting with an active session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-active',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    })

    const loadSessionSpy = vi.spyOn(useSessionStore.getState(), 'loadSession')

    await useSessionStore.getState().connect()

    vi.runAllTimers()
    vi.useRealTimers()

    const cb = (wsStatusMock.mock.calls[0] as Array<(s: string) => void>)[0]!
    ;(cb as (s: string) => void)('connected')

    expect(loadSessionSpy).toHaveBeenCalledWith('session-active')
  })

  it('does not call loadSession when reconnecting without an active session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: null,
    })

    const loadSessionSpy = vi.spyOn(useSessionStore.getState(), 'loadSession')

    await useSessionStore.getState().connect()

    vi.runAllTimers()
    vi.useRealTimers()

    const cb = (wsStatusMock.mock.calls[0] as Array<(s: string) => void>)[0]!
    ;(cb as (s: string) => void)('connected')

    expect(loadSessionSpy).not.toHaveBeenCalled()
  })

  it('handles queue.state with undefined messages gracefully', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({
      queuedMessages: [{ queueId: '1', content: 'test', mode: 'asap' as const, queuedAt: '2024-01-01T00:00:00.000Z' }],
    })
    expect(useSessionStore.getState().queuedMessages).toHaveLength(1)

    useSessionStore.getState().handleServerMessage({
      type: 'queue.state',
      payload: { messages: undefined as unknown as [] },
    })
    expect(useSessionStore.getState().queuedMessages).toEqual([])
  })

  it('handles queue.state with valid messages', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({ queuedMessages: [] })

    useSessionStore.getState().handleServerMessage({
      type: 'queue.state',
      payload: {
        messages: [
          { queueId: '1', content: 'test1', mode: 'completion' as const, queuedAt: '2024-01-01T00:00:00.000Z' },
          { queueId: '2', content: 'test2', mode: 'asap' as const, queuedAt: '2024-01-01T00:00:00.000Z' },
        ],
      },
    })
    expect(useSessionStore.getState().queuedMessages).toHaveLength(2)
  })

  it('refreshes the projects resource when connection status becomes connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const useSessionStore = await loadSessionStore()

    const { projectsResource } = await import('../../lib/resources')
    const refreshSpy = vi.spyOn(projectsResource, 'refresh')

    await useSessionStore.getState().connect()

    vi.runAllTimers()
    vi.useRealTimers()

    const cb = (wsStatusMock.mock.calls[0] as Array<(s: string) => void>)[0]!
    ;(cb as (s: string) => void)('connected')

    expect(refreshSpy).toHaveBeenCalled()
  })

  it('refetches the active session after an automatic reconnect (reconnecting status clears the guard)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const useSessionStore = await loadSessionStore()

    fetchMock.mockImplementation(((url?: unknown) => {
      const u = String(url ?? '')
      if (u.includes('/api/sessions/session-active') && !u.includes('background-processes')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              session: {
                id: 'session-active',
                projectId: 'project-1',
                workdir: '/tmp/project-1',
                mode: 'planner',
                phase: 'plan',
                isRunning: false,
                criteria: [],
              },
              messages: [],
              hiddenCount: 0,
            }),
        })
      }
      if (u.includes('background-processes')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ processes: [] }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
    }) as never)

    useSessionStore.setState({
      currentSession: {
        id: 'session-active',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    })

    // First connect + load
    await useSessionStore.getState().connect()
    const cb = (wsStatusMock.mock.calls[0] as Array<(s: string) => void>)[0]!
    ;(cb as (s: string) => void)('connected')
    await vi.runAllTimersAsync()

    // Automatic reconnect: reconnecting clears the sequential guard
    ;(cb as (s: string) => void)('reconnecting')
    ;(cb as (s: string) => void)('connected')
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    const sessionFetches = fetchMock.mock.calls.filter(
      (c) =>
        String((c as unknown[])[0]).includes('/api/sessions/session-active') &&
        !String((c as unknown[])[0]).includes('/background-processes'),
    ).length
    expect(sessionFetches).toBe(2)
  })

  it('force reload bypasses the in-flight guard', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-active',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    })

    // Start a normal load (no await), then force reload while it is in flight
    const loadPromise = useSessionStore.getState().loadSession('session-active')
    await useSessionStore.getState().loadSession('session-active', true)
    await loadPromise
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    const sessionFetches = fetchMock.mock.calls.filter(
      (c) =>
        String((c as unknown[])[0]).includes('/api/sessions/session-active') &&
        !String((c as unknown[])[0]).includes('/background-processes'),
    ).length
    expect(sessionFetches).toBe(2)
  })
})
