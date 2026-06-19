import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getEventStore } from '../events/store.js'
import { runChatTurn } from './orchestrator.js'
import { loadAllAgentsDefault } from '../agents/registry.js'

vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(),
  findAgentById: vi.fn((id: string) => ({
    metadata: {
      id,
      name: id === 'planner' ? 'Planner' : 'Builder',
      description: '',
      allowedTools: [],
      subagent: false,
    },
    prompt: id === 'planner' ? '# Plan Mode\nPlan carefully' : '# Build Mode\nBuild carefully',
  })),
}))

function createEventStore(initialEvents: any[] = []) {
  const events: any[] = [...initialEvents]
  return {
    append: vi.fn((_sessionId: string, event: any) => {
      events.push(event)
    }),
    getEvents: vi.fn(() => events),
    getAllEvents: vi.fn(() => events),
    getLatestSnapshot: vi.fn().mockReturnValue(undefined),
    cleanupOldEvents: vi.fn(),
    getLatestSeq: vi.fn().mockReturnValue(0),
    deleteSession: vi.fn(),
  }
}

function createSessionManager(state: any) {
  return {
    requireSession: vi.fn(() => state['current']),
    getCurrentWindowMessages: vi.fn(() => state['current'].messages ?? []),
    getContextState: vi.fn(() => ({
      currentTokens: 0,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
      dynamicContextChanged: false,
    })),
    setCurrentContextSize: vi.fn(),
    addTokensUsed: vi.fn(),
    compactContext: vi.fn(),
    getLspManager: vi.fn(() => ({ name: 'lsp' })),
    setRunning: vi.fn(),
    updateExecutionState: vi.fn(),
    addMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageStats: vi.fn(),
    drainAsapMessages: vi.fn(() => []),
  }
}

function findFullDefinitionCalls(eventStore: ReturnType<typeof createEventStore>, modeName: string) {
  return eventStore.append.mock.calls.filter(
    ([, event]: any) =>
      event.type === 'message.start' &&
      event.data.messageKind === 'auto-prompt' &&
      event.data.content?.includes('<system-reminder>') &&
      event.data.content?.includes(modeName) &&
      !event.data.content?.includes('Reminder:'),
  )
}

function findSmallReminderCalls(eventStore: ReturnType<typeof createEventStore>) {
  return eventStore.append.mock.calls.filter(
    ([, event]: any) =>
      event.type === 'message.start' &&
      event.data.messageKind === 'auto-prompt' &&
      event.data.content?.includes('Reminder:'),
  )
}

describe('System Reminder Injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injects full definition on first turn (no prior agent message)', async () => {
    const eventStore = createEventStore()
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: null,
        messages: [{ id: 'user-1', role: 'user', content: 'Do the plan' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    const fullDefs = findFullDefinitionCalls(eventStore, 'Plan Mode')
    expect(fullDefs).toHaveLength(1)
    expect(fullDefs[0]![1].data.content).toContain('Plan Mode')
    expect(fullDefs[0]![1].data.content).not.toContain('Reminder:')
    expect(fullDefs[0]![1].data.metadata.kind).toBe('definition')

    const smallReminders = findSmallReminderCalls(eventStore)
    expect(smallReminders).toHaveLength(0)
  })

  it('injects small reminder on subsequent turn in same mode', async () => {
    const existingEvents = [
      {
        type: 'message.start',
        data: {
          messageId: 'reminder-1',
          role: 'user',
          messageKind: 'auto-prompt',
          content: '<system-reminder>\n# Plan Mode\nPlan carefully\n</system-reminder>',
          isSystemGenerated: true,
          metadata: { type: 'agent', name: 'Planner', color: '#a855f7' },
        },
      },
      { type: 'message.done', data: { messageId: 'reminder-1' } },
    ]
    const eventStore = createEventStore(existingEvents)
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: null,
        messages: [{ id: 'user-1', role: 'user', content: 'Continue planning' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    const smallReminders = findSmallReminderCalls(eventStore)
    expect(smallReminders).toHaveLength(1)
    expect(smallReminders[0]![1].data.content).toContain("Reminder: you are in 'Planner' mode")
    expect(smallReminders[0]![1].data.metadata.kind).toBe('reminder')

    const fullDefs = findFullDefinitionCalls(eventStore, 'Plan Mode')
    expect(fullDefs).toHaveLength(0)
  })

  it('injects full definition when switching modes', async () => {
    const existingEvents = [
      {
        type: 'message.start',
        data: {
          messageId: 'reminder-1',
          role: 'user',
          messageKind: 'auto-prompt',
          content: '<system-reminder>\n# Plan Mode\nPlan carefully\n</system-reminder>',
          isSystemGenerated: true,
          metadata: { type: 'agent', name: 'Planner', color: '#a855f7' },
        },
      },
      { type: 'message.done', data: { messageId: 'reminder-1' } },
    ]
    const eventStore = createEventStore(existingEvents)
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        executionState: null,
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    const fullDefs = findFullDefinitionCalls(eventStore, 'Build Mode')
    expect(fullDefs).toHaveLength(1)
    expect(fullDefs[0]![1].data.content).toContain('Build Mode')
    expect(fullDefs[0]![1].data.content).not.toContain('Reminder:')
  })

  it('injects full definition after compaction (new window has no agent message)', async () => {
    const windowA = 'window-a'
    const windowB = 'window-b'

    const existingEvents = [
      {
        type: 'message.start',
        data: {
          messageId: 'reminder-1',
          role: 'user',
          messageKind: 'auto-prompt',
          content: '<system-reminder>\n# Plan Mode\nPlan carefully\n</system-reminder>',
          contextWindowId: windowA,
          isSystemGenerated: true,
          metadata: { type: 'agent', name: 'Planner', color: '#a855f7' },
        },
      },
      { type: 'message.done', data: { messageId: 'reminder-1' } },
      {
        type: 'context.compacted',
        data: {
          closedWindowId: windowA,
          newWindowId: windowB,
          beforeTokens: 1000,
          afterTokens: 0,
          summary: 'Compacted summary',
        },
      },
      {
        type: 'message.start',
        data: {
          messageId: 'summary-1',
          role: 'assistant',
          content: 'Compacted summary',
          contextWindowId: windowB,
          isCompactionSummary: true,
        },
      },
      { type: 'message.done', data: { messageId: 'summary-1' } },
    ]
    const eventStore = createEventStore(existingEvents)
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: null,
        messages: [{ id: 'user-1', role: 'user', content: 'Continue after compaction' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    const fullDefs = findFullDefinitionCalls(eventStore, 'Plan Mode')
    expect(fullDefs).toHaveLength(1)
    const newReminder = fullDefs[0]![1].data
    expect(newReminder.contextWindowId).toBe(windowB)
    expect(newReminder.content).toContain('Plan Mode')
    expect(newReminder.content).not.toContain('Reminder:')
  })

  it('injects small reminder on every turn in same mode (not just once)', async () => {
    const eventStore = createEventStore()
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: null,
        messages: [{ id: 'user-1', role: 'user', content: 'Do the plan' }],
      },
    }
    const sessionManager = createSessionManager(state)

    for (let i = 0; i < 4; i++) {
      await runChatTurn({
        sessionManager: sessionManager as any,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as any,
      })
    }

    const fullDefs = findFullDefinitionCalls(eventStore, 'Plan Mode')
    expect(fullDefs).toHaveLength(1)

    const smallReminders = findSmallReminderCalls(eventStore)
    expect(smallReminders).toHaveLength(3)
  })
})
