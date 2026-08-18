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

describe('session.name_generated handler', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    playNotificationMock.mockClear()
    playAchievementMock.mockClear()
    playInterventionMock.mockClear()
    playWaitingForUserMock.mockClear()
    playNewMessageMock.mockClear()
    fetchMock.mockClear()
  })

  it('should NOT modify updatedAt when a session name is generated', async () => {
    const useSessionStore = await loadSessionStore()

    const originalUpdatedAt = '2024-01-01T00:00:00.000Z'

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/test',
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: originalUpdatedAt,
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        } as any,
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.name_generated',
      sessionId: 'session-1',
      payload: { name: 'My New Session Name' },
    })

    const state = useSessionStore.getState()
    expect(state.sessions[0]?.title).toBe('My New Session Name')
    expect(state.sessions[0]?.updatedAt).toBe(originalUpdatedAt)
  })

  it('should update the title without changing updatedAt on currentSession', async () => {
    const useSessionStore = await loadSessionStore()

    const originalUpdatedAt = '2024-06-15T10:30:00.000Z'

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/test',
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: originalUpdatedAt,
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        } as any,
      ],
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: originalUpdatedAt,
        messages: [],
        criteria: [],
        contextWindows: [],
        executionState: null,
        metadata: { title: '', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
        metadataEntries: {},
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.name_generated',
      sessionId: 'session-1',
      payload: { name: 'Renamed Session' },
    })

    const state = useSessionStore.getState()
    expect(state.currentSession?.metadata?.title).toBe('Renamed Session')
    expect(state.currentSession?.updatedAt).toBe(originalUpdatedAt)
    expect(state.sessions[0]?.updatedAt).toBe(originalUpdatedAt)
  })
})

describe('workflow.execution_changed handler', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    fetchMock.mockClear()
  })

  const workflowEvent = (sessionId: string) => ({
    type: 'workflow.execution_changed' as const,
    sessionId,
    payload: {
      executionId: 'exec-1',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      workflowColor: '#3b82f6',
      status: 'running' as const,
      currentStepId: 'step-1',
      currentStepName: 'Build',
    },
  })

  it('should NOT touch activeWorkflowExecution when the event is for a different session', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-b', messages: [] } as any,
      activeWorkflowExecution: null,
      unreadSessionIds: [],
    }))

    useSessionStore.getState().handleServerMessage(workflowEvent('session-a'))

    expect(useSessionStore.getState().activeWorkflowExecution).toBeNull()
    expect(useSessionStore.getState().unreadSessionIds).toContain('session-a')
  })

  it('should update activeWorkflowExecution when the event is for the current session', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-a', messages: [] } as any,
      activeWorkflowExecution: null,
      unreadSessionIds: ['session-a'],
    }))

    useSessionStore.getState().handleServerMessage(workflowEvent('session-a'))

    const exec = useSessionStore.getState().activeWorkflowExecution
    expect(exec?.id).toBe('exec-1')
    expect(exec?.workflowName).toBe('Build & Verify')
    expect(exec?.status).toBe('running')
    expect(exec?.currentStepName).toBe('Build')
    expect(useSessionStore.getState().unreadSessionIds).toContain('session-a')
  })

  it('should update an existing execution for the current session', async () => {
    const useSessionStore = await loadSessionStore()

    const existing = {
      id: 'exec-1',
      sessionId: 'session-a',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      workflowColor: '#3b82f6',
      status: 'running' as const,
      stepOutput: {},
      params: {},
      createdAt: 1000,
      updatedAt: 1000,
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-a', messages: [] } as any,
      activeWorkflowExecution: existing,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.execution_changed',
      sessionId: 'session-a',
      payload: {
        executionId: 'exec-1',
        workflowId: 'default',
        workflowName: 'Build & Verify',
        status: 'waiting' as const,
        currentStepId: 'step-2',
        currentStepName: 'Review',
        pendingChoices: [
          { id: 'apply', label: 'apply', goto: 'apply_fixes' },
          { id: 'continue', label: 'Continue', goto: 'apply_fixes' },
        ],
      },
    })

    const exec = useSessionStore.getState().activeWorkflowExecution
    expect(exec?.status).toBe('waiting')
    expect(exec?.currentStepId).toBe('step-2')
    expect(exec?.currentStepName).toBe('Review')
    expect(exec?.pendingChoices).toEqual([
      { id: 'apply', label: 'apply', goto: 'apply_fixes' },
      { id: 'continue', label: 'Continue', goto: 'apply_fixes' },
    ])
    expect(exec?.createdAt).toBe(1000)
  })

  it('should clear stale pendingChoices when the server emits an empty choices array', async () => {
    const useSessionStore = await loadSessionStore()

    const existing = {
      id: 'exec-1',
      sessionId: 'session-a',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      workflowColor: '#3b82f6',
      status: 'waiting' as const,
      stepOutput: {},
      params: {},
      pendingChoices: [
        { id: 'apply', label: 'apply', goto: 'apply_fixes' },
        { id: 'continue', label: 'Continue', goto: 'apply_fixes' },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-a', messages: [] } as any,
      activeWorkflowExecution: existing,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.execution_changed',
      sessionId: 'session-a',
      payload: {
        executionId: 'exec-1',
        workflowId: 'default',
        workflowName: 'Build & Verify',
        status: 'waiting' as const,
        currentStepId: 'step-2',
        currentStepName: 'Review',
        pendingChoices: [],
      },
    })

    const exec = useSessionStore.getState().activeWorkflowExecution
    expect(exec?.status).toBe('waiting')
    expect(exec?.pendingChoices).toEqual([])
  })

  it('should clear stale pendingChoices when resuming clears the execution', async () => {
    const useSessionStore = await loadSessionStore()

    const existing = {
      id: 'exec-1',
      sessionId: 'session-a',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      workflowColor: '#3b82f6',
      status: 'waiting' as const,
      stepOutput: {},
      params: {},
      pendingChoices: [{ id: 'apply', label: 'apply', goto: 'apply_fixes' }],
      createdAt: 1000,
      updatedAt: 1000,
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-a', messages: [] } as any,
      activeWorkflowExecution: existing,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'workflow.execution_changed',
      sessionId: 'session-a',
      payload: {
        executionId: 'exec-1',
        workflowId: 'default',
        workflowName: 'Build & Verify',
        status: 'running' as const,
        currentStepId: 'step-2',
        currentStepName: 'Review',
        pendingChoices: [],
      },
    })

    const exec = useSessionStore.getState().activeWorkflowExecution
    expect(exec?.status).toBe('running')
    expect(exec?.pendingChoices).toEqual([])
  })

  it('should leave the current session execution untouched when a background event arrives', async () => {
    const useSessionStore = await loadSessionStore()

    const existing = {
      id: 'exec-1',
      sessionId: 'session-a',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      workflowColor: '#3b82f6',
      status: 'running' as const,
      stepOutput: {},
      params: {},
      createdAt: 1000,
      updatedAt: 1000,
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-a', messages: [] } as any,
      activeWorkflowExecution: existing,
    }))

    useSessionStore.getState().handleServerMessage(workflowEvent('session-b'))

    expect(useSessionStore.getState().activeWorkflowExecution).toBe(existing)
  })
})

// ---------------------------------------------------------------------------
// chat.ask_user handler — lossless ChoiceOption[] propagation
// ---------------------------------------------------------------------------
// The server normalizes ask_user options to ChoiceOption[] at the boundary
// (see src/shared/ask-options.ts normalizeAskOptions) and the WS replay path
// keeps that contract (see src/server/ws/protocol.ts storedEventToServerMessage).
// The web handler must therefore trust the wire contract and forward the
// payload as-is into PendingQuestion, never accidentally narrowing it back
// to a string[]-shaped object.
describe('chat.ask_user handler', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    playNotificationMock.mockClear()
    playAchievementMock.mockClear()
    playInterventionMock.mockClear()
    playWaitingForUserMock.mockClear()
    playNewMessageMock.mockClear()
    fetchMock.mockClear()
  })

  it('forwards canonical ChoiceOption[] into pendingQuestions without losing value/label/description', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1', messages: [] } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.ask_user',
      sessionId: 'session-1',
      payload: {
        callId: 'call-1',
        question: 'Pick:',
        type: 'choice',
        options: [
          { value: 'yes-v', label: 'Oui', description: 'Accepter' },
          { value: 'no-v', label: 'Non', description: 'Refuser' },
        ],
      },
    } as any)

    const state = useSessionStore.getState()
    expect(state.pendingQuestions.length).toBe(1)
    expect(state.pendingQuestions[0]).toEqual({
      callId: 'call-1',
      question: 'Pick:',
      type: 'choice',
      options: [
        { value: 'yes-v', label: 'Oui', description: 'Accepter' },
        { value: 'no-v', label: 'Non', description: 'Refuser' },
      ],
    })
  })

  it('forwards ChoiceOption[] without description (legacy live path)', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1', messages: [] } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.ask_user',
      sessionId: 'session-1',
      payload: {
        callId: 'call-1',
        question: 'Pick:',
        type: 'choice',
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B' },
        ],
      },
    } as any)

    const state = useSessionStore.getState()
    expect(state.pendingQuestions.length).toBe(1)
    expect(state.pendingQuestions[0]?.options).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
    // exactOptionalPropertyTypes: description must NOT be present (no
    // `description: undefined` key sneaking into the forwarded object).
    for (const opt of state.pendingQuestions[0]?.options ?? []) {
      expect('description' in opt).toBe(false)
    }
  })

  it('keeps undefined options when payload carries none (free-text fallback)', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1', messages: [] } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.ask_user',
      sessionId: 'session-1',
      payload: {
        callId: 'call-1',
        question: 'Type your answer:',
        type: 'text',
        options: undefined,
      },
    } as any)

    const state = useSessionStore.getState()
    expect(state.pendingQuestions.length).toBe(1)
    expect(state.pendingQuestions[0]?.options).toBeUndefined()
    expect(state.pendingQuestions[0]?.type).toBe('text')
  })

  it('replaces existing pendingQuestion with the same callId (no duplicates)', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1', messages: [] } as any,
      pendingQuestions: [
        {
          callId: 'call-1',
          question: 'old',
          type: 'text',
          options: undefined,
        },
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.ask_user',
      sessionId: 'session-1',
      payload: {
        callId: 'call-1',
        question: 'new',
        type: 'choice',
        options: [{ value: 'A', label: 'A' }],
      },
    } as any)

    const state = useSessionStore.getState()
    expect(state.pendingQuestions.length).toBe(1)
    expect(state.pendingQuestions[0]?.question).toBe('new')
    expect(state.pendingQuestions[0]?.type).toBe('choice')
  })
})

describe('chat.stats handler', () => {
  const liveStats = {
    providerId: 'p',
    providerName: 'P',
    backend: 'ollama',
    model: 'm',
    mode: 'builder',
    totalTime: 5,
    toolTime: 1,
    prefillTokens: 100,
    prefillSpeed: 50,
    generationTokens: 10,
    generationSpeed: 5,
  } as any
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    playNotificationMock.mockClear()
    playAchievementMock.mockClear()
    playInterventionMock.mockClear()
    playWaitingForUserMock.mockClear()
    playNewMessageMock.mockClear()
    fetchMock.mockClear()
  })

  it('stores live turn stats on the focused session', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })

    const state = useSessionStore.getState()
    expect(state.liveTurnStats).toEqual(liveStats)
    expect(state.panes['session-1']?.liveTurnStats).toEqual(liveStats)
  })

  it('clears live turn stats when the turn completes', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: { messageId: 'm1', reason: 'complete', stats: liveStats },
    })

    expect(useSessionStore.getState().liveTurnStats).toBeNull()
  })

  it('does not clear live turn stats on a sub-agent completion mid-turn', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: { messageId: 'm1', reason: 'complete', stats: liveStats, agentType: 'sub-agent' },
    })

    expect(useSessionStore.getState().liveTurnStats).toEqual(liveStats)
  })

  it('ignores chat.stats for sessions that are not open', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })

    expect(useSessionStore.getState().liveTurnStats).toBeNull()
  })

  it('clears live turn stats when the turn stops running', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: false },
    })

    expect(useSessionStore.getState().liveTurnStats).toBeNull()
  })

  it('clears stale live turn stats when a new turn starts running', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: true },
    })

    expect(useSessionStore.getState().liveTurnStats).toBeNull()
  })

  it('clears live turn stats when a message_updated finalizes with stats', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })

    // The turn-finalize broadcast attaches stats to the message; the live
    // channel must not be merged on top of it (would double-count).
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message_updated',
      sessionId: 'session-1',
      payload: { messageId: 'm1', updates: { isStreaming: false, stats: liveStats } },
    })

    expect(useSessionStore.getState().liveTurnStats).toBeNull()
  })

  it('keeps live turn stats when a message_updated carries no stats', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    useSessionStore.getState().handleServerMessage({
      type: 'chat.stats',
      sessionId: 'session-1',
      payload: { stats: liveStats },
    })

    // Mid-turn message updates (e.g. isStreaming) must not wipe the live stats.
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message_updated',
      sessionId: 'session-1',
      payload: { messageId: 'm1', updates: { isStreaming: true } },
    })

    expect(useSessionStore.getState().liveTurnStats).toEqual(liveStats)
  })
})

describe('session.deleted handler', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    playNotificationMock.mockClear()
    playAchievementMock.mockClear()
    playInterventionMock.mockClear()
    playWaitingForUserMock.mockClear()
    playNewMessageMock.mockClear()
    fetchMock.mockClear()
  })

  it('removes the deleted session from state.sessions immediately and reloads scoped to its project', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state: any) => ({
      ...state,
      sessions: [
        {
          id: 'a1',
          projectId: 'project-a',
          workdir: '/tmp/a',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
        {
          id: 'a2',
          projectId: 'project-a',
          workdir: '/tmp/a',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
        {
          id: 'b1',
          projectId: 'project-b',
          workdir: '/tmp/b',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
    }))

    // Scoped reload returns the 1 remaining project-a session
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              id: 'a2',
              projectId: 'project-a',
              workdir: '/tmp/a',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              isFavorite: false,
              createdAt: 'a',
              updatedAt: 'b',
              criteriaCount: 0,
              criteriaCompleted: 0,
              messageCount: 0,
            },
          ],
          hasMore: false,
          pendingConfirmationsBySession: {},
        }),
    } as never)

    useSessionStore.getState().handleServerMessage({
      type: 'session.deleted',
      sessionId: 'a1',
      payload: { sessionId: 'a1' },
    } as any)

    // Wait for the async listSessions reload
    await new Promise((resolve) => setTimeout(resolve, 10))

    const state = useSessionStore.getState()
    // Deleted session is gone immediately, even before/without the reload
    expect(state.sessions.find((s: any) => s.id === 'a1')).toBeUndefined()
    // Reload was scoped to project-a, not a bare global list
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((url) => url.includes('projectId=project-a'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)
    // project-b session preserved
    expect(state.sessions.find((s: any) => s.id === 'b1')).toBeDefined()
  })
})

describe('session.deletedAll handler', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    playNotificationMock.mockClear()
    playAchievementMock.mockClear()
    playInterventionMock.mockClear()
    playWaitingForUserMock.mockClear()
    playNewMessageMock.mockClear()
    fetchMock.mockClear()
  })

  it('removes the project sessions immediately and reloads scoped to the project id, not globally', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state: any) => ({
      ...state,
      sessions: [
        {
          id: 'a1',
          projectId: 'project-a',
          workdir: '/tmp/a',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
        {
          id: 'a2',
          projectId: 'project-a',
          workdir: '/tmp/a',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
        {
          id: 'b1',
          projectId: 'project-b',
          workdir: '/tmp/b',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
    }))

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], hasMore: false, pendingConfirmationsBySession: {} }),
    } as never)

    // The server broadcasts sessionId = projectId for deletedAll
    useSessionStore.getState().handleServerMessage({
      type: 'session.deletedAll',
      sessionId: 'project-a',
      payload: {},
    } as any)

    // Immediate removal: project-a sessions are gone synchronously, before the
    // async reload resolves.
    const stateAfterSet = useSessionStore.getState()
    expect(stateAfterSet.sessions.find((s: any) => s.id === 'a1')).toBeUndefined()
    expect(stateAfterSet.sessions.find((s: any) => s.id === 'a2')).toBeUndefined()
    // Other projects are preserved
    expect(stateAfterSet.sessions.find((s: any) => s.id === 'b1')).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 10))

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((url) => url.includes('projectId=project-a'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)
  })
})
