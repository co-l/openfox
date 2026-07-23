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

function makeChatErrorPayload(error: string, recoverable: boolean) {
  return {
    type: 'chat.error' as const,
    sessionId: 'session-1',
    payload: { error, recoverable },
  }
}

function makeSessionStatePayload(session: any, messages?: any[]) {
  return {
    type: 'session.state' as const,
    id: 'msg-id',
    sessionId: session.id,
    payload: {
      session,
      messages: messages ?? [],
      hiddenCount: 0,
      pendingConfirmations: [],
      pendingQuestions: [],
    },
  }
}

describe('Error banner behavior', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    fetchMock.mockClear()
  })

  // ============================================================================
  // Criterion 0: chat.error sets error and it persists (no auto-dismiss)
  // ============================================================================

  it('sets error on chat.error and does not auto-dismiss on subsequent unrelated messages', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: null,
        messages: [],
      } as any,
      error: null,
    }))

    useSessionStore.getState().handleServerMessage(makeChatErrorPayload('API key expired', false))

    expect(useSessionStore.getState().error).toEqual({
      code: 'CHAT_ERROR',
      message: 'API key expired',
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: true },
    })

    expect(useSessionStore.getState().error).toEqual({
      code: 'CHAT_ERROR',
      message: 'API key expired',
    })

    useSessionStore.getState().handleServerMessage({
      type: 'phase.changed',
      sessionId: 'session-1',
      payload: { phase: 'verification' },
    })

    expect(useSessionStore.getState().error).toEqual({
      code: 'CHAT_ERROR',
      message: 'API key expired',
    })
  })

  it('ignores chat.error for background sessions', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: null,
        messages: [],
      } as any,
      error: null,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.error',
      sessionId: 'session-2',
      payload: { error: 'background error', recoverable: false },
    })

    expect(useSessionStore.getState().error).toBeNull()
  })

  // ============================================================================
  // Criterion 1: clearError dismisses the error banner
  // ============================================================================

  it('clears error when clearError is called', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: null,
        messages: [],
      } as any,
      error: { code: 'CHAT_ERROR', message: 'Something went wrong' },
    }))

    expect(useSessionStore.getState().error).not.toBeNull()

    useSessionStore.getState().clearError()

    expect(useSessionStore.getState().error).toBeNull()
  })

  // ============================================================================
  // Criterion 2: Sending a new message clears the previous error
  // ============================================================================

  it('clears error when sendMessage is called', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: null,
        messages: [],
      } as any,
      error: { code: 'CHAT_ERROR', message: 'Provider unavailable' },
    }))

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
      status: 200,
    } as any)

    await useSessionStore.getState().sendMessage('Hello')

    expect(useSessionStore.getState().error).toBeNull()
  })

  // ============================================================================
  // Criterion 3: loadSession clears error when switching sessions
  // ============================================================================

  it('clears error when loadSession switches to a different session', async () => {
    const useSessionStore = await loadSessionStore()

    const sessionOne: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project-1',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [],
      summary: null,
      messages: [],
    }
    const sessionTwo: any = {
      id: 'session-2',
      projectId: 'project-1',
      workdir: '/tmp/project-2',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [],
      summary: null,
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: sessionOne,
      sessions: [],
      error: { code: 'CHAT_ERROR', message: 'old error' },
    }))

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          session: sessionTwo,
          messages: [],
        }),
      status: 200,
    } as any)

    await useSessionStore.getState().loadSession('session-2')

    expect(useSessionStore.getState().currentSession?.id).toBe('session-2')
    expect(useSessionStore.getState().error).toBeNull()
  })

  // ============================================================================
  // Criterion 4: Page reload clears error (covered by loadSession — same codepath)
  // ============================================================================

  // ============================================================================
  // Criterion 5: session.state does NOT overwrite error
  // ============================================================================

  it('does NOT clear error when session.state arrives (frontend-only state)', async () => {
    const useSessionStore = await loadSessionStore()

    const session: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project-1',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [],
      summary: null,
      messages: [],
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: session,
      error: { code: 'CHAT_ERROR', message: 'Rate limit exceeded' },
    }))

    useSessionStore.getState().handleServerMessage(makeSessionStatePayload(session))

    expect(useSessionStore.getState().error).toEqual({
      code: 'CHAT_ERROR',
      message: 'Rate limit exceeded',
    })
  })
})
