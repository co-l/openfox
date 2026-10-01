// @vitest-environment happy-dom
import type { Session } from '@shared/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }))
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
  send: wsSendMock,
  subscribe: wsSubscribeMock,
  connect: wsConnectMock,
  disconnect: wsDisconnectMock,
  onStatusChange: wsStatusMock,
}))

vi.mock('../../lib/sound', () => ({
  playNotification: vi.fn(),
  playAchievement: vi.fn(),
  playIntervention: vi.fn(),
  playWaitingForUser: vi.fn(),
  playNewMessage: vi.fn(),
}))

import { emptyPane } from './panes.js'

type SessionStoreModule = typeof import('../session')

async function loadSessionStore(): Promise<SessionStoreModule['useSessionStore']> {
  vi.resetModules()
  const module = await import('../session')
  return module.useSessionStore
}

const minimalSession: Session = {
  id: 'session-1',
  projectId: 'project-1',
  workdir: '/tmp/project-1',
  mode: 'builder',
  phase: 'plan',
  isRunning: false,
  createdAt: 'a',
  updatedAt: 'b',
  messages: [],
  criteria: [],
  contextWindows: [],
  executionState: null,
  metadata: { totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
  metadataEntries: {},
}

describe('useSessionStore setNightMode', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('PUTs the night mode flag and updates the pane session', async () => {
    const useSessionStore = await loadSessionStore()
    const updated = { ...minimalSession, nightMode: true }
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ session: updated }) })

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: minimalSession,
      panes: { ...state.panes, 'session-1': { ...emptyPane(), session: minimalSession } },
    }))

    const ok = await useSessionStore.getState().setNightMode('session-1', true)

    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions/session-1/night-mode')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ nightMode: true })
    expect(useSessionStore.getState().panes['session-1']?.session?.nightMode).toBe(true)
    expect(useSessionStore.getState().currentSession?.nightMode).toBe(true)
  })

  it('returns false without fetching when the session pane is missing', async () => {
    const useSessionStore = await loadSessionStore()
    await expect(useSessionStore.getState().setNightMode('missing-session', true)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
