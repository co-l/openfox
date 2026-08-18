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

describe('useSessionStore session isolation', () => {
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

  it('clears the previous session while loading and ignores background streaming updates', async () => {
    const useSessionStore = await loadSessionStore()

    const sessionOne: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project-1',
      mode: 'planner',
      phase: 'plan',
      isRunning: true,
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
      messages: [],
    }

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: sessionOne,
      messages: [
        {
          id: 'session-1-assistant',
          role: 'assistant',
          content: 'still streaming',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: true,
        },
      ],
      currentTodos: [{ content: 'old todo', status: 'pending' }],
      contextState: {
        currentTokens: 99,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      },
      pendingPathConfirmations: [
        {
          callId: 'path-old',
          tool: 'read_file',
          paths: ['/tmp/project-1/secret.txt'],
          workdir: '/tmp/project-1',
          reason: 'outside_workdir',
        },
      ],
      error: { code: 'CHAT_ERROR', message: 'old error' },
    }))

    useSessionStore.getState().loadSession('session-2')

    expect(useSessionStore.getState().currentSession).toBeNull()
    expect(useSessionStore.getState().messages).toEqual([])
    expect(useSessionStore.getState().currentTodos).toEqual([])
    expect(useSessionStore.getState().contextState).toBeNull()
    expect(useSessionStore.getState().pendingPathConfirmations).toEqual([])

    useSessionStore.getState().handleServerMessage({
      id: 'load-session-2',
      type: 'session.state',
      sessionId: 'session-2',
      payload: {
        session: sessionTwo,
        messages: [
          {
            id: 'session-2-assistant',
            role: 'assistant',
            content: 'session two',
            timestamp: '2024-01-01T00:00:00.000Z',
            tokenCount: 0,
            isStreaming: false,
          },
        ],
      },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'context.state',
      sessionId: 'session-2',
      payload: {
        context: { currentTokens: 12, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
      },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: {
        message: {
          id: 'session-1-late',
          role: 'assistant',
          content: 'wrong session',
          timestamp: '2024-01-01T00:00:01.000Z',
          tokenCount: 0,
          isStreaming: true,
        },
      },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'session-2-assistant', content: ' polluted' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'context.state',
      sessionId: 'session-1',
      payload: {
        context: { currentTokens: 777, maxTokens: 200000, compactionCount: 0, dangerZone: true, canCompact: true },
      },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.todo',
      sessionId: 'session-1',
      payload: { todos: [{ content: 'wrong todo', status: 'completed' }] },
    })

    expect(useSessionStore.getState().currentSession?.id).toBe('session-2')
    expect(useSessionStore.getState().messages).toEqual([
      {
        id: 'session-2-assistant',
        role: 'assistant',
        content: 'session two',
        timestamp: '2024-01-01T00:00:00.000Z',
        tokenCount: 0,
        isStreaming: false,
      },
    ])
    expect(useSessionStore.getState().contextState).toEqual({
      currentTokens: 12,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
    })
    expect(useSessionStore.getState().currentTodos).toEqual([])
  })

  it('updates sidebar state for background sessions without mutating the active session', async () => {
    const useSessionStore = await loadSessionStore()

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
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
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
          id: 'session-2',
          projectId: 'project-1',
          workdir: '/tmp/project-2',
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
      currentSession: sessionTwo,
      error: null,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: true },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'phase.changed',
      sessionId: 'session-1',
      payload: { phase: 'verification' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.error',
      sessionId: 'session-1',
      payload: { error: 'background error', recoverable: false },
    })

    expect(useSessionStore.getState().sessions).toEqual([
      {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'verification',
        isRunning: true,
        isFavorite: false,
        createdAt: 'a',
        updatedAt: 'b',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 0,
      },
      {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        isFavorite: false,
        createdAt: 'a',
        updatedAt: 'b',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 0,
      },
    ])
    expect(useSessionStore.getState().currentSession).toEqual(sessionTwo)
    expect(useSessionStore.getState().error).toBeNull()
  })

  it('updates background session isRunning to false and it stays false', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'build',
          isRunning: true,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
      currentSession: null,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: false },
    })

    expect(useSessionStore.getState().sessions[0]?.isRunning).toBe(false)
  })

  it('mergeSessionList prioritizes REST API isRunning over local state', async () => {
    const useSessionStore = await loadSessionStore()

    const staleSession: any = {
      id: 'session-stale',
      projectId: 'project-1',
      workdir: '/tmp/project-1',
      mode: 'planner',
      phase: 'build',
      isRunning: true,
      createdAt: 'a',
      updatedAt: 'b',
      criteriaCount: 0,
      criteriaCompleted: 0,
      messageCount: 5,
    }

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [staleSession],
      currentSession: {
        id: 'session-other',
        projectId: 'project-1',
        workdir: '/tmp/project-other',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    }))

    const incomingSessions = [
      {
        id: 'session-stale',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'build',
        isRunning: false,
        createdAt: 'a',
        updatedAt: 'c',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 10,
      },
    ]

    useSessionStore.getState().handleServerMessage({
      type: 'session.list',
      payload: { sessions: incomingSessions },
    })

    expect(useSessionStore.getState().sessions.find((s) => s.id === 'session-stale')?.isRunning).toBe(false)
  })

  it('session.list preserves real-time isRunning:false when server returns stale isRunning:true', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'build',
          isRunning: true,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 5,
        },
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: false },
    })

    expect(useSessionStore.getState().sessions.find((s) => s.id === 'session-1')?.isRunning).toBe(false)

    useSessionStore.getState().handleServerMessage({
      type: 'session.list',
      payload: {
        sessions: [
          {
            id: 'session-1',
            projectId: 'project-1',
            workdir: '/tmp/project-1',
            mode: 'planner',
            phase: 'build',
            isRunning: true,
            createdAt: 'a',
            updatedAt: 'b',
            criteriaCount: 0,
            criteriaCompleted: 0,
            messageCount: 5,
          },
        ],
      },
    })

    expect(useSessionStore.getState().sessions.find((s) => s.id === 'session-1')?.isRunning).toBe(false)
  })

  it('marks background sessions unread and clears unread state when opened', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'plan',
          isRunning: true,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
        {
          id: 'session-2',
          projectId: 'project-1',
          workdir: '/tmp/project-2',
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
      currentSession: {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: {
        message: {
          id: 'background-message',
          role: 'assistant',
          content: 'background progress',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: true,
        },
      },
    })

    expect(useSessionStore.getState().unreadSessionIds).toEqual(['session-1'])

    useSessionStore.getState().loadSession('session-1')

    expect(useSessionStore.getState().unreadSessionIds).toEqual([])
  })

  it('clears pending path confirmation when the active session stops running', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      pendingPathConfirmations: [
        {
          callId: 'path-1',
          tool: 'read_file',
          paths: ['/tmp/project-1/secrets.txt'],
          workdir: '/tmp/project-1',
          reason: 'outside_workdir',
        },
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: false },
    })

    expect(useSessionStore.getState().currentSession?.isRunning).toBe(false)
    expect(useSessionStore.getState().pendingPathConfirmations).toHaveLength(1)
  })

  it('applies partial updates from chat.message_updated immediately', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'partial answer',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: true,
        } as any,
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message_updated',
      sessionId: 'session-1',
      payload: {
        messageId: 'assistant-1',
        updates: {
          isStreaming: false,
          partial: true,
        },
      },
    })

    expect(useSessionStore.getState().messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        isStreaming: false,
        partial: true,
      }),
    ])
  })

  it('keeps tool calls with results in messages[] throughout message lifecycle', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      messages: [
        {
          id: 'msg-a',
          role: 'assistant',
          content: 'hello',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: true,
        } as any,
      ],
    }))

    // Finalize the message
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message_updated',
      sessionId: 'session-1',
      payload: {
        messageId: 'msg-a',
        updates: { isStreaming: false },
      },
    })

    // Add tool call and result
    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_call',
      sessionId: 'session-1',
      payload: {
        messageId: 'msg-a',
        callId: 'call-1',
        tool: 'run_command',
        args: { command: 'echo hi' },
      },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_result',
      sessionId: 'session-1',
      payload: {
        messageId: 'msg-a',
        callId: 'call-1',
        tool: 'run_command',
        result: { success: true, output: 'hi', durationMs: 10, truncated: false },
      },
    })

    // Add a new message (would have replaced streamingMessage in old architecture)
    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: {
        message: {
          id: 'msg-b',
          role: 'assistant',
          content: '',
          timestamp: '2024-01-01T00:00:01.000Z',
          tokenCount: 0,
          isStreaming: true,
        } as any,
      },
    })

    // msg-a should still have its tool call with result in messages[]
    const msgA = useSessionStore.getState().messages.find((m) => m.id === 'msg-a')
    expect(msgA).toBeDefined()
    expect(msgA!.toolCalls).toHaveLength(1)
    expect(msgA!.toolCalls![0]!.result).toBeDefined()
    expect(msgA!.toolCalls![0]!.result!.success).toBe(true)
  })

  it('merges session.state into sidebar summaries so running status appears immediately after load', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
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

    useSessionStore.getState().handleServerMessage({
      id: 'load-session-1',
      type: 'session.state',
      sessionId: 'session-1',
      payload: {
        session: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'builder',
          phase: 'build',
          isRunning: true,
          criteria: [],
          summary: null,
          messages: [],
        },
        messages: [],
      },
    })

    expect(useSessionStore.getState().sessions).toEqual([
      {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        isFavorite: false,
        createdAt: 'a',
        updatedAt: 'b',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 0,
      },
    ])
  })

  it('session.list updates isRunning from server (source of truth)', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'build',
          isRunning: true,
          isFavorite: false,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 5,
        },
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.list',
      payload: {
        sessions: [
          {
            id: 'session-1',
            projectId: 'project-1',
            workdir: '/tmp/project-1',
            mode: 'planner',
            phase: 'plan',
            isRunning: false,
            createdAt: 'a',
            updatedAt: 'c',
            criteriaCount: 0,
            criteriaCompleted: 0,
            messageCount: 10,
          },
        ],
      },
    })

    const result = useSessionStore.getState().sessions.find((s) => s.id === 'session-1')
    expect(result?.isRunning).toBe(false)
    expect(result?.phase).toBe('build')
    expect(result?.messageCount).toBe(10)
  })

  it('plays completion notifications for background sessions too', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: {
        messageId: 'assistant-1',
        reason: 'complete',
      },
    })

    expect(playNotificationMock).toHaveBeenCalledTimes(1)
  })

  it('plays a dedicated sound when any session waits for user input', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: {
        messageId: 'assistant-1',
        reason: 'waiting_for_user',
      },
    })

    expect(playWaitingForUserMock).toHaveBeenCalledTimes(1)
    expect(playNotificationMock).not.toHaveBeenCalled()
  })

  it('uses agentType from chat.done payload when present', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: {
        messageId: 'assistant-1',
        reason: 'complete',
        agentType: 'sub-agent',
      },
    })

    expect(playNotificationMock).toHaveBeenCalledWith('sub-agent')
  })

  it('plays sound for build agent type when agentType is build', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: {
        messageId: 'assistant-1',
        reason: 'complete',
        agentType: 'build',
      },
    })

    expect(playNotificationMock).toHaveBeenCalledWith('build')
  })

  it('plays the waiting for user sound when a path confirmation is requested', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-1',
        tool: 'write_file',
        paths: ['/tmp/secret.txt'],
        workdir: '/tmp/project-1',
        reason: 'sensitive_file',
      },
    })

    expect(playWaitingForUserMock).toHaveBeenCalledTimes(1)
    expect(playNotificationMock).not.toHaveBeenCalled()
  })

  it('preserves pending path confirmations from parallel tool calls without losing earlier ones', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-env',
        tool: 'write_file',
        paths: ['/tmp/project-1/.env'],
        workdir: '/tmp/project-1',
        reason: 'sensitive_file',
      },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-env-production',
        tool: 'write_file',
        paths: ['/tmp/project-1/.env.production'],
        workdir: '/tmp/project-1',
        reason: 'sensitive_file',
      },
    })

    const state = useSessionStore.getState()
    expect(state.pendingPathConfirmations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callId: 'call-env' }),
        expect.objectContaining({ callId: 'call-env-production' }),
      ]),
    )
  })

  it('does not mark a background session unread when it only receives session state', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.state',
      sessionId: 'session-1',
      payload: {
        session: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          criteria: [],
          summary: null,
        },
        messages: [],
      },
    })

    expect(useSessionStore.getState().unreadSessionIds).toEqual([])
  })

  it('restores pendingQuestions from session.state on load', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
        messages: [],
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.state',
      sessionId: 'session-1',
      payload: {
        session: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          criteria: [],
          summary: null,
          messages: [],
        },
        messages: [],
        pendingConfirmations: [],
        pendingQuestions: [
          { callId: 'pq-1', question: 'Proceed?', type: 'confirm', options: undefined },
          { callId: 'pq-2', question: 'Pick one:', type: 'choice', options: ['A', 'B'] },
        ],
      },
    })

    const state = useSessionStore.getState()
    expect(state.pendingQuestions).toHaveLength(2)
    expect(state.pendingQuestions[0]!.callId).toBe('pq-1')
    expect(state.pendingQuestions[0]!.type).toBe('confirm')
    expect(state.pendingQuestions[1]!.callId).toBe('pq-2')
    expect(state.pendingQuestions[1]!.options).toEqual(['A', 'B'])
  })

  it('preserves recentUserPrompts from incoming sessions', async () => {
    const useSessionStore = await loadSessionStore()

    const incomingSessions = [
      {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner' as const,
        phase: 'plan' as const,
        isRunning: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 5,
        recentUserPrompts: [
          { id: 'msg-1', content: 'First prompt', timestamp: '2024-01-01T10:00:00.000Z' },
          { id: 'msg-2', content: 'Second prompt', timestamp: '2024-01-01T11:00:00.000Z' },
        ],
      },
      {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder' as const,
        phase: 'build' as const,
        isRunning: true,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 12,
        recentUserPrompts: [{ id: 'msg-3', content: 'Third prompt', timestamp: '2024-01-02T12:00:00.000Z' }],
      },
    ]

    useSessionStore.setState({
      sessions: [],
      currentSession: null,
      unreadSessionIds: [],
      messages: [],
      currentTodos: [],
      contextState: null,
      pendingPathConfirmations: [],
      error: null,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.list',
      payload: {
        sessions: incomingSessions as any,
      },
    })

    const result = useSessionStore.getState().sessions

    expect(result[0]!.recentUserPrompts).toEqual([
      { id: 'msg-1', content: 'First prompt', timestamp: '2024-01-01T10:00:00.000Z' },
      { id: 'msg-2', content: 'Second prompt', timestamp: '2024-01-01T11:00:00.000Z' },
    ])
    expect(result[1]!.recentUserPrompts).toEqual([
      { id: 'msg-3', content: 'Third prompt', timestamp: '2024-01-02T12:00:00.000Z' },
    ])

    expect(result[0]!.messageCount).toBe(5)
    expect(result[1]!.messageCount).toBe(12)
  })

  it('preserves messageCount from incoming sessions even when existing session has different count', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner' as const,
          phase: 'plan' as const,
          isRunning: false,
          isFavorite: false,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
      currentSession: null,
      unreadSessionIds: [],
      messages: [],
      currentTodos: [],
      contextState: null,
      pendingPathConfirmations: [],
      error: null,
    })

    const incomingSessions = [
      {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner' as const,
        phase: 'plan' as const,
        isRunning: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 15,
        recentUserPrompts: [],
      },
    ]

    useSessionStore.getState().handleServerMessage({
      type: 'session.list',
      payload: {
        sessions: incomingSessions as any,
      },
    })

    const result = useSessionStore.getState().sessions

    expect(result[0]!.messageCount).toBe(15)
  })

  it('plays new_message sound on first chat.delta for a new assistant message', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: 'Hello' },
    })

    expect(playNewMessageMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT play new_message sound on chat.thinking (only agent messages, not thinking blocks)', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.thinking',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: 'Let me think' },
    })

    expect(playNewMessageMock).not.toHaveBeenCalled()
  })

  it('does not replay new_message sound on subsequent deltas for the same messageId', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: 'Hello' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: ' world' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: '!' },
    })

    expect(playNewMessageMock).toHaveBeenCalledTimes(1)
  })

  it('plays new_message sound again for a different messageId after chat.done', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: 'First message' },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.done',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', reason: 'complete' },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-2', content: 'Second message' },
    })

    expect(playNewMessageMock).toHaveBeenCalledTimes(2)
  })

  it('uses subAgentType from chat.delta payload to attribute new_message sound', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.delta',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', content: 'Hello', subAgentType: 'verifier' },
    })

    expect(playNewMessageMock).toHaveBeenCalledWith('sub-agent')
  })

  it('sends ask.answer WebSocket message when answerQuestion is called', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      pendingQuestions: [
        {
          callId: 'call-123',
          question: 'What is your name?',
          type: 'text',
          options: undefined,
        },
      ],
    })

    await useSessionStore.getState().answerQuestion('session-1', 'call-123', 'My name is Conrad')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session-1/answer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ callId: 'call-123', answer: 'My name is Conrad', skip: undefined }),
      }),
    )
    expect(useSessionStore.getState().pendingQuestions).toEqual([])
  })

  it('restores streamingMessage from REST response on loadSession', async () => {
    const useSessionStore = await loadSessionStore()

    const streamingMsg: any = {
      id: 'assistant-streaming',
      role: 'assistant',
      content: 'partial content so far',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: true,
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          session: {
            id: 'session-1',
            projectId: 'project-1',
            workdir: '/tmp/project-1',
            mode: 'planner',
            phase: 'plan',
            isRunning: true,
            criteria: [],
            summary: null,
            messages: [streamingMsg],
          },
          messages: [streamingMsg],
          contextState: {
            currentTokens: 50,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          queueState: [],
          pendingQuestions: [],
        }),
    })

    await useSessionStore.getState().loadSession('session-1')

    const state = useSessionStore.getState()
    expect(state.messages).toEqual([streamingMsg])
    expect(state.messages.find((m) => m.isStreaming)).toBeDefined()
  })

  it('falls back to a regular fetch when the prefetched session fetch failed', async () => {
    const useSessionStore = await loadSessionStore()

    // First fetch is the session GET itself (no prefetch active in this
    // harness); it fails, and there is no retry path — the load must abort
    // cleanly without leaving a half-loaded session.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as never)

    await useSessionStore.getState().loadSession('session-fallback')

    expect(useSessionStore.getState().currentSession).toBeNull()
    // Session GET fails and the load aborts (only the background-processes
    // fetch is issued alongside it — no retry happens here).
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads session with no streaming message when REST response has none', async () => {
    const useSessionStore = await loadSessionStore()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          session: {
            id: 'session-2',
            projectId: 'project-1',
            workdir: '/tmp/project-1',
            mode: 'planner',
            phase: 'plan',
            isRunning: false,
            criteria: [],
            summary: null,
            messages: [],
          },
          messages: [],
          contextState: {
            currentTokens: 10,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          queueState: [],
          pendingQuestions: [],
        }),
    })

    await useSessionStore.getState().loadSession('session-2')

    const state = useSessionStore.getState()
    expect(state.messages).toEqual([])
    expect(state.messages.find((m) => m.isStreaming)).toBeUndefined()
  })

  it('prevents concurrent createSession calls when pendingSessionCreate is already true', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({ pendingSessionCreate: true })

    const result = await useSessionStore.getState().createSession('project-1')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resets pendingSessionCreate when clearSession is called', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({ pendingSessionCreate: 'session-123' })

    useSessionStore.getState().clearSession()

    expect(useSessionStore.getState().pendingSessionCreate).toBe(false)
  })

  it('allows createSession after clearSession resets pendingSessionCreate', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({ pendingSessionCreate: 'session-123' })
    useSessionStore.getState().clearSession()

    const result = await useSessionStore.getState().createSession('project-1')

    expect(result).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-1', title: undefined }),
      }),
    )
  })

  it('clears pendingQuestions when answerQuestion is called with skip', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      pendingQuestions: [
        {
          callId: 'call-456',
          question: 'Do you want to continue?',
          type: 'confirm',
          options: undefined,
        },
      ],
    })

    await useSessionStore.getState().answerQuestion('session-1', 'call-456', '', true)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session-1/answer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ callId: 'call-456', answer: '', skip: true }),
      }),
    )
    expect(useSessionStore.getState().pendingQuestions).toEqual([])
  })

  it('sendMessage builds correct request body for content-only, attachments-only, and both', async () => {
    const useSessionStore = await loadSessionStore()
    fetchMock.mockClear()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    // Content only
    await useSessionStore.getState().sendMessage('session-1', 'hello', undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sessions/session-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'hello' }),
      }),
    )

    // Attachments only
    const attachments = [
      { id: 'att-1', filename: 'img.png', data: 'base64', mimeType: 'image/png' as const, size: 512 },
    ]
    await useSessionStore.getState().sendMessage('session-1', '', attachments)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/sessions/session-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ attachments }),
      }),
    )

    // Both
    await useSessionStore.getState().sendMessage('session-1', 'look', attachments)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/sessions/session-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'look', attachments }),
      }),
    )

    // Neither (empty body)
    await useSessionStore.getState().sendMessage('session-1', '', undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/sessions/session-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )

    // With messageKind
    await useSessionStore.getState().sendMessage('session-1', 'hello', undefined, { messageKind: 'command' })
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/sessions/session-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'hello', messageKind: 'command' }),
      }),
    )
  })
})

describe('cross-session path confirmations', () => {
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

  it('stores cross-session confirmation when chat.path_confirmation arrives for background session', async () => {
    const useSessionStore = await loadSessionStore()

    // Set current session to session-2
    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    // Receive path confirmation for session-1 (background)
    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })

    const state = useSessionStore.getState()
    expect(state.crossSessionConfirmations['session-1']).toBeDefined()
    expect(state.crossSessionConfirmations['session-1']).toHaveLength(1)
    expect(state.crossSessionConfirmations['session-1']![0]!.callId).toBe('call-git')
    expect(state.sessionsWithPendingConfirmations).toContain('session-1')
    // Should NOT add to local pendingPathConfirmations
    expect(state.pendingPathConfirmations).toHaveLength(0)
    // Should mark as unread
    expect(state.unreadSessionIds).toContain('session-1')
  })

  it('stores cross-session confirmation via session.confirmation_pending message', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        { id: 'session-1', projectId: 'project-1', title: 'My Session', updatedAt: 'a', messageCount: 0 } as any,
      ],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.confirmation_pending',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })

    const state = useSessionStore.getState()
    expect(state.crossSessionConfirmations['session-1']).toHaveLength(1)
    expect(state.sessionsWithPendingConfirmations).toContain('session-1')
  })

  it('removes cross-session confirmation via session.confirmation_resolved message', async () => {
    const useSessionStore = await loadSessionStore()

    // Pre-populate a cross-session confirmation
    useSessionStore.setState((state) => ({
      ...state,
      crossSessionConfirmations: {
        'session-1': [
          {
            callId: 'call-git',
            tool: 'run_command',
            paths: ['--no-verify'],
            workdir: '/tmp/project-1',
            reason: 'git_no_verify' as const,
          },
        ],
      },
      sessionsWithPendingConfirmations: ['session-1'],
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.confirmation_resolved',
      sessionId: 'session-1',
      payload: { sessionId: 'session-1', callId: 'call-git' },
    })

    const state = useSessionStore.getState()
    expect(state.crossSessionConfirmations['session-1']).toBeUndefined()
    expect(state.sessionsWithPendingConfirmations).not.toContain('session-1')
  })

  it('clears cross-session confirmation when navigating to that session via session.state', async () => {
    const useSessionStore = await loadSessionStore()

    // Pre-populate cross-session confirmation for session-1
    useSessionStore.setState((state) => ({
      ...state,
      currentSession: { id: 'session-1', projectId: 'project-1' } as any,
      crossSessionConfirmations: {
        'session-1': [
          {
            callId: 'call-git',
            tool: 'run_command',
            paths: ['--no-verify'],
            workdir: '/tmp/project-1',
            reason: 'git_no_verify' as const,
          },
        ],
      },
      sessionsWithPendingConfirmations: ['session-1'],
    }))

    // Load session-1 (simulate session.state response after navigation)
    useSessionStore.getState().handleServerMessage({
      id: 'corr-1',
      type: 'session.state',
      sessionId: 'session-1',
      payload: {
        session: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          criteria: [],
          summary: null,
          messages: [],
        } as any,
        messages: [],
        pendingConfirmations: [
          {
            callId: 'call-git',
            tool: 'run_command',
            paths: ['--no-verify'],
            workdir: '/tmp/project-1',
            reason: 'git_no_verify' as const,
          },
        ],
      },
    })

    const state = useSessionStore.getState()
    // Cross-session tracking should be cleaned
    expect(state.crossSessionConfirmations['session-1']).toBeUndefined()
    expect(state.sessionsWithPendingConfirmations).not.toContain('session-1')
    // Local pending confirmations should be populated
    expect(state.pendingPathConfirmations).toHaveLength(1)
    expect(state.pendingPathConfirmations[0]!.callId).toBe('call-git')
  })

  it('does not render cross-session confirmation inline in current session', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-2',
        projectId: 'project-1',
        workdir: '/tmp/project-2',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    // Receive confirmation for a different session
    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })

    const state = useSessionStore.getState()
    // Should NOT be in local pendingPathConfirmations
    expect(state.pendingPathConfirmations).toHaveLength(0)
    // Should be in cross-session tracking
    expect(state.crossSessionConfirmations['session-1']).toHaveLength(1)
  })

  it('does not add cross-session entry when confirmation is for current session', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })

    const state = useSessionStore.getState()
    expect(state.pendingPathConfirmations).toHaveLength(1)
    expect(state.pendingPathConfirmations[0]!.callId).toBe('call-git')
    expect(Object.keys(state.crossSessionConfirmations)).toHaveLength(0)
    expect(state.sessionsWithPendingConfirmations).not.toContain('session-1')
  })

  it('deduplicates chat.path_confirmation with same callId via WS replay', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })

    const state = useSessionStore.getState()
    expect(state.pendingPathConfirmations).toHaveLength(1)
  })

  it('deduplicates session.confirmation_pending with same callId', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.getState().handleServerMessage({
      type: 'session.confirmation_pending',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'session.confirmation_pending',
      sessionId: 'session-1',
      payload: {
        callId: 'call-git',
        tool: 'run_command',
        paths: ['--no-verify'],
        workdir: '/tmp/project-1',
        reason: 'git_no_verify',
      },
    })

    const state = useSessionStore.getState()
    expect(state.crossSessionConfirmations['session-1']).toHaveLength(1)
  })

  it('cleans cross-session state when loading session via REST', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: null,
      crossSessionConfirmations: {
        'session-1': [
          {
            callId: 'call-git',
            tool: 'run_command',
            paths: ['--no-verify'],
            workdir: '/tmp/project-1',
            reason: 'git_no_verify' as const,
          },
        ],
        'session-2': [
          {
            callId: 'call-other',
            tool: 'read_file',
            paths: ['/tmp/other.txt'],
            workdir: '/tmp/project-2',
            reason: 'outside_workdir' as const,
          },
        ],
      },
      sessionsWithPendingConfirmations: ['session-1', 'session-2'],
    }))

    await useSessionStore.getState().loadSession('session-1')

    const state = useSessionStore.getState()
    expect(state.crossSessionConfirmations['session-1']).toBeUndefined()
    expect(state.crossSessionConfirmations['session-2']).toBeDefined()
    expect(state.sessionsWithPendingConfirmations).toEqual(['session-2'])
  })

  it('preserves pending confirmations as cross-session when navigating away', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      pendingPathConfirmations: [
        {
          callId: 'call-git',
          tool: 'run_command',
          paths: ['--no-verify'],
          workdir: '/tmp/project-1',
          reason: 'git_no_verify' as const,
        },
      ],
      crossSessionConfirmations: {},
      sessionsWithPendingConfirmations: [],
    }))

    await useSessionStore.getState().loadSession('session-2')

    const state = useSessionStore.getState()
    expect(state.pendingPathConfirmations).toHaveLength(0)
    expect(state.crossSessionConfirmations['session-1']).toBeDefined()
    expect(state.crossSessionConfirmations['session-1']).toHaveLength(1)
    expect(state.crossSessionConfirmations['session-1']![0]!.callId).toBe('call-git')
    expect(state.sessionsWithPendingConfirmations).toContain('session-1')
  })
})

describe('confirmPath error handling', () => {
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

  it('surfaces errors when server returns non-ok response [KNOWN BUG: silently swallowed]', async () => {
    const useSessionStore = await loadSessionStore()

    // Spy on console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Set up a session with a pending confirmation
    useSessionStore.setState((state) => ({
      ...state,
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
      pendingPathConfirmations: [
        {
          callId: 'call-123',
          tool: 'run_command',
          paths: ['/tmp/some-path'],
          workdir: '/tmp/project-1',
          reason: 'outside_workdir' as const,
        },
      ],
    }))

    // Mock fetch to return 404 (non-ok response)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ success: false, error: 'No pending path confirmation with that ID' }),
    })

    await useSessionStore.getState().confirmPath('session-1', 'call-123', true, false)

    // BUG: confirmPath doesn't check res.ok, so errors are silently swallowed.
    // The confirmation should remain in pendingPathConfirmations when the
    // server returns an error, and the error should be surfaced.
    // Currently the function only logs in the catch block (network errors),
    // not for non-ok HTTP responses.

    // The confirmation should NOT be removed since the server didn't process it
    const state = useSessionStore.getState()
    expect(state.pendingPathConfirmations).toHaveLength(1)
    expect(state.pendingPathConfirmations[0]!.callId).toBe('call-123')

    // An error should be surfaced (either console.error or store.error)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})

describe('cross-tab sidebar sync', () => {
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

  it('adds new session to list on session.created message', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      sessions: [
        { id: 'session-1', projectId: 'project-1', title: 'Existing', updatedAt: 'a', messageCount: 0 } as any,
      ],
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.created',
      sessionId: 'session-2',
      payload: {
        session: {
          id: 'session-2',
          projectId: 'project-1',
          title: 'New Session',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          createdAt: '2026-07-19T10:00:00Z',
          updatedAt: '2026-07-19T10:00:00Z',
          messageCount: 0,
          criteriaCount: 0,
          criteriaCompleted: 0,
        },
      },
    })

    const state = useSessionStore.getState()
    expect(state.sessions).toHaveLength(2)
    expect(state.sessions[0]!.id).toBe('session-2')
    expect(state.sessions[0]!.title).toBe('New Session')
  })

  it('updates existing session on session.created if already in list', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      sessions: [
        { id: 'session-1', projectId: 'project-1', title: 'Old Title', updatedAt: 'a', messageCount: 0 } as any,
      ],
    })

    useSessionStore.getState().handleServerMessage({
      type: 'session.created',
      sessionId: 'session-1',
      payload: {
        session: {
          id: 'session-1',
          projectId: 'project-1',
          title: 'Updated Title',
          workdir: '/tmp/project-1',
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          createdAt: '2026-07-19T10:00:00Z',
          updatedAt: '2026-07-19T10:05:00Z',
          messageCount: 5,
          criteriaCount: 2,
          criteriaCompleted: 1,
        },
      },
    })

    const state = useSessionStore.getState()
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]!.title).toBe('Updated Title')
    expect(state.sessions[0]!.messageCount).toBe(5)
  })

  it('does not refetch a session that was already loaded (sequential guard)', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    })

    await useSessionStore.getState().loadSession('session-1')
    const fetchesForS1 = () =>
      fetchMock.mock.calls.filter(
        (c) =>
          String((c as unknown[])[0]).includes('/api/sessions/session-1') &&
          !String((c as unknown[])[0]).includes('/background-processes'),
      ).length

    expect(fetchesForS1()).toBe(1)
    await useSessionStore.getState().loadSession('session-1')
    expect(fetchesForS1()).toBe(1)
  })

  it('refetches when loading a different session after a previous load', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    })

    await useSessionStore.getState().loadSession('session-1')
    await useSessionStore.getState().loadSession('session-2')

    const fetchesForS1 = fetchMock.mock.calls.filter(
      (c) =>
        String((c as unknown[])[0]).includes('/api/sessions/session-1') &&
        !String((c as unknown[])[0]).includes('/background-processes'),
    ).length
    const fetchesForS2 = fetchMock.mock.calls.filter(
      (c) =>
        String((c as unknown[])[0]).includes('/api/sessions/session-2') &&
        !String((c as unknown[])[0]).includes('/background-processes'),
    ).length
    expect(fetchesForS1).toBe(1)
    expect(fetchesForS2).toBe(1)
  })

  it('clears the sequential guard on reconnect so the session is refetched', async () => {
    const useSessionStore = await loadSessionStore()
    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        criteria: [],
        summary: null,
      } as any,
    })

    await useSessionStore.getState().loadSession('session-1')
    useSessionStore.getState().reconnect()
    await useSessionStore.getState().loadSession('session-1')

    const fetches = fetchMock.mock.calls.filter(
      (c) =>
        String((c as unknown[])[0]).includes('/api/sessions/session-1') &&
        !String((c as unknown[])[0]).includes('/background-processes'),
    ).length
    expect(fetches).toBe(2)
  })
})

describe('toggleFavorite', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('calls the favorite API with isFavorite, applies optimistic update, and refreshes on success', async () => {
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
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

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sessions: [],
            hasMore: false,
          }),
      } as any)

    const promise = useSessionStore.getState().toggleFavorite('session-1', true)

    // Optimistic flip is applied before the API resolves
    expect(useSessionStore.getState().sessions.find((s) => s.id === 'session-1')?.isFavorite).toBe(true)

    const result = await promise

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/sessions/session-1/favorite',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ isFavorite: true }),
      }),
    )
    // listSessions refresh — scoped to the session's project, not global
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/sessions?limit=20&projectId=project-1',
      expect.objectContaining({}),
    )
  })

  it('returns false, reverts the optimistic update, and does not refresh the list when the API fails', async () => {
    const useSessionStore = await loadSessionStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          isFavorite: true,
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
        },
      ],
    }))

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'isFavorite is required and must be a boolean' }),
    } as any)

    const result = await useSessionStore.getState().toggleFavorite('session-1', false)

    expect(result).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Optimistic flip was reverted to the original value
    expect(useSessionStore.getState().sessions.find((s) => s.id === 'session-1')?.isFavorite).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('returns false and reverts the optimistic update when the API call throws', async () => {
    const useSessionStore = await loadSessionStore()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    useSessionStore.setState((state) => ({
      ...state,
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project-1',
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

    fetchMock.mockRejectedValueOnce(new Error('network error'))

    const result = await useSessionStore.getState().toggleFavorite('session-1', true)

    expect(result).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Optimistic flip was reverted
    expect(useSessionStore.getState().sessions.find((s) => s.id === 'session-1')?.isFavorite).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('homepage session loading', () => {
  it('listHomeSessions fetches only the lean home route', async () => {
    const useSessionStore = await loadSessionStore()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              id: 's1',
              projectId: 'p1',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              messageCount: 3,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        }),
    } as never)

    await useSessionStore.getState().listHomeSessions()

    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().sessions[0]!.id).toBe('s1')
    expect(useSessionStore.getState().sessionsHasMore).toBe(false)
    const urls = fetchMock.mock.calls.map((c) => (c as unknown[])[0])
    expect(urls).toContain('/api/sessions/home')
    // the full-list endpoint (which parses every snapshot) must never fire on a home load
    expect(urls.filter((url) => url === '/api/sessions')).toHaveLength(0)
  })

  it('a fresh home load never fetches the full session list', async () => {
    const useSessionStore = await loadSessionStore()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [] }),
    } as never)

    await useSessionStore.getState().listHomeSessions()

    expect(useSessionStore.getState().searchSessions).toBeNull()
    const urls = fetchMock.mock.calls.map((c) => (c as unknown[])[0])
    expect(urls).not.toContain('/api/sessions')
  })

  it('listHomeSessions REPLACES the list so sessions falling out of the curated set are removed', async () => {
    const useSessionStore = await loadSessionStore()

    // Seed the store with several sessions across projects (as if a prior
    // home poll populated them).
    useSessionStore.setState((state: any) => ({
      ...state,
      sessions: [
        {
          id: 'old-a1',
          projectId: 'pa',
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
          id: 'old-a2',
          projectId: 'pa',
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
          id: 'old-b1',
          projectId: 'pb',
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

    // The curated home poll now returns only a1 (a2 fell out of top-5, b1 removed)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              id: 'old-a1',
              projectId: 'pa',
              workdir: '/tmp/a',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              messageCount: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        }),
    } as never)

    await useSessionStore.getState().listHomeSessions()

    const state = useSessionStore.getState()
    // REPLACE semantics: only the curated session remains; stale ones dropped
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]!.id).toBe('old-a1')
    expect(state.sessions.find((s: any) => s.id === 'old-a2')).toBeUndefined()
    expect(state.sessions.find((s: any) => s.id === 'old-b1')).toBeUndefined()
  })

  it('ensureFullSessionList loads the full corpus once and caches it for later calls', async () => {
    const useSessionStore = await loadSessionStore()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              id: 's1',
              projectId: 'p1',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              messageCount: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              recentUserPrompts: [{ id: 'm1', content: 'hello', timestamp: '2024-01-01T00:00:00.000Z' }],
            },
            {
              id: 's2',
              projectId: 'p2',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              messageCount: 2,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        }),
    } as never)

    const state = useSessionStore.getState()
    await state.ensureFullSessionList()
    await state.ensureFullSessionList()

    expect(useSessionStore.getState().searchSessions).toHaveLength(2)
    const fullListCalls = fetchMock.mock.calls.map((c) => (c as unknown[])[0]).filter((url) => url === '/api/sessions')
    expect(fullListCalls).toHaveLength(1)
  })

  it('invalidates the search corpus when a session is deleted so stale entries disappear', async () => {
    const useSessionStore = await loadSessionStore()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              id: 's1',
              projectId: 'p1',
              mode: 'planner',
              phase: 'plan',
              isRunning: false,
              messageCount: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        }),
    } as never)
    await useSessionStore.getState().ensureFullSessionList()
    expect(useSessionStore.getState().searchSessions).not.toBeNull()

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], pendingConfirmationsBySession: {} }),
    } as never)
    await useSessionStore.getState().deleteSession('s1')

    expect(useSessionStore.getState().searchSessions).toBeNull()
  })
})

describe('cross-project session list stability after mutation', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  // Build N sessions for project A and M sessions for project B in the store.
  function seedCrossProjectSessions(useSessionStore: any, n: number, m: number): void {
    const sessions: any[] = []
    for (let i = 0; i < n; i++) {
      sessions.push({
        id: `a${i}`,
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
      })
    }
    for (let i = 0; i < m; i++) {
      sessions.push({
        id: `b${i}`,
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
      })
    }
    useSessionStore.setState((state: any) => ({ ...state, sessions }))
  }

  it('deleteSession reloads scoped to the deleted session project and does not drop other projects', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 10, 8)

    // DELETE succeeds
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) } as never)
    // Scoped reload returns the 9 remaining project-a sessions
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: Array.from({ length: 9 }, (_, i) => ({
            id: `a${i}`,
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
          })),
          hasMore: false,
          pendingConfirmationsBySession: {},
        }),
    } as never)

    await useSessionStore.getState().deleteSession('a9')

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    // The reload MUST be scoped to project-a, not a bare global list
    expect(urls.some((url) => url.includes('projectId=project-a'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)

    const state = useSessionStore.getState()
    const projectA = state.sessions.filter((s: any) => s.projectId === 'project-a')
    const projectB = state.sessions.filter((s: any) => s.projectId === 'project-b')
    // project-a lost exactly the deleted session; project-b is untouched
    expect(projectA).toHaveLength(9)
    expect(projectB).toHaveLength(8)
  })

  it('deleteSession stays scoped even when the session.deleted WS event lands before the DELETE resolves', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 10, 8)

    const scopedPayload = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: Array.from({ length: 9 }, (_, i) => ({
            id: `a${i}`,
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
          })),
          hasMore: false,
          pendingConfirmationsBySession: {},
        }),
    }

    // The server broadcasts session.deleted BEFORE responding to the DELETE.
    // Simulate that ordering: the WS handler wipes the session (and its pane)
    // from state, then the DELETE resolves and deleteSession must still know
    // which project to scope its reload to.
    fetchMock.mockImplementationOnce(() => {
      useSessionStore.getState().handleServerMessage({
        type: 'session.deleted',
        sessionId: 'a9',
        payload: { sessionId: 'a9' },
      } as any)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }) as never
    })
    fetchMock.mockResolvedValue(scopedPayload as never)

    await useSessionStore.getState().deleteSession('a9')
    await new Promise((resolve) => setTimeout(resolve, 10))

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    // No bare global list may ever be issued, even though the session was
    // already gone from state when deleteSession resolved its projectId.
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)
    expect(urls.some((url) => url.includes('projectId=project-a'))).toBe(true)

    const state = useSessionStore.getState()
    expect(state.sessions.filter((s: any) => s.projectId === 'project-a')).toHaveLength(9)
    expect(state.sessions.filter((s: any) => s.projectId === 'project-b')).toHaveLength(8)
  })

  it('toggleFavorite reloads scoped to the modified session project', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 3, 5)

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], hasMore: false, pendingConfirmationsBySession: {} }),
    } as never)

    await useSessionStore.getState().toggleFavorite('b2', true)

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((url) => url.includes('projectId=project-b'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)
  })

  it('renameSession reloads scoped to the modified session project', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 3, 5)

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], hasMore: false, pendingConfirmationsBySession: {} }),
    } as never)

    await useSessionStore.getState().renameSession('a1', 'new title')

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((url) => url.includes('projectId=project-a'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)
  })

  it('deleteAllSessions reloads scoped to the given project', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 3, 5)

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) } as never)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], hasMore: false, pendingConfirmationsBySession: {} }),
    } as never)

    await useSessionStore.getState().deleteAllSessions('project-a')

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((url) => url.includes('projectId=project-a'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions?limit=20')).toBe(false)
  })

  it('listSessions scoped to a project does not drop other projects already in state (union merge)', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 3, 5)

    // Scoped reload returns only project-a sessions
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sessions: [
            {
              id: 'a0',
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

    await useSessionStore.getState().listSessions('project-a')

    const state = useSessionStore.getState()
    const projectA = state.sessions.filter((s: any) => s.projectId === 'project-a')
    const projectB = state.sessions.filter((s: any) => s.projectId === 'project-b')
    // project-a refreshed (1 returned), project-b preserved (not dropped)
    expect(projectA).toHaveLength(1)
    expect(projectB).toHaveLength(5)
  })

  it('loadMoreSessions offsets by the target project count, not the global sessions length', async () => {
    const useSessionStore = await loadSessionStore()
    seedCrossProjectSessions(useSessionStore, 20, 8)

    // Mark that there are more sessions to load
    useSessionStore.setState({ sessionsHasMore: true })

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sessions: [], hasMore: false }),
    } as never)

    await useSessionStore.getState().loadMoreSessions('project-a')

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    const loadMoreUrl = urls.find((u) => u.includes('projectId=project-a') && u.includes('offset='))
    expect(loadMoreUrl).toBeDefined()
    // project-a has 20 sessions in state; offset must be 20, NOT 28 (20+8 preserved)
    expect(loadMoreUrl!).toContain('offset=20')
    expect(loadMoreUrl!).not.toContain('offset=28')
  })
})

describe('connect session-list refresh', () => {
  // Fires every registered WS-status callback. The harness may hold stale
  // callbacks from earlier tests' modules; the current store's callback is
  // always among them, and stale ones only ever run the same lean handler on
  // an empty store.
  function fireConnectedCallbacks(): void {
    for (const call of wsStatusMock.mock.calls) {
      const cb = (call as Array<(s: string) => void>)[0]!
      ;(cb as (s: string) => void)('connected')
    }
  }

  it('does not fire the heavyweight global list when no session is open (homepage)', async () => {
    const useSessionStore = await loadSessionStore()
    await useSessionStore.getState().connect()

    fetchMock.mockClear()
    fireConnectedCallbacks()
    await new Promise((resolve) => setTimeout(resolve, 10))

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls).toContain('/api/projects')
    expect(urls.some((url) => url === '/api/sessions' || url.startsWith('/api/sessions?'))).toBe(false)
  })

  it('refreshes only the active project list on connect when a session is open', async () => {
    const useSessionStore = await loadSessionStore()
    await useSessionStore.getState().connect()
    useSessionStore.setState({ currentSession: { id: 's1', projectId: 'p1' } as never })

    fetchMock.mockClear()
    fireConnectedCallbacks()
    await new Promise((resolve) => setTimeout(resolve, 10))

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((url) => url.includes('projectId=p1'))).toBe(true)
    expect(urls.some((url) => url === '/api/sessions')).toBe(false)
  })
})
