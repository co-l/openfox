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

const { wsSendMock, wsSubscribeMock, wsConnectMock, wsDisconnectMock, wsStatusMock, wsClearTokenMock } = vi.hoisted(
  () => ({
    wsSendMock: vi.fn(() => 'message-id'),
    wsSubscribeMock: vi.fn(() => () => undefined),
    wsConnectMock: vi.fn(async () => undefined),
    wsDisconnectMock: vi.fn(() => undefined),
    wsStatusMock: vi.fn(() => undefined),
    wsClearTokenMock: vi.fn(() => undefined),
  }),
)

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: wsSendMock,
    subscribe: wsSubscribeMock,
    connect: wsConnectMock,
    disconnect: wsDisconnectMock,
    onStatusChange: wsStatusMock,
    clearToken: wsClearTokenMock,
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

function mockAuthStatus(requiresAuth: boolean) {
  fetchMock.mockImplementation(((url: unknown) => {
    if (String(url).includes('/api/auth') && !String(url).includes('/login')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ requiresAuth, hasPassword: requiresAuth }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
  }) as never)
}

describe('session store logout', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    wsClearTokenMock.mockClear()
    fetchMock.mockClear()
  })

  it('clears the token and disconnects the live WebSocket', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({ connectionStatus: 'connected' })

    await useSessionStore.getState().logout()

    expect(wsClearTokenMock).toHaveBeenCalled()
    expect(wsDisconnectMock).toHaveBeenCalled()
    expect(useSessionStore.getState().connectionStatus).toBe('disconnected')
  })

  it('shows the password modal when the server requires auth', async () => {
    mockAuthStatus(true)
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({ connectionStatus: 'connected' })

    await useSessionStore.getState().logout()

    expect(useSessionStore.getState().showPasswordModal).toBe(true)
    expect(useSessionStore.getState().passwordModalRetry).toBe(false)
    expect(useSessionStore.getState().connectionStatus).toBe('disconnected')
  })

  it('does not show the password modal when the server does not require auth', async () => {
    mockAuthStatus(false)
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({ connectionStatus: 'connected' })

    await useSessionStore.getState().logout()

    expect(useSessionStore.getState().showPasswordModal).toBe(false)
    expect(useSessionStore.getState().connectionStatus).toBe('disconnected')
  })

  it('does not crash if the auth status fetch fails', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('network down')))
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({ connectionStatus: 'connected' })

    await useSessionStore.getState().logout()

    expect(useSessionStore.getState().showPasswordModal).toBe(false)
    expect(useSessionStore.getState().connectionStatus).toBe('disconnected')
  })
})
