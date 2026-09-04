// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types.js'
import type { SessionStatePayload } from '@shared/protocol.js'

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

const {
  wsSendMock,
  wsSubscribeMock,
  wsConnectMock,
  wsDisconnectMock,
  wsStatusMock,
  playNotificationMock,
  playAchievementMock,
  playInterventionMock,
  playWaitingForUserMock,
  playNewMessageMock,
} = vi.hoisted(() => ({
  wsSendMock: vi.fn(() => 'message-id'),
  wsSubscribeMock: vi.fn(() => () => undefined),
  wsConnectMock: vi.fn(async () => undefined),
  wsDisconnectMock: vi.fn(() => undefined),
  wsStatusMock: vi.fn(() => undefined),
  playNotificationMock: vi.fn(),
  playAchievementMock: vi.fn(),
  playInterventionMock: vi.fn(),
  playWaitingForUserMock: vi.fn(),
  playNewMessageMock: vi.fn(),
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
  playNotification: playNotificationMock,
  playAchievement: playAchievementMock,
  playIntervention: playInterventionMock,
  playWaitingForUser: playWaitingForUserMock,
  playNewMessage: playNewMessageMock,
}))

type SessionStoreModule = typeof import('../session')

async function loadSessionStore(): Promise<SessionStoreModule['useSessionStore']> {
  vi.resetModules()
  const module = await import('../session')
  return module.useSessionStore
}

function makeSession(id: string, pauseState: Session['pauseState'] = 'none'): Session {
  return {
    id,
    projectId: 'project-1',
    workdir: '/tmp/project',
    mode: 'planner',
    phase: 'build',
    isRunning: true,
    pauseState,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: { totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    metadataEntries: {},
  }
}

function readPauseState(useSessionStore: SessionStoreModule['useSessionStore'], sessionId: string) {
  const state = useSessionStore.getState()
  const panePause = state.panes[sessionId]?.session?.pauseState
  const flatPause = state.currentSession?.id === sessionId ? state.currentSession?.pauseState : undefined
  return { panePause, flatPause }
}

describe('session pause state', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('session.pause updates the live session pauseState', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: makeSession('session-1', 'none'),
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.pause',
      sessionId: 'session-1',
      payload: { pauseState: 'paused' },
    } as any)

    const { panePause, flatPause } = readPauseState(useSessionStore, 'session-1')
    expect(panePause).toBe('paused')
    expect(flatPause).toBe('paused')
  })

  it('session.pause ignores non-live sessions', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: makeSession('session-1', 'none'),
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.pause',
      sessionId: 'session-other',
      payload: { pauseState: 'paused' },
    } as any)

    const { flatPause } = readPauseState(useSessionStore, 'session-1')
    expect(flatPause).toBe('none')
  })

  it('session.state reload restores the pause state (streaming/fetch parity)', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: makeSession('session-1', 'none'),
    }))

    const payload: SessionStatePayload = {
      session: makeSession('session-1', 'paused'),
      messages: [],
      pendingConfirmations: [],
    }

    useSessionStore.getState().handleServerMessage({
      type: 'session.state',
      sessionId: 'session-1',
      payload,
    } as any)

    const { panePause, flatPause } = readPauseState(useSessionStore, 'session-1')
    expect(panePause).toBe('paused')
    expect(flatPause).toBe('paused')
  })
})
