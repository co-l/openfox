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

import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { initEventStore } from '../events/index.js'
import { SessionManager } from './manager.js'

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
    manager = new SessionManager()
    getLspManagerMock.mockClear()
    shutdownLspManagerMock.mockClear()
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
    expect(manager.listSessionsByProject(projectId)).toHaveLength(2)
    expect(manager.listSessionsByProject('missing-project')).toEqual([])

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

  it('updates mode, phase, running state, and summary while emitting events', () => {
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
    expect(manager.setSummary(session.id, 'Build summary').summary).toBe('Build summary')

    expect(allEvents).toContain('mode_changed')
    expect(allEvents).toContain('phase_changed')
    expect(allEvents).toContain('running_changed')
    expect(allEvents.filter((type) => type === 'session_updated').length).toBeGreaterThanOrEqual(2)
    expect(sessionEvents).toContain('mode_changed')
    expect(sessionEvents).toContain('phase_changed')
  })

  it('adds messages and manages context windows during compaction', () => {
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

    manager.compactContext(session.id, 'summary text', 50)
    expect(manager.getCurrentWindowMessages(session.id)).toEqual([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('summary text'),
        isCompactionSummary: true,
        isSystemGenerated: true,
      }),
    ])
    // In event-sourced model, compaction info is in contextState, not executionState
    expect(manager.getContextState(session.id)).toMatchObject({
      currentTokens: 0,
      compactionCount: 1,
    })

    const second = manager.addMessage(session.id, {
      role: 'user', // User messages can be added via addMessage
      content: 'fresh window',
      tokenCount: 2,
    })
    expect(second.contextWindowId).toBeDefined()
    expect(second.contextWindowId).not.toBe(first.contextWindowId)

    const compacted = manager.compactMessages(session.id, [first.id, second.id], 'rolled up')
    // In event-sourced model, compactMessages just emits a system message
    // originalMessageIds is no longer tracked (messages are immutable events)
    expect(compacted).toMatchObject({
      role: 'system',
      isCompacted: true,
    })
    expect(eventTypes).toContain('message_added')
    // In event-sourced model, message operations don't emit session_updated
    // (messages are stored as events, not in session object)
  })

  it('manages criteria lifecycle and verification attempts', () => {
    const session = manager.createSession(projectId)

    manager.setCriteria(session.id, [
      { id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] },
    ])
    expect(manager.requireSession(session.id).criteria).toHaveLength(1)

    const addResult = manager.addCriterion(session.id, {
      id: 'tests-pass',
      description: 'Duplicate id gets rewritten',
      status: { type: 'pending' },
      attempts: [],
    })
    expect('criteria' in addResult && addResult.actualId.startsWith('tests-pass')).toBe(true)

    expect(() => manager.updateCriterionFull(session.id, 'missing', { description: 'x' })).toThrow('Criterion not found: missing')
    expect(() => manager.removeCriterion(session.id, 'missing')).toThrow('Criterion not found: missing')

    const updatedCriteria = manager.updateCriterionFull(session.id, 'tests-pass', { description: 'Tests pass in CI' })
    expect(updatedCriteria.find((criterion) => criterion.id === 'tests-pass')?.description).toBe('Tests pass in CI')

    manager.updateCriterionStatus(session.id, 'tests-pass', { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' })
    manager.addCriterionAttempt(session.id, 'tests-pass', {
      attemptNumber: 1,
      status: 'failed',
      timestamp: '2024-01-01T00:00:00.000Z',
      details: 'Needed one more fix',
    })
    expect(() => manager.addCriterionAttempt(session.id, 'missing', {
      attemptNumber: 1,
      status: 'failed',
      timestamp: '2024-01-01T00:00:00.000Z',
      details: 'nope',
    })).toThrow('Criterion not found: missing')

    manager.resetAllCriteriaAttempts(session.id)
    expect(manager.requireSession(session.id).criteria.find((criterion) => criterion.id === 'tests-pass')?.attempts).toEqual([])

    const removed = manager.removeCriterion(session.id, 'tests-pass')
    expect(removed.find((criterion) => criterion.id === 'tests-pass')).toBeUndefined()
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
    manager.compactContext(session.id, 'summary', 85000)
    // New LLM call after compaction reports smaller context
    manager.setCurrentContextSize(session.id, 5000)
    expect(manager.getContextState(session.id).currentTokens).toBe(5000)
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
    const storedMessage = storedSession.messages.find(m => m.id === message.id)
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
    const verifierMessages = allMessages.filter(m => m.subAgentId === verifierId && m.subAgentType === 'verifier')
    expect(verifierMessages).toHaveLength(3)
    expect(verifierMessages.every(m => m.subAgentId === verifierId)).toBe(true)
    expect(verifierMessages.every(m => m.subAgentType === 'verifier')).toBe(true)
  })
})
