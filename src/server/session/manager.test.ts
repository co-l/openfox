import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { getLspManagerMock, shutdownLspManagerMock } = vi.hoisted(() => ({
  getLspManagerMock: vi.fn(() => ({ name: 'mock-lsp' })),
  shutdownLspManagerMock: vi.fn(async () => {}),
}))

vi.mock('../lsp/index.js', () => ({
  getLspManager: getLspManagerMock,
  shutdownLspManager: shutdownLspManagerMock,
}))

const mockGetGitBranch = vi.fn()

vi.mock('../git/workspace.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getGitBranch: (...args: any[]) => mockGetGitBranch(...args),
  }
})

import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { getSession, updateSessionWorkdir } from '../db/sessions.js'
import { initEventStore, getCurrentContextWindowId, emitContextCompacted, getEventStore } from '../events/index.js'
import * as eventModule from '../events/index.js'
import { setAgentModelOverride } from '../agents/model-overrides.js'
import { SessionManager } from './manager.js'

// Mock provider manager
const mockGlobalClient = {
  getModel: vi.fn(() => 'global-model'),
  setModel: vi.fn(),
  getProfile: vi.fn(),
  getBackend: vi.fn(() => 'unknown'),
  setBackend: vi.fn(),
  complete: vi.fn(),
  stream: vi.fn(),
}

const mockDedicatedClient = {
  getModel: vi.fn(() => 'dedicated-model'),
  setModel: vi.fn(),
  getProfile: vi.fn(),
  getBackend: vi.fn(() => 'unknown'),
  setBackend: vi.fn(),
  complete: vi.fn(),
  stream: vi.fn(),
}

const mockProviderManager = {
  getCurrentModelContext: vi.fn(() => 200000),
  getLLMClient: vi.fn(() => mockGlobalClient),
  createClient: vi.fn((): typeof mockDedicatedClient | undefined => mockDedicatedClient),
  getActiveProviderId: vi.fn(() => 'test-provider'),
  getCurrentModel: vi.fn(() => 'global-model'),
  getProviders: vi.fn(() => [] as Array<{ id: string; models: Array<{ id: string; contextWindow: number }> }>),
  getDefaultModelSelection: vi.fn(() => 'default-provider/default-model'),
  getModelSettings: vi.fn(
    (_providerId: string, modelId: string, _mode?: 'thinking' | 'non-thinking'): { maxTokens: number } | undefined => {
      if (modelId === 'override-model') return { maxTokens: 32000 }
      if (modelId === 'session-model') return { maxTokens: 262000 }
      if (modelId === 'default-model') return { maxTokens: 100000 }
      return undefined
    },
  ),
  resolveModelEffort: vi.fn((): string | undefined => undefined),
}

describe('SessionManager', () => {
  let workdir: string
  let projectId: string
  let manager: SessionManager

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    // Initialize EventStore with the database
    initEventStore(getDatabase())

    workdir = await mkdtemp(join(tmpdir(), 'openfox-session-manager-'))
    projectId = createProject('OpenFox', workdir).id
    manager = new SessionManager(mockProviderManager as any)
    getLspManagerMock.mockClear()
    shutdownLspManagerMock.mockClear()
    mockProviderManager.getCurrentModelContext.mockClear()
    mockGetGitBranch.mockResolvedValue(null) // default: no branch
  })

  afterEach(async () => {
    closeDatabase()
    await rm(workdir, { recursive: true, force: true })
  })

  it('creates, lists, loads, and deletes sessions with lifecycle events', () => {
    const events: string[] = []
    manager.subscribe((event) => {
      events.push(event.type)
    })

    const first = manager.createSession(projectId)
    const second = manager.createSession(projectId)

    expect(first.metadata.title).toBe('Session 1')
    expect(second.metadata.title).toBe('Session 2')
    expect(manager.getSession(first.id)?.id).toBe(first.id)
    expect(manager.requireSession(second.id).id).toBe(second.id)
    expect(manager.listSessions()).toHaveLength(2)
    expect(manager.listSessionsByProject(projectId).sessions).toHaveLength(2)
    expect(manager.listSessionsByProject('missing-project').sessions).toEqual([])

    manager.setActiveSession(first.id)
    expect(manager.getActiveSessionId()).toBe(first.id)

    manager.deleteSession(first.id)
    expect(manager.getSession(first.id)).toBeNull()
    expect(manager.getActiveSessionId()).toBeNull()
    expect(shutdownLspManagerMock).toHaveBeenCalledWith(first.id)
    expect(events).toEqual(['session_created', 'session_created', 'session_deleted'])
  })

  it('throws when requiring a missing session and resolves lsp managers lazily', () => {
    const session = manager.createSession(projectId)

    expect(() => manager.requireSession('missing')).toThrow('Session not found: missing')

    expect(manager.getLspManager(session.id)).toEqual({ name: 'mock-lsp' })
    expect(getLspManagerMock).toHaveBeenCalledWith(session.id, workdir)
  })

  it('getProjectWorkdir returns the project root even when a workspace is active', () => {
    const session = manager.createSession(projectId)
    const wsPath = join(workdir, '.worktrees', 'feature-x')
    // Mirrors what switchWorkspace does: workdir stays at the project root,
    // the workspace path goes into the separate workspace column.
    updateSessionWorkdir(session.id, workdir, wsPath)

    expect(manager.getEffectiveWorkdir(session.id)).toBe(wsPath)
    expect(manager.getProjectWorkdir(session.id)).toBe(workdir)
  })

  it('updates mode, phase, and running state while emitting events', () => {
    const session = manager.createSession(projectId, 'Custom Title')
    const allEvents: string[] = []
    const sessionEvents: string[] = []
    manager.subscribe((event) => {
      allEvents.push(event.type)
    })
    manager.subscribeToSession(session.id, (event) => {
      sessionEvents.push(event.type)
    })

    const builderSession = manager.setMode(session.id, 'builder')
    expect(builderSession.mode).toBe('builder')
    // In event-sourced model, execution state is derived from events
    // For a fresh session with no events, executionState is null

    expect(manager.setMode(session.id, 'builder').mode).toBe('builder')
    expect(manager.setPhase(session.id, 'build').phase).toBe('build')
    expect(manager.setPhase(session.id, 'build').phase).toBe('build')
    expect(manager.setRunning(session.id, true).isRunning).toBe(true)
    expect(manager.setRunning(session.id, true).isRunning).toBe(true)

    expect(allEvents).toContain('mode_changed')
    expect(allEvents).toContain('phase_changed')
    expect(allEvents).toContain('running_changed')
    expect(allEvents.filter((type) => type === 'session_updated').length).toBeGreaterThanOrEqual(2)
    expect(sessionEvents).toContain('mode_changed')
    expect(sessionEvents).toContain('phase_changed')
  })

  it('inherits project MCP overrides on createSession and cleans up on deleteSession', async () => {
    const { updateProject } = await import('../db/projects.js')
    const { getSessionDisabledServers } = await import('../mcp/session-overrides.js')

    updateProject(projectId, {
      mcpOverrides: {
        'server-disabled-1': { disabled: true },
        'server-disabled-2': { disabled: true },
        'server-enabled': { disabled: false },
      },
    })

    const session = manager.createSession(projectId, 'MCP Project Session')
    expect(getSessionDisabledServers(session.id)).toEqual(['server-disabled-1', 'server-disabled-2'])

    manager.deleteSession(session.id)
    expect(getSessionDisabledServers(session.id)).toEqual([])
  })

  it('uses database is_running as source of truth for session state', () => {
    const session = manager.createSession(projectId)

    // Set running to true via manager
    manager.setRunning(session.id, true)
    let loadedSession = manager.getSession(session.id)
    expect(loadedSession?.isRunning).toBe(true)

    // Set running to false via manager
    manager.setRunning(session.id, false)
    loadedSession = manager.getSession(session.id)
    expect(loadedSession?.isRunning).toBe(false)

    // Verify database was actually updated
    const dbSession = getSession(session.id)
    expect(dbSession?.isRunning).toBe(false)
  })

  it('returns correct isRunning even when EventStore has stale data', () => {
    const session = manager.createSession(projectId)

    // Set running to true
    manager.setRunning(session.id, true)
    expect(manager.getSession(session.id)?.isRunning).toBe(true)

    // Set running to false - this updates both DB and emits event
    manager.setRunning(session.id, false)

    // Verify DB has the correct value
    const dbSession = getSession(session.id)
    expect(dbSession?.isRunning).toBe(false)

    // When loading session, should use DB value (false)
    const loadedSession = manager.getSession(session.id)
    expect(loadedSession?.isRunning).toBe(false)
  })

  it('adds messages and manages context windows', () => {
    const session = manager.createSession(projectId)
    const eventTypes: string[] = []
    manager.subscribeToSession(session.id, (event) => {
      eventTypes.push(event.type)
    })

    const first = manager.addMessage(session.id, {
      role: 'user',
      content: 'hello',
      tokenCount: 1,
    })
    expect(first.contextWindowId).toBeDefined()
    expect(manager.getCurrentWindowMessages(session.id)).toHaveLength(1)

    // In event-sourced model, messages are immutable after creation
    // updateMessage and updateMessageStats are no-ops (data comes from events)
    const messageAfterAdd = manager.requireSession(session.id).messages[0]
    expect(messageAfterAdd).toMatchObject({
      content: 'hello',
      role: 'user',
    })

    const second = manager.addMessage(session.id, {
      role: 'user', // User messages can be added via addMessage
      content: 'fresh window',
      tokenCount: 2,
    })
    expect(second.contextWindowId).toBeDefined()
    expect(eventTypes).toContain('message_added')
    // In event-sourced model, message operations don't emit session_updated
    // (messages are stored as events, not in session object)
  })

  it('manages criteria lifecycle and verification attempts', () => {
    const session = manager.createSession(projectId)

    manager.setCriteria(session.id, [{ id: '0', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }])
    expect(manager.requireSession(session.id).criteria).toHaveLength(1)

    const addResult = manager.addCriterion(session.id, {
      id: '1',
      description: 'Second criterion',
      status: { type: 'pending' },
      attempts: [],
    })
    expect('criteria' in addResult && addResult.actualId).toBe('1')

    expect(() => manager.updateCriterionFull(session.id, 'missing', { description: 'x' })).toThrow(
      'Criterion not found: missing',
    )
    expect(() => manager.removeCriterion(session.id, 'missing')).toThrow('Criterion not found: missing')

    const updatedCriteria = manager.updateCriterionFull(session.id, '0', { description: 'Tests pass in CI' })
    expect(updatedCriteria.find((criterion) => criterion.id === '0')?.description).toBe('Tests pass in CI')

    manager.updateCriterionStatus(session.id, '0', { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' })
    manager.addCriterionAttempt(session.id, '0', {
      attemptNumber: 1,
      status: 'failed',
      timestamp: '2024-01-01T00:00:00.000Z',
      details: 'Needed one more fix',
    })
    expect(() =>
      manager.addCriterionAttempt(session.id, 'missing', {
        attemptNumber: 1,
        status: 'failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        details: 'nope',
      }),
    ).toThrow('Criterion not found: missing')

    manager.resetAllCriteriaAttempts(session.id)
    expect(manager.requireSession(session.id).criteria.find((criterion) => criterion.id === '0')?.attempts).toEqual([])

    const removed = manager.removeCriterion(session.id, '0')
    expect(removed.find((criterion) => criterion.id === '0')).toBeUndefined()
  })

  it('tracks read files in-memory, tokens, tool calls, and context state', () => {
    const session = manager.createSession(projectId)

    // Read files are now tracked in-memory per session (not persisted)
    manager.recordFileRead(session.id, 'src/index.ts', 'hash-1')
    expect(manager.getReadFiles(session.id)).toEqual({
      'src/index.ts': expect.objectContaining({ hash: 'hash-1', readAt: expect.any(String) }),
    })

    manager.updateFileHash(session.id, 'src/index.ts', 'hash-2')
    manager.updateFileHash(session.id, 'src/other.ts', 'hash-3')
    expect(manager.getReadFiles(session.id)['src/index.ts']?.hash).toBe('hash-2')
    expect(manager.getReadFiles(session.id)['src/other.ts']).toEqual({
      hash: 'hash-3',
      readAt: expect.any(String),
    })

    const firstMessage = manager.addMessage(session.id, {
      role: 'user',
      content: 'hello world',
      tokenCount: 3,
    })
    manager.addTokensUsed(session.id, 25)
    manager.incrementToolCalls(session.id)

    // Context state is now derived from events
    const contextState = manager.getContextState(session.id)
    expect(contextState).toMatchObject({
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
      dynamicContextChanged: false,
    })

    expect(manager.requireSession(session.id).metadata).toMatchObject({
      totalTokensUsed: 25,
      totalToolCalls: 1,
    })
    expect(firstMessage.id).toBeTruthy()
  })

  it('setCurrentContextSize emits context.state event with real promptTokens', () => {
    const session = manager.createSession(projectId)

    // Add a message first (tokenCount will be removed in Phase 2)
    manager.addMessage(session.id, {
      role: 'user',
      content: 'hello',
      tokenCount: 0,
    })

    // Simulate LLM response with real promptTokens
    manager.setCurrentContextSize(session.id, 78300)

    // Context state should reflect the real promptTokens, not calculated from messages
    const contextState = manager.getContextState(session.id)
    expect(contextState.currentTokens).toBe(78300)
    expect(contextState.dangerZone).toBe(false) // 78300 < 180000 (200000 - 20000)
    expect(contextState.canCompact).toBe(true) // 78300 > 40000 (200000 * 0.2)
  })

  it('setCurrentContextSize adds completionTokens to currentTokens for true context size', () => {
    const session = manager.createSession(projectId)

    // Last call: 83600 input tokens + 5650 output tokens = true context occupancy
    manager.setCurrentContextSize(session.id, 83600, 5650)

    const contextState = manager.getContextState(session.id)
    expect(contextState.currentTokens).toBe(89250)
  })

  it('computes dangerZone and canCompact from prompt + completion occupancy', () => {
    const session = manager.createSession(projectId)

    // contextWindow is 200000; danger zone fires under 20000 remaining.
    // Input alone (181000) would NOT be in the danger zone, but including the
    // last response's output (181000 + 6500 = 187500) leaves 12500 → danger.
    manager.setCurrentContextSize(session.id, 181000, 6500)

    const contextState = manager.getContextState(session.id)
    expect(contextState.currentTokens).toBe(187500)
    expect(contextState.dangerZone).toBe(true)
    expect(contextState.canCompact).toBe(true)
  })

  it('sub-agent context.state events do not inherit the main session compaction count', () => {
    const session = manager.createSession(projectId)

    // Main agent's context gets compacted a few times
    for (let i = 0; i < 3; i++) {
      const closedWindowId = getCurrentContextWindowId(session.id) ?? ''
      emitContextCompacted(session.id, closedWindowId, crypto.randomUUID(), 150000, 20000, `summary ${i + 1}`)
    }
    expect(manager.getContextState(session.id).compactionCount).toBe(3)

    // Sub-agent turns run in a fresh, never-compacted scoped context, so
    // their context.state event must report a compaction count of 0
    manager.setCurrentContextSize(session.id, 42511, 0, 'code-reviewer-run-1')

    const events = getEventStore().getEvents(session.id)
    const subAgentCtxEvents = events.filter((e) => e.type === 'context.state')
    expect(subAgentCtxEvents).toHaveLength(1)
    const subAgentCtx = subAgentCtxEvents[0]!.data as { subAgentId?: string; compactionCount: number }
    expect(subAgentCtx.subAgentId).toBe('code-reviewer-run-1')
    expect(subAgentCtx.compactionCount).toBe(0)
  })

  it('getContextState uses latest context.state event value', () => {
    const session = manager.createSession(projectId)

    // Initial state should be 0
    expect(manager.getContextState(session.id).currentTokens).toBe(0)

    // First LLM call reports 50k tokens
    manager.setCurrentContextSize(session.id, 50000)
    expect(manager.getContextState(session.id).currentTokens).toBe(50000)

    // Second LLM call reports 85k tokens (context grew)
    manager.setCurrentContextSize(session.id, 85000)
    expect(manager.getContextState(session.id).currentTokens).toBe(85000)

    // After compaction, context resets
    const closedWindowId = getCurrentContextWindowId(session.id) ?? ''
    const newWindowId = crypto.randomUUID()
    emitContextCompacted(session.id, closedWindowId, newWindowId, 85000, 0, 'summary')
    // New LLM call after compaction reports smaller context
    manager.setCurrentContextSize(session.id, 5000)
    expect(manager.getContextState(session.id).currentTokens).toBe(5000)
  })

  it('getContextState reflects setDynamicContextChanged from in-memory store', () => {
    const session = manager.createSession(projectId)

    // Default is false
    expect(manager.getContextState(session.id).dynamicContextChanged).toBe(false)

    // Set to true via in-memory store
    manager.setDynamicContextChanged(session.id, true)
    expect(manager.getContextState(session.id).dynamicContextChanged).toBe(true)

    // Set back to false
    manager.setDynamicContextChanged(session.id, false)
    expect(manager.getContextState(session.id).dynamicContextChanged).toBe(false)
  })

  it('getContextState exposes warmCache only while a cached system prompt exists', () => {
    const session = manager.createSession(projectId)

    // No cached prompt yet → cold cache (warmCache absent/undefined)
    expect(manager.getContextState(session.id).warmCache).toBeUndefined()

    // Simulate an LLM call having cached the system prompt
    manager.setCachedPrompt(session.id, 'cached system prompt', [], 'hash-1')
    expect(manager.getContextState(session.id).warmCache).toBe(true)
  })

  it('tracks the announced tool fingerprint independently of the cached prompt', () => {
    const session = manager.createSession(projectId)

    expect(manager.getAnnouncedToolFingerprint(session.id)).toBeUndefined()

    manager.setAnnouncedToolFingerprint(session.id, 'live-fingerprint')
    expect(manager.getAnnouncedToolFingerprint(session.id)).toBe('live-fingerprint')

    // The announced fingerprint must not depend on the cached prefix.
    manager.setCachedPrompt(session.id, 'cached system prompt', [], 'hash-1')
    expect(manager.getAnnouncedToolFingerprint(session.id)).toBe('live-fingerprint')
  })

  it('preserves subAgentId and subAgentType when adding messages', () => {
    const session = manager.createSession(projectId)
    const subAgentId = 'verifier-test-123'
    const subAgentType = 'verifier' as const

    const message = manager.addMessage(session.id, {
      role: 'user',
      content: 'Fresh Context',
      isSystemGenerated: true,
      messageKind: 'context-reset',
      subAgentId,
      subAgentType,
    })

    // The message should preserve subAgentId and subAgentType
    expect(message.subAgentId).toBe(subAgentId)
    expect(message.subAgentType).toBe(subAgentType)

    // Verify it's also in the stored session
    const storedSession = manager.requireSession(session.id)
    const storedMessage = storedSession.messages.find((m) => m.id === message.id)
    expect(storedMessage).toBeDefined()
    expect(storedMessage?.subAgentId).toBe(subAgentId)
    expect(storedMessage?.subAgentType).toBe(subAgentType)
  })

  it('groups verifier messages correctly for SubAgentContainer display', () => {
    const session = manager.createSession(projectId)
    const verifierId = 'verifier-run-001'

    // Add a sequence of verifier messages
    manager.addMessage(session.id, {
      role: 'user',
      content: 'Fresh Context',
      isSystemGenerated: true,
      messageKind: 'context-reset',
      subAgentId: verifierId,
      subAgentType: 'verifier',
    })

    manager.addMessage(session.id, {
      role: 'user',
      content: 'Verification context data',
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      subAgentId: verifierId,
      subAgentType: 'verifier',
    })

    manager.addMessage(session.id, {
      role: 'assistant',
      content: 'Verifying criteria...',
      subAgentId: verifierId,
      subAgentType: 'verifier',
    })

    // Get all messages for this session
    const allMessages = manager.requireSession(session.id).messages

    // All messages should have the verifier sub-agent metadata
    const verifierMessages = allMessages.filter((m) => m.subAgentId === verifierId && m.subAgentType === 'verifier')
    expect(verifierMessages).toHaveLength(3)
    expect(verifierMessages.every((m) => m.subAgentId === verifierId)).toBe(true)
    expect(verifierMessages.every((m) => m.subAgentType === 'verifier')).toBe(true)
  })

  it('uses maxTokens from providerManager when provided', () => {
    const customMaxTokens = 262144
    mockProviderManager.getCurrentModelContext.mockReturnValue(customMaxTokens)
    const session = manager.createSession(projectId, 'Test Session')

    const contextState = manager.getContextState(session.id)
    expect(contextState.maxTokens).toBe(customMaxTokens)
  })

  it('uses providerManager default when maxTokens is not provided', () => {
    mockProviderManager.getCurrentModelContext.mockReturnValue(200000)
    const session = manager.createSession(projectId, 'Test Session')

    const contextState = manager.getContextState(session.id)
    expect(contextState.maxTokens).toBe(200000)
  })

  it('getCurrentModelContext uses the session model context window when the session has a providerModel', () => {
    mockProviderManager.getProviders.mockReturnValue([
      { id: 'test-provider', models: [{ id: 'session-model-262k', contextWindow: 262144 }] },
      { id: 'other-provider', models: [{ id: 'default-model-100k', contextWindow: 100000 }] },
    ])
    mockProviderManager.getCurrentModelContext.mockReturnValue(100000)
    const session = manager.createSession(projectId, 'Test Session')
    manager.setSessionProvider(session.id, 'test-provider', 'session-model-262k')

    // Session model window (262K) wins over the global default model (100K).
    expect(manager.getCurrentModelContext(session.id)).toBe(262144)
  })

  it('getCurrentModelContext falls back to the global default context when the session model is unknown', () => {
    mockProviderManager.getProviders.mockReturnValue([
      { id: 'test-provider', models: [{ id: 'alpha-model', contextWindow: 262144 }] },
    ])
    mockProviderManager.getCurrentModelContext.mockReturnValue(100000)
    const session = manager.createSession(projectId, 'Test Session')
    manager.setSessionProvider(session.id, 'test-provider', 'beta-model')

    expect(manager.getCurrentModelContext(session.id)).toBe(100000)
  })

  it('getCurrentModelContext without a session id resolves the global default context', () => {
    mockProviderManager.getCurrentModelContext.mockReturnValue(100000)
    const session = manager.createSession(projectId, 'Test Session')
    manager.setSessionProvider(session.id, 'test-provider', 'session-model-262k')

    expect(manager.getCurrentModelContext()).toBe(100000)
  })

  it('getContextState uses the session model context window when the session has a providerModel', () => {
    mockProviderManager.getProviders.mockReturnValue([
      { id: 'test-provider', models: [{ id: 'session-model-262k', contextWindow: 262144 }] },
    ])
    mockProviderManager.getCurrentModelContext.mockReturnValue(100000)
    const session = manager.createSession(projectId, 'Test Session')
    manager.setSessionProvider(session.id, 'test-provider', 'session-model-262k')

    const contextState = manager.getContextState(session.id)
    expect(contextState.maxTokens).toBe(262144)
  })

  it('builds sessions with the session model context window, even when restored from the DB', () => {
    mockProviderManager.getProviders.mockReturnValue([
      { id: 'test-provider', models: [{ id: 'session-model-262k', contextWindow: 262144 }] },
    ])
    mockProviderManager.getCurrentModelContext.mockReturnValue(100000)

    const spy = vi.spyOn(eventModule, 'getSessionState')

    const session = manager.createSession(projectId, 'Test Session', 'test-provider', 'session-model-262k')

    // The context-state fold during session building (buildSessionFromDb) must
    // be sized with the session model's window (262K), not the global default (100K).
    const maxTokensArgs = spy.mock.calls.filter((c) => c[0] === session.id).map((c) => c[1])
    expect(maxTokensArgs).toContain(262144)
  })

  describe('queue operations', () => {
    it('queues messages and returns queueState', () => {
      const session = manager.createSession(projectId)

      manager.queueMessage(session.id, 'asap', 'hello', undefined, 'command')
      const queueState = manager.getQueueState(session.id)

      expect(queueState).toHaveLength(1)
      expect(queueState[0]!.content).toBe('hello')
      expect(queueState[0]!.messageKind).toBe('command')
    })

    it('emits queue_added event when queuing', () => {
      const session = manager.createSession(projectId)
      const events: any[] = []
      manager.subscribe((e) => events.push(e))

      manager.queueMessage(session.id, 'asap', 'hello')

      expect(events.some((e) => e.type === 'queue_added')).toBe(true)
    })

    it('emits queue_cancelled event when cancelling', () => {
      const session = manager.createSession(projectId)
      const { queueId } = manager.queueMessage(session.id, 'asap', 'hello')
      const events: any[] = []
      manager.subscribe((e) => events.push(e))

      manager.cancelQueuedMessage(session.id, queueId)

      expect(events.some((e) => e.type === 'queue_cancelled')).toBe(true)
    })

    it('clears message queue when session is deleted to prevent memory leak', () => {
      const session = manager.createSession(projectId)
      manager.queueMessage(session.id, 'asap', 'hello')

      expect(manager.hasQueuedMessages(session.id)).toBe(true)

      manager.deleteSession(session.id)

      expect(manager.hasQueuedMessages(session.id)).toBe(false)
    })
  })

  describe('warmup tracking', () => {
    it('starts not warmed up', () => {
      const session = manager.createSession(projectId)
      expect(manager.isWarmedUp(session.id)).toBe(false)
    })

    it('returns true after marking warmed up', () => {
      const session = manager.createSession(projectId)
      manager.markWarmedUp(session.id)
      expect(manager.isWarmedUp(session.id)).toBe(true)
    })

    it('returns false after reset', () => {
      const session = manager.createSession(projectId)
      manager.markWarmedUp(session.id)
      manager.resetWarmup(session.id)
      expect(manager.isWarmedUp(session.id)).toBe(false)
    })

    it('resets warmup when setCachedPrompt is called', () => {
      const session = manager.createSession(projectId)
      manager.markWarmedUp(session.id)
      manager.setCachedPrompt(session.id, 'new prompt', [], 'new-hash')
      expect(manager.isWarmedUp(session.id)).toBe(false)
    })

    it('tracks warmup per session independently', () => {
      const s1 = manager.createSession(projectId)
      const s2 = manager.createSession(projectId)
      manager.markWarmedUp(s1.id)
      expect(manager.isWarmedUp(s1.id)).toBe(true)
      expect(manager.isWarmedUp(s2.id)).toBe(false)
    })
  })

  describe('branch persistence', () => {
    it('persists branch after update and reads it back', async () => {
      const session = manager.createSession(projectId)
      const { updateSessionBranch, getSession } = await import('../db/sessions.js')

      updateSessionBranch(session.id, 'feature-x')
      const reloaded = getSession(session.id)
      expect(reloaded?.branch).toBe('feature-x')
    })

    it('preserves branch after session reload from DB', async () => {
      const session = manager.createSession(projectId)
      const { updateSessionBranch } = await import('../db/sessions.js')
      updateSessionBranch(session.id, 'develop')

      const reloaded = manager.getSession(session.id)
      expect(reloaded?.branch).toBe('develop')
    })

    it('syncs branch to other sessions sharing the same workspace path', async () => {
      const s1 = manager.createSession(projectId)
      const s2 = manager.createSession(projectId)
      const { updateSessionWorkdir, updateSessionBranch, getSession } = await import('../db/sessions.js')
      const sharedWs = '/workspaces/test/shared-ws'

      // Both sessions reference the same workspace
      updateSessionWorkdir(s1.id, '/tmp/project', sharedWs)
      updateSessionWorkdir(s2.id, '/tmp/project', sharedWs)

      // Simulate branch sync after a workspace switch changes the branch
      updateSessionBranch(s1.id, 'feature-x')
      const otherSessions = manager.listSessions().filter((s) => s.id !== s1.id && s.workspace === sharedWs)
      for (const other of otherSessions) {
        updateSessionBranch(other.id, 'feature-x')
      }

      expect(getSession(s1.id)?.branch).toBe('feature-x')
      expect(getSession(s2.id)?.branch).toBe('feature-x')
    })
  })

  describe('forkSession', () => {
    it('forks a new session with all messages up to the target message', () => {
      const original = manager.createSession(projectId)

      // Add some messages
      manager.addMessage(original.id, { role: 'user', content: 'First message', tokenCount: 10 })
      const msg2 = manager.addMessage(original.id, { role: 'user', content: 'Second message', tokenCount: 10 })
      manager.addMessage(original.id, { role: 'user', content: 'Third message', tokenCount: 10 })

      const originalReloaded = manager.requireSession(original.id)
      expect(originalReloaded.messages).toHaveLength(3)

      // Fork from the second message
      const forked = manager.forkSession(original.id, msg2.id)

      // New session should have 2 messages (up to and including the second)
      expect(forked.id).not.toBe(original.id)
      expect(forked.messages).toHaveLength(2)
      expect(forked.messages[0]?.content).toBe('First message')
      expect(forked.messages[1]?.content).toBe('Second message')
    })

    it('copies cached system prompt to the forked session', async () => {
      const { updateSessionCachedPrompt, getSessionCachedPrompt } = await import('../db/sessions.js')
      const original = manager.createSession(projectId)

      // Set a cached prompt on the original session
      updateSessionCachedPrompt(
        original.id,
        'system prompt',
        [{ type: 'function', function: { name: 'test', description: '', parameters: {} } }],
        'hash123',
        'promptHash123',
      )

      const msg = manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })

      const forked = manager.forkSession(original.id, msg.id)

      const cached = getSessionCachedPrompt(forked.id)
      expect(cached).not.toBeNull()
      expect(cached?.systemPrompt).toBe('system prompt')
      expect(cached?.hash).toBe('hash123')
      expect(cached?.promptHash).toBe('promptHash123')
    })

    it('marks forked session as warmed up', async () => {
      const { updateSessionCachedPrompt } = await import('../db/sessions.js')
      const original = manager.createSession(projectId)
      updateSessionCachedPrompt(original.id, 'sp', [], 'h')

      const msg = manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })
      const forked = manager.forkSession(original.id, msg.id)

      expect(manager.isWarmedUp(forked.id)).toBe(true)
    })

    it('forks from an assistant message', () => {
      const original = manager.createSession(projectId)

      manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })

      // Simulate an assistant message by using addMessage with a different role
      const assistantMsg = manager.addMessage(original.id, { role: 'assistant', content: 'Hi there!', tokenCount: 50 })

      // Fork from the assistant message
      const forked = manager.forkSession(original.id, assistantMsg.id)

      expect(forked.messages).toHaveLength(2)
      expect(forked.messages[0]?.content).toBe('Hello')
      expect(forked.messages[1]?.content).toBe('Hi there!')
    })

    it('preserves disabled MCP servers from original session on fork', async () => {
      const { setSessionDisabledServers, getSessionDisabledServers } = await import('../mcp/session-overrides.js')
      const original = manager.createSession(projectId)
      setSessionDisabledServers(original.id, ['server-a', 'server-b'])

      const msg = manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })
      const forked = manager.forkSession(original.id, msg.id)

      expect(getSessionDisabledServers(forked.id)).toEqual(['server-a', 'server-b'])
    })

    it('throws error for non-existent messageId', () => {
      const original = manager.createSession(projectId)

      expect(() => manager.forkSession(original.id, 'non-existent-id')).toThrow('not found')
    })

    it('preserves session metadata from the original', async () => {
      const { updateSessionCachedPrompt } = await import('../db/sessions.js')
      const original = manager.createSession(projectId, 'My Original Session', 'provider1', 'model1')

      updateSessionCachedPrompt(original.id, 'sp', [], 'h')

      const msg = manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })
      const forked = manager.forkSession(original.id, msg.id)

      expect(forked.metadata?.title).toBe('Fork of My Original Session')
      expect(forked.providerId).toBe('provider1')
      expect(forked.providerModel).toBe('model1')
    })

    it('creates a snapshot in the forked session', () => {
      const original = manager.createSession(projectId)

      manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })
      const msg2 = manager.addMessage(original.id, { role: 'user', content: 'World', tokenCount: 10 })

      const forked = manager.forkSession(original.id, msg2.id)

      const eventStore = getEventStore()
      const forkedEvents = eventStore.getEvents(forked.id)

      const snapshots = forkedEvents.filter((e) => e.type === 'turn.snapshot')
      expect(snapshots).toHaveLength(1)
      const snapshotMessages = (snapshots[0]!.data as { messages: unknown[] }).messages
      expect(snapshotMessages).toHaveLength(2)
    })

    it('works without a cached prompt on the original session', () => {
      const original = manager.createSession(projectId)
      const msg = manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })

      const forked = manager.forkSession(original.id, msg.id)

      expect(forked.messages).toHaveLength(1)
      expect(manager.isWarmedUp(forked.id)).toBe(false)
    })

    it('sets new contextWindowId on forked messages so LLM context building works', () => {
      const original = manager.createSession(projectId)
      manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })
      const msg2 = manager.addMessage(original.id, { role: 'user', content: 'World', tokenCount: 10 })

      const forked = manager.forkSession(original.id, msg2.id)

      const eventStore = getEventStore()
      const forkedEvents = eventStore.getEvents(forked.id)
      const snapshotEvent = forkedEvents.find((e) => e.type === 'turn.snapshot')
      const snapshot = snapshotEvent!.data as {
        currentContextWindowId: string
        messages: Array<{ contextWindowId?: string }>
      }

      // All messages in the snapshot must have the new contextWindowId
      for (const m of snapshot.messages) {
        expect(m.contextWindowId).toBe(snapshot.currentContextWindowId)
      }
    })
  })

  describe('createClientForAgent', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('returns global client when no override set', () => {
      const session = manager.createSession(projectId, 'Test Session')
      const client = manager.createClientForAgent(session.id, 'planner')
      expect(client).toBe(mockGlobalClient)
      expect(mockProviderManager.createClient).not.toHaveBeenCalled()
    })

    it('creates dedicated client when override exists', () => {
      const session = manager.createSession(projectId, 'Test Session')
      setAgentModelOverride('planner', { providerId: 'test-provider', model: 'dedicated-model' })
      const client = manager.createClientForAgent(session.id, 'planner')
      expect(client).toBe(mockDedicatedClient)
      expect(mockProviderManager.createClient).toHaveBeenCalledWith('test-provider', 'dedicated-model', undefined)
    })

    it('falls back to global client when provider not found', () => {
      const session = manager.createSession(projectId, 'Test Session')
      mockProviderManager.createClient.mockReturnValueOnce(undefined)
      setAgentModelOverride('planner', { providerId: 'nonexistent', model: 'dedicated-model' })
      const client = manager.createClientForAgent(session.id, 'planner')
      expect(client).toBe(mockGlobalClient)
    })

    it('falls back to global client when override cleared', () => {
      const session = manager.createSession(projectId, 'Test Session')
      setAgentModelOverride('planner', { providerId: 'test-provider', model: 'dedicated-model' })
      setAgentModelOverride('planner', null)
      const client = manager.createClientForAgent(session.id, 'planner')
      expect(client).toBe(mockGlobalClient)
      expect(mockProviderManager.createClient).not.toHaveBeenCalled()
    })

    it('creates client with correct provider and model', () => {
      const session = manager.createSession(projectId, 'Test Session')
      setAgentModelOverride('verifier', { providerId: 'my-provider', model: 'my-model' })
      manager.createClientForAgent(session.id, 'verifier')
      expect(mockProviderManager.createClient).toHaveBeenCalledWith('my-provider', 'my-model', undefined)
    })

    it('passes the override reasoningEffort through to createClient', () => {
      const session = manager.createSession(projectId, 'Test Session')
      setAgentModelOverride('verifier', { providerId: 'my-provider', model: 'my-model', reasoningEffort: 'high' })
      manager.createClientForAgent(session.id, 'verifier')
      expect(mockProviderManager.createClient).toHaveBeenCalledWith('my-provider', 'my-model', 'high')
    })

    it('a session-pinned effort wins over the override reasoningEffort', () => {
      const session = manager.createSession(projectId, 'Test Session')
      manager.setSessionPinnedEffort(session.id, 'max')
      setAgentModelOverride('verifier', { providerId: 'my-provider', model: 'my-model', reasoningEffort: 'low' })
      manager.createClientForAgent(session.id, 'verifier')
      expect(mockProviderManager.createClient).toHaveBeenCalledWith('my-provider', 'my-model', 'max')
    })
  })

  describe('effective model resolution (override > session > default)', () => {
    const providers = [
      {
        id: 'override-provider',
        models: [{ id: 'override-model', contextWindow: 400000, compactionThreshold: 0.9 }],
      },
      {
        id: 'session-provider',
        models: [{ id: 'session-model', contextWindow: 262144, compactionThreshold: 0.8 }],
      },
      {
        id: 'default-provider',
        models: [{ id: 'default-model', contextWindow: 100000, compactionThreshold: 0.7 }],
      },
    ]

    beforeEach(() => {
      vi.clearAllMocks()
      mockProviderManager.getProviders.mockReturnValue(providers as any)
      mockProviderManager.getDefaultModelSelection.mockReturnValue('default-provider/default-model')
    })

    it('resolveEffectiveProviderModel returns agent override above session preference', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')

      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'override-provider',
        model: 'override-model',
      })
    })

    it('a manual pick suppresses the agent override for the session', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true)
      manager.setSessionProviderActive(session.id, true)

      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'session-provider',
        model: 'session-model',
      })
      expect(manager.getCurrentModelSettings(session.id, 'planner')?.maxTokens).toBe(262000)
    })

    it('an inactive manual pick yields to the agent override', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true)
      manager.setSessionProviderActive(session.id, false)

      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'override-provider',
        model: 'override-model',
      })
    })

    it('getCurrentModelSettings requests non-thinking mode when the effective effort is none', () => {
      ;(mockProviderManager.resolveModelEffort as ReturnType<typeof vi.fn>).mockReturnValue('none')
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'none')
      manager.setSessionProviderActive(session.id, true)

      manager.getCurrentModelSettings(session.id)

      expect(mockProviderManager.getModelSettings).toHaveBeenCalledWith(
        'session-provider',
        'session-model',
        'non-thinking',
      )
    })

    it('getCurrentModelSettings requests thinking mode when the effective effort is a thinking level', () => {
      ;(mockProviderManager.resolveModelEffort as ReturnType<typeof vi.fn>).mockReturnValue('high')
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'high')
      manager.setSessionProviderActive(session.id, true)

      manager.getCurrentModelSettings(session.id)

      expect(mockProviderManager.getModelSettings).toHaveBeenCalledWith('session-provider', 'session-model', 'thinking')
    })

    it('getCurrentModelSettings defaults to thinking mode when no effort is resolved', () => {
      ;(mockProviderManager.resolveModelEffort as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true)
      manager.setSessionProviderActive(session.id, true)

      manager.getCurrentModelSettings(session.id)

      expect(mockProviderManager.getModelSettings).toHaveBeenCalledWith('session-provider', 'session-model', 'thinking')
    })

    it('setMode deactivates the manual pick on override agents and reactivates it otherwise', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true)
      manager.setSessionProviderActive(session.id, true)

      // Land on a non-override agent first (fresh sessions may default to the override agent)
      manager.setMode(session.id, 'builder')

      // Switch to the override agent → the label wins: manual pick deactivated.
      manager.setMode(session.id, 'planner')
      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'override-provider',
        model: 'override-model',
      })

      // Switch to a non-override agent → manual pick reactivated.
      manager.setMode(session.id, 'builder')
      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'session-provider',
        model: 'session-model',
      })
    })

    it('an inherited (non-manual) preference does not suppress the agent override', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')

      // Created sessions inherit a default provider with providerManual=false,
      // so the agent override still wins.
      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'override-provider',
        model: 'override-model',
      })
    })

    it('resolveEffectiveProviderModel falls back to session preference when agent has no override', () => {
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')

      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'session-provider',
        model: 'session-model',
      })
    })

    it('resolveEffectiveProviderModel resolves the session mode agent override when no agentId given', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setMode(session.id, 'planner')

      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'override-provider',
        model: 'override-model',
      })
    })

    it('resolveEffectiveProviderModel falls back to the config default, ignoring stale provider active state', () => {
      // ProviderManager reports a stale override as active — must be ignored.
      mockProviderManager.getActiveProviderId.mockReturnValue('stale-provider')
      mockProviderManager.getCurrentModel.mockReturnValue('stale-model')
      const session = manager.createSession(projectId, 'Test Session')

      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'default-provider',
        model: 'default-model',
      })
    })

    it('resolveEffectiveProviderModel returns the session effort for a manual pick', () => {
      const session = manager.createSession(projectId, 'Test Session')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'high')

      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'session-provider',
        model: 'session-model',
        reasoningEffort: 'high',
      })
    })

    it('resolveEffectiveProviderModel returns the agent override effort above a session preference', () => {
      setAgentModelOverride('planner', {
        providerId: 'override-provider',
        model: 'override-model',
        reasoningEffort: 'xhigh',
      })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'medium')
      manager.setSessionProviderActive(session.id, true)

      // Manual pick wins over the override (both effort and model come from the pick).
      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'session-provider',
        model: 'session-model',
        reasoningEffort: 'medium',
      })
    })

    it('resolveEffectiveProviderModel returns the agent override effort when the manual pick is inactive', () => {
      setAgentModelOverride('planner', {
        providerId: 'override-provider',
        model: 'override-model',
        reasoningEffort: 'max',
      })
      const session = manager.createSession(projectId, 'Test Session')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'low')
      manager.setSessionProviderActive(session.id, false)

      expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
        providerId: 'override-provider',
        model: 'override-model',
        reasoningEffort: 'max',
      })
    })

    it('resolveEffectiveProviderModel omits effort when no session or override effort is set', () => {
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true)

      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'session-provider',
        model: 'session-model',
      })
    })

    it('resetting the session provider clears the stored effort', () => {
      const session = manager.createSession(projectId, 'Test Session')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'high')
      manager.setSessionProvider(session.id, null, null, false, null)

      expect(manager.getSession(session.id)?.providerReasoningEffort ?? null).toBeNull()
      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'default-provider',
        model: 'default-model',
      })
    })

    it('picking a model without an effort clears a previously stored effort', () => {
      const session = manager.createSession(projectId, 'Test Session')
      manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'high')
      // A fresh model pick (no effort) resets to the model default.
      manager.setSessionProvider(session.id, 'session-provider', 'other-model', true, null)

      expect(manager.getSession(session.id)?.providerReasoningEffort ?? null).toBeNull()
      expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
        providerId: 'session-provider',
        model: 'other-model',
      })
    })

    it('getCurrentModelSettings returns the override model settings for an override agent', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session')

      expect(manager.getCurrentModelSettings(session.id, 'planner')?.maxTokens).toBe(32000)
    })

    it('getCurrentModelSettings returns session settings when agent has no override', () => {
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')

      expect(manager.getCurrentModelSettings(session.id, 'planner')?.maxTokens).toBe(262000)
    })

    it('getCurrentModelSettings resolves the config default for a no-preference session, not the stale provider', () => {
      mockProviderManager.getActiveProviderId.mockReturnValue('stale-provider')
      mockProviderManager.getCurrentModel.mockReturnValue('stale-model')
      const session = manager.createSession(projectId, 'Test Session')

      expect(manager.getCurrentModelSettings(session.id)?.maxTokens).toBe(100000)
    })

    it('getCurrentModelContext uses the override model window for an override agent', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session')

      expect(manager.getCurrentModelContext(session.id, 'planner')).toBe(400000)
    })

    it('getModelCompactionThreshold uses the override model threshold for an override agent', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session')

      expect(manager.getModelCompactionThreshold(session.id, 'planner')).toBe(0.9)
    })

    it('sub-agent without override under an override top-level agent uses the session window', () => {
      setAgentModelOverride('planner', { providerId: 'override-provider', model: 'override-model' })
      const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')

      // 'verifier' has no override → session preference applies, not the top-level override.
      expect(manager.getCurrentModelContext(session.id, 'verifier')).toBe(262144)
    })

    describe('pinned reasoning effort', () => {
      it('pinned effort overrides the agent override effort without replacing the model', () => {
        setAgentModelOverride('planner', {
          providerId: 'override-provider',
          model: 'override-model',
          reasoningEffort: 'max',
        })
        const session = manager.createSession(projectId, 'Test Session')
        manager.setSessionPinnedEffort(session.id, 'high')

        expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
          providerId: 'override-provider',
          model: 'override-model',
          reasoningEffort: 'high',
        })
      })

      it('pinned effort overrides a session-stored effort', () => {
        const session = manager.createSession(projectId, 'Test Session', 'session-provider', 'session-model')
        manager.setSessionProvider(session.id, 'session-provider', 'session-model', false, 'low')
        manager.setSessionPinnedEffort(session.id, 'high')

        expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
          providerId: 'session-provider',
          model: 'session-model',
          reasoningEffort: 'high',
        })
      })

      it('pinned effort applies even without any override or session pick', () => {
        const session = manager.createSession(projectId, 'Test Session')
        manager.setSessionPinnedEffort(session.id, 'low')

        expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
          providerId: 'default-provider',
          model: 'default-model',
          reasoningEffort: 'low',
        })
      })

      it('an active pin wins over an active manual pick', () => {
        const session = manager.createSession(projectId, 'Test Session')
        manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'none')
        manager.setSessionProviderActive(session.id, true)
        // "Keep current reasoning effort" pinned after the manual pick — the pin
        // is the most recent explicit intent and must win over the manual effort.
        manager.setSessionPinnedEffort(session.id, 'high')

        expect(manager.resolveEffectiveProviderModel(session.id)).toEqual({
          providerId: 'session-provider',
          model: 'session-model',
          reasoningEffort: 'high',
        })
      })

      it('a manual pick clears the pinned effort', () => {
        const session = manager.createSession(projectId, 'Test Session')
        manager.setSessionPinnedEffort(session.id, 'high')
        manager.setSessionProvider(session.id, 'session-provider', 'session-model', true, 'none')

        expect(manager.getSession(session.id)?.providerPinnedEffort ?? null).toBeNull()
      })

      it('resetting the provider clears the pinned effort', () => {
        const session = manager.createSession(projectId, 'Test Session')
        manager.setSessionPinnedEffort(session.id, 'high')
        manager.setSessionProvider(session.id, null, null, false, null)

        expect(manager.getSession(session.id)?.providerPinnedEffort ?? null).toBeNull()
      })

      it('clearing the pin restores the override effort', () => {
        setAgentModelOverride('planner', {
          providerId: 'override-provider',
          model: 'override-model',
          reasoningEffort: 'max',
        })
        const session = manager.createSession(projectId, 'Test Session')
        manager.setSessionPinnedEffort(session.id, 'high')
        manager.setSessionPinnedEffort(session.id, null)

        expect(manager.resolveEffectiveProviderModel(session.id, 'planner')).toEqual({
          providerId: 'override-provider',
          model: 'override-model',
          reasoningEffort: 'max',
        })
      })
    })
  })
})
