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

  it('does not clear live turn stats while waiting for user input', async () => {
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
      payload: { messageId: 'm1', reason: 'waiting_for_user' },
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

describe('feed memory bounds', () => {
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

  function makeMessage(id: string) {
    return { id, role: 'assistant', content: `content-${id}`, timestamp: '2024-01-01T00:00:00.000Z' } as any
  }

  it('caps pane.messages while a long run streams beyond the default window', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    const handler = useSessionStore.getState().handleServerMessage

    // Default cap is 300 visible items + headroom; a long agent run appends
    // far more than that with no turn-boundary session.state in between.
    for (let i = 0; i < 500; i++) {
      handler({ type: 'chat.message', sessionId: 'session-1', payload: { message: makeMessage(`m-${i}`) } })
    }

    const pane = useSessionStore.getState().panes['session-1']
    expect(pane?.messages.length).toBeLessThanOrEqual(325)
    // Newest messages survive; the oldest are evicted.
    expect(pane?.messages[pane.messages.length - 1]?.id).toBe('m-499')
    expect(pane?.messages[0]?.id).not.toBe('m-0')
    expect(useSessionStore.getState().messages.length).toBeLessThanOrEqual(325)
  })

  it('respects a custom maxVisibleItems setting', async () => {
    const useSessionStore = await loadSessionStore()
    const { settingResource, SETTINGS_KEYS } = await import('../../lib/resources')

    settingResource.write('50', SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS)

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    const handler = useSessionStore.getState().handleServerMessage

    for (let i = 0; i < 200; i++) {
      handler({ type: 'chat.message', sessionId: 'session-1', payload: { message: makeMessage(`m-${i}`) } })
    }

    const pane = useSessionStore.getState().panes['session-1']
    expect(pane?.messages.length).toBeLessThanOrEqual(75)
    expect(pane?.messages[pane.messages.length - 1]?.id).toBe('m-199')
  })

  it('does not trim when maxVisibleItems is 0 (unlimited feed)', async () => {
    const useSessionStore = await loadSessionStore()
    const { settingResource, SETTINGS_KEYS } = await import('../../lib/resources')

    settingResource.write('0', SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS)

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    const handler = useSessionStore.getState().handleServerMessage

    for (let i = 0; i < 400; i++) {
      handler({ type: 'chat.message', sessionId: 'session-1', payload: { message: makeMessage(`m-${i}`) } })
    }

    const pane = useSessionStore.getState().panes['session-1']
    expect(pane?.messages.length).toBe(400)
    expect(pane?.messages[0]?.id).toBe('m-0')
  })

  it('boundedAdd keeps the set at the cap and evicts the oldest entries', async () => {
    const { boundedAdd, MAX_COUNTED_MESSAGE_IDS } = await import('./messageHandler')

    const set = new Set<string>()
    for (let i = 0; i < MAX_COUNTED_MESSAGE_IDS + 100; i++) {
      boundedAdd(set, `id-${i}`, MAX_COUNTED_MESSAGE_IDS)
    }

    expect(set.size).toBe(MAX_COUNTED_MESSAGE_IDS)
    expect(set.has('id-0')).toBe(false)
    expect(set.has(`id-${MAX_COUNTED_MESSAGE_IDS + 99}`)).toBe(true)
  })

  it('drops streamingOutput from a tool call once the final result lands', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    const handler = useSessionStore.getState().handleServerMessage

    handler({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: {
        message: {
          id: 'm1',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'run_command',
              arguments: {},
              streamingOutput: [{ stream: 'stdout', content: 'lots of streamed output', timestamp: 1 }],
            },
          ],
        } as any,
      },
    })
    handler({
      type: 'chat.tool_result',
      sessionId: 'session-1',
      payload: { messageId: 'm1', callId: 'tc-1', tool: 'run_command', result: { output: 'final output' } } as any,
    })

    const pane = useSessionStore.getState().panes['session-1']
    const toolCall = pane?.messages[0]?.toolCalls?.[0]
    expect(toolCall?.result).toEqual({ output: 'final output' })
    expect(toolCall?.streamingOutput).toBeUndefined()
  })

  it('caps streamingOutput while a tool streams beyond the byte budget', async () => {
    const useSessionStore = await loadSessionStore()
    const { MAX_STREAMING_OUTPUT_BYTES, MAX_STREAMING_OUTPUT_CHUNKS } = await import('./messageHandler')

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    const handler = useSessionStore.getState().handleServerMessage

    handler({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: {
        message: {
          id: 'm1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'run_command', arguments: {} }],
        } as any,
      },
    })

    // Stream far more than the byte budget in 64KB chunks.
    const chunk = 'x'.repeat(64 * 1024)
    for (let i = 0; i < 10; i++) {
      handler({
        type: 'chat.tool_output',
        sessionId: 'session-1',
        payload: { messageId: 'm1', callId: 'tc-1', stream: 'stdout', output: chunk },
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 20))

    const toolCall = useSessionStore.getState().panes['session-1']?.messages[0]?.toolCalls?.[0]
    const total = toolCall?.streamingOutput?.reduce((sum, c) => sum + c.content.length, 0) ?? 0
    expect(total).toBeLessThanOrEqual(MAX_STREAMING_OUTPUT_BYTES + chunk.length)
    expect(toolCall?.streamingOutput?.length ?? 0).toBeLessThanOrEqual(MAX_STREAMING_OUTPUT_CHUNKS)
    // Newest chunk survives; the oldest are evicted.
    expect(toolCall?.streamingOutput?.[toolCall.streamingOutput.length - 1]?.content).toBe(chunk)
  })

  it('appendStreamingOutput keeps the newest chunks within the byte budget', async () => {
    const { appendStreamingOutput, MAX_STREAMING_OUTPUT_BYTES } = await import('./messageHandler')

    const chunks = Array.from({ length: 8 }, (_, i) => ({
      stream: 'stdout' as const,
      content: 'x'.repeat(64 * 1024),
      timestamp: i,
    }))
    const capped = appendStreamingOutput(undefined, chunks)

    expect(capped.length).toBeGreaterThan(0)
    const total = capped.reduce((sum, c) => sum + c.content.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_STREAMING_OUTPUT_BYTES + chunks[0]!.content.length)
    // Oldest chunks dropped, newest retained.
    expect(capped[capped.length - 1]?.timestamp).toBe(chunks[7]!.timestamp)
    expect(capped[0]?.timestamp).toBeGreaterThan(chunks[0]!.timestamp)
  })
})

describe('chat.tool_preparing handler', () => {
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

  it('preserves the live edit context streamed with edit_file preparing events', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1' } as any,
    }))
    const handler = useSessionStore.getState().handleServerMessage

    handler({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: { message: { id: 'm1', role: 'assistant', content: '' } as any },
    })

    const editContext = [
      {
        startLine: 3,
        endLine: 3,
        beforeContext: [{ lineNumber: 2, content: 'line two' }],
        afterContext: [{ lineNumber: 4, content: 'line four' }],
        oldContent: 'a',
        newContent: 'b',
        edits: [{ startLine: 3, endLine: 3, oldContent: 'a', newContent: 'b' }],
      },
    ]

    handler({
      type: 'chat.tool_preparing',
      sessionId: 'session-1',
      payload: {
        messageId: 'm1',
        index: 0,
        name: 'edit_file',
        arguments: '{"path":"a.ts","old_string":"a"}',
        editContext,
      } as any,
    })

    const pane = useSessionStore.getState().panes['session-1']
    const preparing = pane?.messages[0]?.preparingToolCalls?.[0]
    expect(preparing?.editContext).toEqual(editContext)

    // A later delta without editContext must not clobber the previous one.
    handler({
      type: 'chat.tool_preparing',
      sessionId: 'session-1',
      payload: {
        messageId: 'm1',
        index: 0,
        name: 'edit_file',
        arguments: '{"path":"a.ts","old_string":"a","new_string":"b"}',
      } as any,
    })

    const preparing2 = useSessionStore.getState().panes['session-1']?.messages[0]?.preparingToolCalls?.[0]
    expect(preparing2?.editContext).toEqual(editContext)
    expect(preparing2?.arguments).toBe('{"path":"a.ts","old_string":"a","new_string":"b"}')
  })
})
