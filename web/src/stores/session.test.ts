import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

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

vi.mock('../lib/ws', () => ({
  wsClient: {
    send: wsSendMock,
    subscribe: wsSubscribeMock,
    connect: wsConnectMock,
    disconnect: wsDisconnectMock,
    onStatusChange: wsStatusMock,
  },
}))

vi.mock('../lib/sound', () => ({
  playNotification: playNotificationMock,
  playAchievement: playAchievementMock,
  playIntervention: playInterventionMock,
  playWaitingForUser: playWaitingForUserMock,
  playNewMessage: playNewMessageMock,
}))

type SessionStoreModule = typeof import('./session')

async function loadSessionStore(): Promise<SessionStoreModule['useSessionStore']> {
  vi.resetModules()
  const module = await import('./session')
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
      messages: [{
        id: 'session-1-assistant',
        role: 'assistant',
        content: 'still streaming',
        timestamp: '2024-01-01T00:00:00.000Z',
        tokenCount: 0,
        isStreaming: true,
      }],
      currentTodos: [{ content: 'old todo', status: 'pending' }],
      contextState: { currentTokens: 99, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
      pendingPathConfirmation: {
        callId: 'path-old',
        tool: 'read_file',
        paths: ['/tmp/project-1/secret.txt'],
        workdir: '/tmp/project-1',
        reason: 'outside_workdir',
      },
      error: { code: 'CHAT_ERROR', message: 'old error' },
    }))

    useSessionStore.getState().loadSession('session-2')

    expect(wsSendMock).toHaveBeenCalledWith('session.load', { sessionId: 'session-2' })
    expect(useSessionStore.getState().currentSession).toBeNull()
    expect(useSessionStore.getState().messages).toEqual([])
    expect(useSessionStore.getState().currentTodos).toEqual([])
    expect(useSessionStore.getState().contextState).toBeNull()
    expect(useSessionStore.getState().pendingPathConfirmation).toBeNull()

    useSessionStore.getState().handleServerMessage({
      id: 'load-session-2',
      type: 'session.state',
      sessionId: 'session-2',
      payload: {
        session: sessionTwo,
        messages: [{
          id: 'session-2-assistant',
          role: 'assistant',
          content: 'session two',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: false,
        }],
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
    expect(useSessionStore.getState().messages).toEqual([{ 
      id: 'session-2-assistant',
      role: 'assistant',
      content: 'session two',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      isStreaming: false,
    }])
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
      pendingPathConfirmation: {
        callId: 'path-1',
        tool: 'read_file',
        paths: ['/tmp/project-1/secrets.txt'],
        workdir: '/tmp/project-1',
        reason: 'outside_workdir',
      },
    }))

    useSessionStore.getState().handleServerMessage({
      type: 'session.running',
      sessionId: 'session-1',
      payload: { isRunning: false },
    })

    expect(useSessionStore.getState().currentSession?.isRunning).toBe(false)
    expect(useSessionStore.getState().pendingPathConfirmation).toBeNull()
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
      streamingMessageId: 'assistant-1',
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
    expect(useSessionStore.getState().streamingMessageId).toBeNull()
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
        isRunning: true,
        createdAt: 'a',
        updatedAt: 'b',
        criteriaCount: 0,
        criteriaCompleted: 0,
        messageCount: 0,
      },
    ])
  })

  it('does not let a stale session.list clear a background running indicator', async () => {
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
          createdAt: 'a',
          updatedAt: 'b',
          criteriaCount: 0,
          criteriaCompleted: 0,
          messageCount: 0,
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
          },
        ],
      },
    })

    expect(useSessionStore.getState().sessions).toEqual([
      {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'planner',
        phase: 'build',
        isRunning: true,
        createdAt: 'a',
        updatedAt: 'c',
        criteriaCount: 0,
        criteriaCompleted: 0,
      },
    ])
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
        recentUserPrompts: [
          { id: 'msg-3', content: 'Third prompt', timestamp: '2024-01-02T12:00:00.000Z' },
        ],
      },
    ]

    useSessionStore.setState({
      sessions: [],
      currentSession: null,
      unreadSessionIds: [],
      messages: [],
      streamingMessageId: null,
      currentTodos: [],
      contextState: null,
      pendingPathConfirmation: null,
      error: null,
    })

    // Handle session.list message
    useSessionStore.getState().handleServerMessage({
      type: 'session.list',
      payload: {
        sessions: incomingSessions as any,
      },
    })

    const result = useSessionStore.getState().sessions

    // Verify recentUserPrompts are preserved
    expect(result[0]!.recentUserPrompts).toEqual([
      { id: 'msg-1', content: 'First prompt', timestamp: '2024-01-01T10:00:00.000Z' },
      { id: 'msg-2', content: 'Second prompt', timestamp: '2024-01-01T11:00:00.000Z' },
    ])
    expect(result[1]!.recentUserPrompts).toEqual([
      { id: 'msg-3', content: 'Third prompt', timestamp: '2024-01-02T12:00:00.000Z' },
    ])
    
    // Verify messageCount is preserved
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
      streamingMessageId: null,
      currentTodos: [],
      contextState: null,
      pendingPathConfirmation: null,
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

  it('plays new_message sound on first chat.thinking for a new assistant message', async () => {
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

    expect(playNewMessageMock).toHaveBeenCalledTimes(1)
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
      pendingQuestion: {
        callId: 'call-123',
        question: 'What is your name?',
      },
    })

    useSessionStore.getState().answerQuestion('call-123', 'My name is Conrad')

    expect(wsSendMock).toHaveBeenCalledWith('ask.answer', {
      callId: 'call-123',
      answer: 'My name is Conrad',
    })
    expect(useSessionStore.getState().pendingQuestion).toBeNull()
  })

  it('clears pendingQuestion when answerQuestion is called with empty answer (skip)', async () => {
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
      pendingQuestion: {
        callId: 'call-456',
        question: 'Do you want to continue?',
      },
    })

    useSessionStore.getState().answerQuestion('call-456', '')

    expect(wsSendMock).toHaveBeenCalledWith('ask.answer', {
      callId: 'call-456',
      answer: '',
    })
    expect(useSessionStore.getState().pendingQuestion).toBeNull()
  })
})
