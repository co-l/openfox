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
import { getSession } from '../db/sessions.js'
import { initEventStore, getCurrentContextWindowId, emitContextCompacted, getEventStore } from '../events/index.js'
import { SessionManager } from './manager.js'

// Mock provider manager
const mockProviderManager = {
  getCurrentModelContext: vi.fn(() => 200000),
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
      )

      const msg = manager.addMessage(original.id, { role: 'user', content: 'Hello', tokenCount: 10 })

      const forked = manager.forkSession(original.id, msg.id)

      const cached = getSessionCachedPrompt(forked.id)
      expect(cached).not.toBeNull()
      expect(cached?.systemPrompt).toBe('system prompt')
      expect(cached?.hash).toBe('hash123')
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
      const snapshot = snapshotEvent!.data as { currentContextWindowId: string; messages: Array<{ contextWindowId?: string }> }

      // All messages in the snapshot must have the new contextWindowId
      for (const m of snapshot.messages) {
        expect(m.contextWindowId).toBe(snapshot.currentContextWindowId)
      }
    })
  })
})
