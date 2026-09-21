// @vitest-environment happy-dom
/**
 * LLM Retry UI State
 *
 * - chat.llm_retry → live "retrying" pill (countdown + Retry now), clears errors
 * - chat.llm_retry_failed → calm definitive "Retry" affordance
 * - chat.done / session reload → clears the transient retry state
 * - retryLLMNow → interrupts the server-side backoff wait
 * - retryLLM → re-runs the turn (chat.retry) or re-launches a blocked workflow step
 */

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

function makeSession(id: string) {
  return {
    id,
    projectId: 'project-1',
    workdir: '/tmp/project-1',
    mode: 'builder',
    phase: 'build',
    isRunning: false,
    criteria: [],
    summary: null,
    messages: [],
  } as any
}

function setBaseState(useSessionStore: any, session: any) {
  useSessionStore.setState((state: any) => ({
    ...state,
    currentSession: session,
    messages: [{ id: 'assistant-1', role: 'assistant', content: '', isStreaming: false }],
    error: { code: 'CHAT_ERROR', message: 'LLM boom' },
    llmRetry: null,
  }))
}

describe('LLM retry UI state', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    fetchMock.mockClear()
  })

  it('chat.llm_retry sets the retrying pill state and clears the error banner', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 'session-1',
      payload: { attempt: 2, retryInMs: 4000, error: 'boom' },
    })

    expect(useSessionStore.getState().llmRetry).toEqual({
      status: 'retrying',
      attempt: 2,
      retryInMs: 4000,
      error: 'boom',
    })
    expect(useSessionStore.getState().error).toBeNull()
  })

  it('chat.llm_retry retains the error when a new attempt arrives (survives a retry)', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 'session-1',
      payload: { attempt: 1, retryInMs: 4000, error: 'boom' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 'session-1',
      payload: { attempt: 2, retryInMs: 8000, error: 'rate limited' },
    })

    expect(useSessionStore.getState().llmRetry).toEqual({
      status: 'retrying',
      attempt: 2,
      retryInMs: 8000,
      error: 'rate limited',
    })
  })

  it('chat.llm_retry_failed sets the definitive retry affordance state', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry_failed',
      sessionId: 'session-1',
      payload: { error: 'LLM boom', attempts: 3 },
    })

    expect(useSessionStore.getState().llmRetry).toEqual({ status: 'failed', error: 'LLM boom' })
    expect(useSessionStore.getState().error).toBeNull()
  })

  it('chat.done with a successful reason clears the retry state, an error reason does not', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))
    useSessionStore.setState((state: any) => ({
      ...state,
      llmRetry: { status: 'retrying', attempt: 2, retryInMs: 4000, error: 'boom' },
    }))

    // success → cleared
    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: { messageId: 'assistant-1', reason: 'step_done' },
    })
    expect(useSessionStore.getState().llmRetry).toBeNull()

    // back to retrying
    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 'session-1',
      payload: { attempt: 2, retryInMs: 4000, error: 'boom' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: { messageId: 'assistant-1', reason: 'complete' },
    })
    expect(useSessionStore.getState().llmRetry).toBeNull()

    // a failed turn's chat.done('error') keeps the state (definitive retry)
    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry_failed',
      sessionId: 'session-1',
      payload: { error: 'boom', attempts: 3 },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: { messageId: 'assistant-1', reason: 'error' },
    })
    expect(useSessionStore.getState().llmRetry).not.toBeNull()
  })

  it('resets the retry state when a session is (re)loaded', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))
    useSessionStore.setState((state: any) => ({
      ...state,
      llmRetry: { status: 'retrying', attempt: 2, retryInMs: 4000, error: 'boom' },
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.state',
      id: 'msg-id',
      sessionId: 'session-1',
      payload: {
        session: makeSession('session-1'),
        messages: [],
        hiddenCount: 0,
        pendingConfirmations: [],
        pendingQuestions: [],
      },
    })

    expect(useSessionStore.getState().llmRetry).toBeNull()
  })

  it('retryLLMNow interrupts the backoff wait via chat.llm_retry_now', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))
    useSessionStore.setState((state: any) => ({
      ...state,
      llmRetry: { status: 'retrying', attempt: 2, retryInMs: 4000, error: 'boom' },
    }))

    useSessionStore.getState().retryLLMNow('session-1')

    expect(useSessionStore.getState().llmRetry).toBeNull()
    const call = wsSendMock.mock.calls[0] as unknown as [string, any] | undefined
    expect(call).toBeDefined()
    const [type, payload] = call!
    expect(type).toBe('chat.llm_retry_now')
    expect(payload).toEqual({ sessionId: 'session-1' })
  })

  it('retryLLM re-runs a regular message turn via chat.retry (no user message re-added)', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))
    useSessionStore.setState((state: any) => ({
      ...state,
      llmRetry: { status: 'failed', error: 'boom' },
    }))

    useSessionStore.getState().retryLLM('session-1')

    expect(useSessionStore.getState().llmRetry).toBeNull()
    const call = wsSendMock.mock.calls[0] as unknown as [string, any] | undefined
    expect(call).toBeDefined()
    const [type, payload] = call!
    expect(type).toBe('chat.retry')
    expect(payload).toEqual({ sessionId: 'session-1' })
  })

  it('retryLLM re-launches a blocked workflow step via runner.launch resume', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))
    useSessionStore.setState((state: any) => ({
      ...state,
      llmRetry: { status: 'failed', error: 'boom' },
      activeWorkflowExecution: {
        id: 'exec-1',
        sessionId: 'session-1',
        workflowId: 'default',
        workflowName: 'Build & Verify',
        status: 'blocked',
        currentStepId: 'build',
        stepOutput: { content: 'x' },
        params: {},
      },
    }))

    useSessionStore.getState().retryLLM('session-1')

    expect(useSessionStore.getState().llmRetry).toBeNull()
    const call = wsSendMock.mock.calls[0] as unknown as [string, any] | undefined
    expect(call).toBeDefined()
    const [type, payload] = call!
    expect(type).toBe('runner.launch')
    expect(payload.resumeFrom).toBe('build')
    expect(payload.workflowId).toBe('default')
  })

  it('dismisses the retrying pill once the retried attempt actually streams', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 'session-1',
      payload: { attempt: 3, retryInMs: 60_000, error: 'boom' },
    })
    expect(useSessionStore.getState().llmRetry).toEqual({
      status: 'retrying',
      attempt: 3,
      retryInMs: 60_000,
      error: 'boom',
    })

    // A successful retry resumes streaming mid-turn — the pill is stale now
    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'assistant-1', content: 'still going' },
    })
    expect(useSessionStore.getState().llmRetry).toBeNull()
  })

  it('dismisses the retrying pill on tool activity too, and only for the owning pane', async () => {
    const useSessionStore = await loadSessionStore()
    setBaseState(useSessionStore, makeSession('session-1'))
    await useSessionStore.getState().openPane('sibling', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 'session-1',
      payload: { attempt: 2, retryInMs: 10_000, error: 'boom' },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_preparing',
      sessionId: 'session-1',
      payload: { messageId: 'assistant-1', index: 0, name: 'run_command', arguments: 'ls' },
    })

    expect(useSessionStore.getState().llmRetry).toBeNull()
    expect(useSessionStore.getState().panes['sibling']?.llmRetry).toBeNull()
  })
})
