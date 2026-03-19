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
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
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
    expect(builderSession.executionState).toMatchObject({
      iteration: 1,
      consecutiveFailures: 0,
      currentTokenCount: 0,
      compactionCount: 0,
    })

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

  it('adds messages, updates them, and manages context windows during compaction', () => {
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

    manager.updateMessage(session.id, first.id, { content: 'hello world', partial: true })
    manager.updateMessageStats(session.id, first.id, {
      model: 'qwen',
      mode: 'planner',
      totalTime: 1,
      toolTime: 0,
      prefillTokens: 1,
      prefillSpeed: 1,
      generationTokens: 1,
      generationSpeed: 1,
    })

    const updated = manager.requireSession(session.id).messages[0]
    expect(updated).toMatchObject({
      content: 'hello world',
      partial: true,
      stats: { model: 'qwen' },
    })

    manager.compactContext(session.id, 'summary text', 50)
    expect(manager.getCurrentWindowMessages(session.id)).toEqual([])
    expect(manager.requireSession(session.id).executionState).toMatchObject({
      currentTokenCount: 0,
      messageCountAtLastUpdate: 0,
      compactionCount: 1,
    })

    const second = manager.addMessage(session.id, {
      role: 'assistant',
      content: 'fresh window',
      tokenCount: 2,
    })
    expect(second.contextWindowId).toBeDefined()
    expect(second.contextWindowId).not.toBe(first.contextWindowId)

    const compacted = manager.compactMessages(session.id, [first.id, second.id], 'rolled up')
    expect(compacted).toMatchObject({
      role: 'system',
      isCompacted: true,
      originalMessageIds: [first.id, second.id],
    })
    expect(eventTypes).toContain('message_added')
    expect(eventTypes).toContain('message_updated')
    expect(eventTypes).toContain('session_updated')
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

  it('tracks execution state, read files, failures, tokens, tool calls, and context state', () => {
    const session = manager.createSession(projectId)

    manager.updateExecutionState(session.id, { iteration: 2 })
    expect(manager.requireSession(session.id).executionState).toMatchObject({
      iteration: 2,
      modifiedFiles: [],
      readFiles: {},
      consecutiveFailures: 0,
    })

    manager.addModifiedFile(session.id, 'src/index.ts')
    manager.addModifiedFile(session.id, 'src/index.ts')
    manager.recordFileRead(session.id, 'src/index.ts', 'hash-1')
    expect(manager.getReadFiles(session.id)).toEqual({
      'src/index.ts': expect.objectContaining({ hash: 'hash-1', readAt: expect.any(String) }),
    })

    manager.updateFileHash(session.id, 'src/index.ts', 'hash-2')
    manager.updateFileHash(session.id, 'src/other.ts', 'hash-3')
    expect(manager.getReadFiles(session.id)['src/index.ts']?.hash).toBe('hash-2')
    expect(manager.getReadFiles(session.id)['src/other.ts']).toBeUndefined()

    manager.recordToolFailure(session.id, 'edit_file', 'patch failed')
    expect(manager.requireSession(session.id).executionState).toMatchObject({
      consecutiveFailures: 1,
      lastFailedTool: 'edit_file',
      lastFailureReason: 'patch failed',
    })

    manager.resetToolFailures(session.id)
    const resetState = manager.requireSession(session.id).executionState
    expect(resetState).toMatchObject({
      consecutiveFailures: 0,
    })
    expect(resetState && 'lastFailedTool' in resetState).toBe(false)
    expect(resetState && 'lastFailureReason' in resetState).toBe(false)

    const firstMessage = manager.addMessage(session.id, {
      role: 'user',
      content: 'hello world',
      tokenCount: 3,
    })
    manager.setCurrentContextSize(session.id, 50)
    manager.addTokensUsed(session.id, 25)
    manager.incrementTokenCount(session.id, 10)
    manager.incrementToolCalls(session.id)

    const afterFreshCount = manager.getContextState(session.id)
    expect(afterFreshCount).toMatchObject({
      currentTokens: 60,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
    })

    manager.addMessage(session.id, {
      role: 'assistant',
      content: 'some extra content to force estimation delta',
      tokenCount: 8,
    })

    const afterNewMessage = manager.getContextState(session.id)
    expect(afterNewMessage.currentTokens).toBeGreaterThan(60)
    expect(manager.requireSession(session.id).metadata).toMatchObject({
      totalTokensUsed: 35,
      totalToolCalls: 1,
    })
    expect(firstMessage.id).toBeTruthy()
  })
})
