/**
 * System Reminder Tests
 * 
 * Tests for mode reminder injection behavior:
 * - Reminder sent exactly once when mode is first activated
 * - No reminder on subsequent messages in same mode
 * - New reminder sent when switching modes
 * - Reminder preserved across session reloads
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getEventStore } from '../events/store.js'
import { runChatTurn } from './orchestrator.js'
import type { SessionManager } from '../session/index.js'
import { loadAllAgentsDefault } from '../agents/registry.js'

vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(),
  findAgentById: vi.fn((id: string) => ({
    metadata: { id, name: id === 'planner' ? 'Planner' : 'Builder', description: '', allowedTools: [], subagent: false },
    prompt: id === 'planner' ? '# Plan Mode\nPlan carefully' : '# Build Mode\nBuild carefully',
  })),
}))

function createEventStore() {
  return {
    append: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
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
    })),
    setCurrentContextSize: vi.fn(),
    addTokensUsed: vi.fn(),
    compactContext: vi.fn(),
    getLspManager: vi.fn(() => ({ name: 'lsp' })),
    updateExecutionState: vi.fn((_: string, updates: Record<string, unknown>) => {
      state['current'].executionState = { ...(state['current'].executionState ?? {}), ...updates }
    }),
    addMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageStats: vi.fn(),
    drainAsapMessages: vi.fn(() => []),
  }
}

describe('System Reminder Injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injects system reminder on first entry to planner mode', async () => {
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

    // Check that a system reminder was injected
    const reminderCall = eventStore.append.mock.calls.find(([, event]: any) => 
      event.type === 'message.start' && 
      event.data.messageKind === 'auto-prompt' &&
      event.data.content?.includes('<system-reminder>')
    )

    expect(reminderCall).toBeDefined()
    expect((reminderCall![1] as any).data.content).toContain('Plan Mode')
  })

  it('does NOT inject reminder on subsequent messages in same mode', async () => {
    const eventStore = createEventStore()
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    // Simulate a session that already has a planner reminder
    const existingEvents = [
      {
        type: 'message.start',
        data: {
          role: 'user',
          messageKind: 'auto-prompt',
          content: '<system-reminder>\n# Plan Mode\nPlan carefully\n</system-reminder>',
        },
      },
    ]
    eventStore.getEvents.mockReturnValue(existingEvents)

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { lastModeWithReminder: 'planner' },
        messages: [{ id: 'user-1', role: 'user', content: 'Continue planning' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    // Check that NO new system reminder was injected
    const reminderCalls = eventStore.append.mock.calls.filter(([, event]: any) => 
      event.type === 'message.start' && 
      event.data.messageKind === 'auto-prompt' &&
      event.data.content?.includes('<system-reminder>')
    )

    expect(reminderCalls).toHaveLength(0)
  })

  it('injects NEW reminder when switching from planner to builder mode', async () => {
    const eventStore = createEventStore()
    vi.mocked(getEventStore).mockReturnValue(eventStore as any)
    vi.mocked(loadAllAgentsDefault).mockResolvedValue([])

    // Simulate a session with a planner reminder
    const existingEvents = [
      {
        type: 'message.start',
        data: {
          role: 'user',
          messageKind: 'auto-prompt',
          content: '<system-reminder>\n# Plan Mode\nPlan carefully\n</system-reminder>',
        },
      },
    ]
    eventStore.getEvents.mockReturnValue(existingEvents)

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        executionState: { lastModeWithReminder: 'planner' },
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    // Check that a NEW builder reminder was injected
    const reminderCall = eventStore.append.mock.calls.find(([, event]: any) => 
      event.type === 'message.start' && 
      event.data.messageKind === 'auto-prompt' &&
      event.data.content?.includes('<system-reminder>') &&
      event.data.content?.includes('Build Mode')
    )

    expect(reminderCall).toBeDefined()
  })

  it('updates execution state after injecting reminder', async () => {
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
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as any,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as any,
    })

    // Check that execution state was updated
    expect(sessionManager.updateExecutionState).toHaveBeenCalledWith('session-1', {
      lastModeWithReminder: 'planner',
    })
  })

  it('does NOT inject duplicate reminders across 4+ iterations in same mode', async () => {
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

    // Simulate 4 iterations
    for (let i = 0; i < 4; i++) {
      await runChatTurn({
        sessionManager: sessionManager as any,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as any,
      })
    }

    // Count how many system reminders were injected
    const reminderCalls = eventStore.append.mock.calls.filter(([, event]: any) => 
      event.type === 'message.start' && 
      event.data.messageKind === 'auto-prompt' &&
      event.data.content?.includes('<system-reminder>')
    )

    // Should only have exactly 1 reminder (from the first iteration)
    expect(reminderCalls).toHaveLength(1)
    expect((reminderCalls[0]![1] as any).data.content).toContain('Plan Mode')
  })
})
