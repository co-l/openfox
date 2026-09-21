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

const makeSession = (id: string) => ({
  id,
  projectId: 'project-1',
  workdir: `/tmp/${id}`,
  mode: 'builder',
  phase: 'plan',
  isRunning: true,
  criteria: [],
  summary: null,
})

function restResponse(session: { id: string }) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success: true,
        session: makeSession(session.id),
        messages: [],
        contextState: null,
        queueState: [],
        pendingQuestions: [],
      }),
  }
}

function mockSessionApis() {
  fetchMock.mockImplementation(((url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/background-processes')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ processes: [] }) })
    }
    const match = /\/sessions\/([^/?]+)/.exec(u)
    const id = match?.[1] ?? 'unknown'
    return Promise.resolve(restResponse(makeSession(id)))
  }) as never)
}

describe('split view store', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    fetchMock.mockReset()
  })

  it('loads two sessions into independent panes without refetching on reopen', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    const state = useSessionStore.getState()
    expect(state.openSessionIds).toEqual(['s1', 's2'])
    expect(state.panes['s1']?.session?.id).toBe('s1')
    expect(state.panes['s2']?.session?.id).toBe('s2')
    expect(state.focusedSessionId).toBe('s1')
    expect(state.currentSession?.id).toBe('s1')

    // Reopening an in-memory pane must not refetch (instant focus switch)
    fetchMock.mockClear()
    await useSessionStore.getState().openPane('s2', { focus: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useSessionStore.getState().focusedSessionId).toBe('s2')
    expect(useSessionStore.getState().currentSession?.id).toBe('s2')
  })

  it('routes chat deltas to the open-but-unfocused pane only', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    fetchMock.mockClear()
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 's2',
      payload: { message: { id: 'm-s2', role: 'assistant', content: '', timestamp: '2024-01-01', tokenCount: 0 } },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.todo',
      sessionId: 's2',
      payload: { todos: [{ content: 'todo in s2', status: 'pending' }] },
    })

    const state = useSessionStore.getState()
    // s2's pane got the message + todo
    expect(state.panes['s2']?.messages).toHaveLength(1)
    expect(state.panes['s2']?.messages[0]?.id).toBe('m-s2')
    expect(state.panes['s2']?.currentTodos).toHaveLength(1)
    // Flat (focused = s1) is untouched
    expect(state.messages).toHaveLength(0)
    expect(state.currentTodos).toHaveLength(0)
    // And s1 was not marked unread because it is a live pane
    expect(state.unreadSessionIds).not.toContain('s1')
  })

  it('keeps the focused pane streaming in sync with its flat aliases', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 's1',
      payload: { message: { id: 'm-s1', role: 'assistant', content: '', timestamp: '2024-01-01', tokenCount: 0 } },
    })

    const state = useSessionStore.getState()
    expect(state.panes['s1']?.messages).toHaveLength(1)
    expect(state.messages).toHaveLength(1)
  })

  it('closePane removes the pane and focuses the survivor', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().enterSplitView(['s1', 's2'], 's1')
    useSessionStore.getState().closePane('s1')

    const state = useSessionStore.getState()
    expect(state.panes['s1']).toBeUndefined()
    expect(state.openSessionIds).toEqual(['s2'])
    expect(state.focusedSessionId).toBe('s2')
    expect(state.currentSession?.id).toBe('s2')
  })

  it('reorderPane swaps a pane with its neighbour and persists', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().enterSplitView(['s1', 's2', 's3'], 's1')

    useSessionStore.getState().reorderPane('s2', -1)
    expect(useSessionStore.getState().openSessionIds).toEqual(['s2', 's1', 's3'])

    useSessionStore.getState().reorderPane('s2', 1)
    expect(useSessionStore.getState().openSessionIds).toEqual(['s1', 's2', 's3'])

    // Clamping at the edges is a no-op
    useSessionStore.getState().reorderPane('s1', -1)
    useSessionStore.getState().reorderPane('s3', 1)
    expect(useSessionStore.getState().openSessionIds).toEqual(['s1', 's2', 's3'])

    // Unknown sessions are ignored
    useSessionStore.getState().reorderPane('nope', 1)
    expect(useSessionStore.getState().openSessionIds).toEqual(['s1', 's2', 's3'])
  })

  it('does not treat normally-browsed sessions as open panes', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    // Plain navigation loads sessions into memory (focused alias + cached pane)
    // but must not accumulate them as deliberate split panes.
    await useSessionStore.getState().loadSession('s1')
    await useSessionStore.getState().loadSession('s2')

    const state = useSessionStore.getState()
    expect(state.panes['s1']?.session?.id).toBe('s1')
    expect(state.panes['s2']?.session?.id).toBe('s2')
    expect(state.currentSession?.id).toBe('s2')
    expect(state.openSessionIds).toEqual([])
  })

  it('marks non-open sessions unread on progress/retry but not live panes', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })

    // s2 is not open — progress/retry must flag it as needing attention
    useSessionStore.getState().handleServerMessage({
      type: 'chat.progress',
      sessionId: 's2',
      payload: { message: 'working', phase: 'build' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.format_retry',
      sessionId: 's2',
      payload: { attempt: 1, maxAttempts: 3 },
    })

    // s1 is a live pane — its own progress must not mark it unread
    useSessionStore.getState().handleServerMessage({
      type: 'chat.progress',
      sessionId: 's1',
      payload: { message: 'working', phase: 'build' },
    })

    const state = useSessionStore.getState()
    expect(state.unreadSessionIds).toContain('s2')
    expect(state.unreadSessionIds).not.toContain('s1')
  })

  it('exitSplitView preserves the layout for a return visit', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().enterSplitView(['s1', 's2', 's3'], 's2')
    useSessionStore.getState().exitSplitView()

    const state = useSessionStore.getState()
    expect(state.openSessionIds).toEqual(['s1', 's2', 's3'])
    expect(Object.keys(state.panes)).toEqual(['s1', 's2', 's3'])
    expect(state.focusedSessionId).toBe('s2')
  })

  it('enterSplitView populates the global sessions list for the control panel', async () => {
    const useSessionStore = await loadSessionStore()
    fetchMock.mockImplementation(((url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/sessions/home')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              sessions: [
                { ...makeSession('s1'), updatedAt: '2026-01-02T00:00:00Z' },
                { ...makeSession('s2'), updatedAt: '2026-01-01T00:00:00Z' },
                { ...makeSession('extra'), updatedAt: '2026-01-03T00:00:00Z' },
              ],
            }),
        })
      }
      if (u.includes('/background-processes')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ processes: [] }) })
      }
      const match = /\/sessions\/([^/?]+)/.exec(u)
      const id = match?.[1] ?? 'unknown'
      return Promise.resolve(restResponse(makeSession(id)))
    }) as never)

    await useSessionStore.getState().enterSplitView(['s1', 's2'], 's1')

    const state = useSessionStore.getState()
    expect(state.sessions.map((s) => s.id)).toEqual(['s1', 's2', 'extra'])
  })

  it('marks non-open sessions unread while live panes are exempt', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 's1',
      payload: { message: { id: 'a', role: 'assistant', content: '', timestamp: '2024-01-01', tokenCount: 0 } },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 's-other',
      payload: { message: { id: 'b', role: 'assistant', content: '', timestamp: '2024-01-01', tokenCount: 0 } },
    })

    expect(useSessionStore.getState().unreadSessionIds).toEqual(['s-other'])
  })

  it('keeps sibling panes reference-stable when another pane updates (render isolation)', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    const before = useSessionStore.getState().panes['s1']
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 's2',
      payload: { message: { id: 'm2', role: 'assistant', content: '', timestamp: '2024-01-01', tokenCount: 0 } },
    })

    const after = useSessionStore.getState().panes['s1']
    // Pane-scoped selectors subscribe per pane: an unchanged pane must keep its
    // exact object reference so React never re-renders its subtree.
    expect(after).toBe(before)
    expect(useSessionStore.getState().panes['s2']).not.toBe(before)
  })

  it('answers questions against the pane they belong to', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    fetchMock.mockClear()
    useSessionStore.getState().handleServerMessage({
      type: 'chat.ask_user',
      sessionId: 's2',
      payload: { callId: 'q1', question: 'Go?', type: 'confirm', options: undefined },
    })
    expect(useSessionStore.getState().panes['s2']?.pendingQuestions).toHaveLength(1)

    await useSessionStore.getState().answerQuestion('s2', 'q1', 'yes')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s2/answer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ callId: 'q1', answer: 'yes', skip: undefined }),
      }),
    )
    expect(useSessionStore.getState().panes['s2']?.pendingQuestions).toHaveLength(0)
    // Focused pane untouched
    expect(useSessionStore.getState().pendingQuestions).toHaveLength(0)
  })

  it('launches workflows against the owning pane, not the focused session', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    wsSendMock.mockClear()
    useSessionStore.getState().launchWorkflow('s2', 'ship it', undefined, 'wf-1')

    expect(wsSendMock).toHaveBeenCalledWith(
      'runner.launch',
      expect.objectContaining({ sessionId: 's2', workflowId: 'wf-1', content: 'ship it', scope: 'auto' }),
    )
  })

  it('routes a workflow resume triggered by a message to the owning pane session', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.execution_changed',
      sessionId: 's2',
      payload: {
        executionId: 'exec-1',
        workflowId: 'wf-1',
        workflowName: 'Review',
        status: 'running',
        currentStepId: 'step-1',
      },
    })

    wsSendMock.mockClear()
    useSessionStore.getState().sendMessage('s2', 'go on')

    expect(wsSendMock).toHaveBeenCalledWith(
      'runner.launch',
      expect.objectContaining({ sessionId: 's2', resumeFrom: 'step-1', content: 'go on' }),
    )
  })

  it('routes continue workflow to the owning pane session', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.execution_changed',
      sessionId: 's2',
      payload: {
        executionId: 'exec-1',
        workflowId: 'wf-1',
        workflowName: 'Review',
        status: 'waiting',
        currentStepId: 'step-2',
      },
    })

    wsSendMock.mockClear()
    useSessionStore.getState().continueWorkflow('s2')

    expect(wsSendMock).toHaveBeenCalledWith(
      'runner.launch',
      expect.objectContaining({ sessionId: 's2', resumeFrom: 'step-2' }),
    )
  })

  it('routes workflow step retries to the owning pane session', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.execution_changed',
      sessionId: 's2',
      payload: {
        executionId: 'exec-1',
        workflowId: 'wf-1',
        workflowName: 'Review',
        status: 'blocked',
        currentStepId: 'step-3',
      },
    })
    useSessionStore.setState((state) => ({
      panes: {
        ...state.panes,
        s2: { ...state.panes['s2']!, session: { ...state.panes['s2']!.session!, isRunning: false } },
      },
    }))

    wsSendMock.mockClear()
    useSessionStore.getState().retryLLM('s2')

    expect(wsSendMock).toHaveBeenCalledWith(
      'runner.launch',
      expect.objectContaining({ sessionId: 's2', resumeFrom: 'step-3' }),
    )
  })

  it('compacts context for the owning pane session', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    wsSendMock.mockClear()
    useSessionStore.getState().compactContext('s2')

    expect(wsSendMock).toHaveBeenCalledWith('context.compact', { sessionId: 's2' })
  })

  it('exits workflows for the owning pane session', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    wsSendMock.mockClear()
    useSessionStore.getState().exitWorkflow('s2')

    expect(wsSendMock).toHaveBeenCalledWith('workflow.exit', { sessionId: 's2' })
  })

  it('keeps llmRetry per pane: a failure in one pane never leaks to the sibling or flat aliases', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 's2',
      payload: { attempt: 1, retryInMs: 4000, error: 'boom' },
    })

    const state = useSessionStore.getState()
    expect(state.panes['s2']?.llmRetry).toEqual({
      status: 'retrying',
      attempt: 1,
      retryInMs: 4000,
      error: 'boom',
    })
    // Focused sibling and flat aliases stay clean
    expect(state.panes['s1']?.llmRetry).toBeNull()
    expect(state.llmRetry).toBeNull()
  })

  it('mirrors llmRetry to the flat aliases only when the focused pane owns it', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 's1',
      payload: { attempt: 2, retryInMs: 8000, error: 'boom' },
    })

    const state = useSessionStore.getState()
    expect(state.panes['s1']?.llmRetry).toEqual({
      status: 'retrying',
      attempt: 2,
      retryInMs: 8000,
      error: 'boom',
    })
    expect(state.llmRetry).toEqual({ status: 'retrying', attempt: 2, retryInMs: 8000, error: 'boom' })
    expect(state.panes['s2']?.llmRetry).toBeNull()
  })

  it('clears llmRetry only on the owning pane, leaving siblings intact', async () => {
    const useSessionStore = await loadSessionStore()
    mockSessionApis()

    await useSessionStore.getState().openPane('s1', { focus: true })
    await useSessionStore.getState().openPane('s2', { focus: false })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry',
      sessionId: 's1',
      payload: { attempt: 1, retryInMs: 90_000, error: 'boom' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.llm_retry_failed',
      sessionId: 's2',
      payload: { error: 'boom', attempts: 3 },
    })

    expect(useSessionStore.getState().panes['s1']?.llmRetry).toEqual({
      status: 'retrying',
      attempt: 1,
      retryInMs: 90_000,
      error: 'boom',
    })
    expect(useSessionStore.getState().panes['s2']?.llmRetry).toEqual({ status: 'failed', error: 'boom' })

    wsSendMock.mockClear()
    useSessionStore.getState().retryLLMNow('s2')

    expect(useSessionStore.getState().panes['s2']?.llmRetry).toBeNull()
    expect(useSessionStore.getState().panes['s1']?.llmRetry).toEqual({
      status: 'retrying',
      attempt: 1,
      retryInMs: 90_000,
      error: 'boom',
    })
    expect(useSessionStore.getState().llmRetry).toEqual({
      status: 'retrying',
      attempt: 1,
      retryInMs: 90_000,
      error: 'boom',
    })
  })
})
