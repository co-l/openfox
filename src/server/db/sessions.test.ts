import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import { createProject } from './projects.js'
import {
  addCriterion,
  addMessage,
  clearExecutionState,
  closeContextWindow,
  createContextWindow,
  createSession,
  deleteMessages,
  deleteSession,
  getContextWindows,
  getCriteria,
  getCurrentContextWindow,
  getExecutionState,
  getMessages,
  getMessagesForWindow,
  getSession,
  listSessions,
  listSessionsByProject,
  removeCriterion,
  setCriteria,
  setExecutionState,
  updateCriterion,
  updateCriterionFull,
  updateMessage,
  updateMessageStats,
  updateSessionMetadata,
  updateSessionMode,
  updateSessionPhase,
  updateSessionRunning,
  updateSessionSummary,
} from './sessions.js'

describe('db sessions', () => {
  let rootA: string
  let rootB: string
  let projectAId: string
  let projectBId: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    rootA = await mkdtemp(join(tmpdir(), 'openfox-session-a-'))
    rootB = await mkdtemp(join(tmpdir(), 'openfox-session-b-'))
    await mkdir(join(rootA, 'nested'), { recursive: true })

    projectAId = createProject('Project A', rootA).id
    projectBId = createProject('Project B', rootB).id
  })

  afterEach(async () => {
    closeDatabase()
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
  })

  it('creates, updates, lists, filters, and deletes sessions', () => {
    const sessionA = createSession(projectAId, rootA, 'Session A')
    const sessionB = createSession(projectBId, join(rootA, 'nested'))

    expect(sessionA.metadata.title).toBe('Session A')
    expect(sessionA.contextWindows).toHaveLength(1)
    expect(sessionA.phase).toBe('plan')
    expect(getSession(sessionA.id)).toMatchObject({
      id: sessionA.id,
      projectId: projectAId,
      workdir: rootA,
      phase: 'plan',
      mode: 'planner',
      isRunning: false,
      metadata: { title: 'Session A', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    })

    updateSessionMode(sessionA.id, 'builder')
    updateSessionPhase(sessionA.id, 'verification')
    updateSessionRunning(sessionA.id, true)
    updateSessionSummary(sessionA.id, 'Summary text')
    updateSessionMetadata(sessionA.id, {
      title: 'Session A Updated',
      totalTokensUsed: 42,
      totalToolCalls: 3,
      iterationCount: 2,
    })

    expect(getSession(sessionA.id)).toMatchObject({
      mode: 'builder',
      phase: 'verification',
      isRunning: true,
      summary: 'Summary text',
      metadata: {
        title: 'Session A Updated',
        totalTokensUsed: 42,
        totalToolCalls: 3,
        iterationCount: 2,
      },
    })

    const listed = listSessions()
    expect(listed).toHaveLength(2)
    expect(listed.find((session) => session.id === sessionA.id)).toMatchObject({
      title: 'Session A Updated',
      mode: 'builder',
      phase: 'verification',
      isRunning: true,
      criteriaCount: 0,
      criteriaCompleted: 0,
    })

    const filtered = listSessionsByProject(projectAId, rootA)
    expect(filtered.map((session) => session.id)).toContain(sessionA.id)
    expect(filtered.map((session) => session.id)).toContain(sessionB.id)

    deleteSession(sessionA.id)
    expect(getSession(sessionA.id)).toBeNull()
  })

  it('stores, updates, filters, and deletes messages across context windows', () => {
    const session = createSession(projectAId, rootA, 'Messages')
    const firstWindow = getCurrentContextWindow(session.id)
    expect(firstWindow).not.toBeNull()

    const message = addMessage(session.id, {
      role: 'assistant',
      content: 'Initial content',
      contextWindowId: firstWindow!.id,
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
      thinkingContent: 'Need to inspect',
      toolCallId: 'call-1',
      toolName: 'read_file',
      toolResult: { success: true, output: 'File text', durationMs: 12, truncated: false },
      tokenCount: 9,
      isCompacted: true,
      originalMessageIds: ['m-old-1', 'm-old-2'],
      segments: [{ type: 'text', content: 'Initial content' }],
      partial: true,
      isSystemGenerated: true,
      isStreaming: true,
      messageKind: 'correction',
      subAgentId: 'sub-1',
      subAgentType: 'verifier',
      isCompactionSummary: true,
      promptContext: {
        systemPrompt: 'System prompt',
        userMessage: 'User prompt',
        injectedFiles: [{ path: 'AGENTS.md', content: 'Do tests', source: 'agents-md' }],
      },
    })

    updateMessageStats(session.id, message.id, {
      model: 'qwen3-32b',
      mode: 'builder',
      totalTime: 1,
      toolTime: 0.2,
      prefillTokens: 10,
      prefillSpeed: 20,
      generationTokens: 5,
      generationSpeed: 10,
    })
    updateMessage(session.id, message.id, {
      content: 'Updated content',
      thinkingContent: 'Updated thinking',
      toolCalls: [{ id: 'call-2', name: 'glob', arguments: { pattern: '*.ts' } }],
      tokenCount: 10,
      segments: [{ type: 'text', content: 'Updated content' }],
      stats: {
        model: 'qwen3-32b',
        mode: 'builder',
        totalTime: 2,
        toolTime: 0.2,
        prefillTokens: 20,
        prefillSpeed: 30,
        generationTokens: 6,
        generationSpeed: 12,
      },
      isStreaming: false,
      partial: false,
      promptContext: {
        systemPrompt: 'Updated system',
        userMessage: 'Updated user',
        injectedFiles: [],
      },
    })
    updateMessage(session.id, message.id, {})

    const secondWindow = createContextWindow(session.id, 2, 'Summary of previous', 15)
    const secondMessage = addMessage(session.id, {
      role: 'user',
      content: 'Second window message',
      contextWindowId: secondWindow.id,
      tokenCount: 4,
    })

    const messages = getMessages(session.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      id: message.id,
      content: 'Updated content',
      thinkingContent: 'Updated thinking',
      toolCalls: [{ id: 'call-2', name: 'glob', arguments: { pattern: '*.ts' } }],
      partial: false,
      isSystemGenerated: true,
      isCompactionSummary: true,
      subAgentId: 'sub-1',
      subAgentType: 'verifier',
    })
    expect(messages[1]).toMatchObject({ id: secondMessage.id, content: 'Second window message' })

    expect(getMessagesForWindow(session.id, firstWindow!.id)).toHaveLength(1)
    expect(getMessagesForWindow(session.id, secondWindow.id)).toHaveLength(1)

    closeContextWindow(firstWindow!.id, 99)
    expect(getContextWindows(session.id)).toEqual([
      expect.objectContaining({ id: firstWindow!.id, closedAt: expect.any(String), tokenCountAtClose: 99 }),
      expect.objectContaining({ id: secondWindow.id, summaryOfPrevious: 'Summary of previous', summaryTokenCount: 15 }),
    ])
    expect(getCurrentContextWindow(session.id)).toMatchObject({ id: secondWindow.id })

    deleteMessages(session.id, [secondMessage.id])
    expect(getMessages(session.id).map((entry) => entry.id)).toEqual([message.id])
  })

  it('stores criteria, handles duplicate ids, and manages execution state', () => {
    const session = createSession(projectAId, rootA)

    setCriteria(session.id, [
      {
        id: 'tests-pass',
        description: 'Tests pass',
        status: { type: 'pending' },
        attempts: [],
      },
      {
        id: 'docs-updated',
        description: 'Docs updated',
        status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' },
        attempts: [{ attemptNumber: 1, status: 'passed', timestamp: '2024-01-01T00:00:00.000Z' }],
      },
    ])
    expect(getCriteria(session.id)).toEqual([
      expect.objectContaining({ id: 'tests-pass', description: 'Tests pass' }),
      expect.objectContaining({ id: 'docs-updated', status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' } }),
    ])

    updateCriterion(session.id, 'tests-pass', {
      status: { type: 'failed', failedAt: '2024-01-01T00:00:00.000Z', reason: 'Still broken' },
      attempts: [{ attemptNumber: 1, status: 'failed', timestamp: '2024-01-01T00:00:00.000Z', details: 'Still broken' }],
    })
    updateCriterion(session.id, 'tests-pass', {})
    updateCriterionFull(session.id, 'tests-pass', { description: 'Tests pass on CI' })
    updateCriterionFull(session.id, 'tests-pass', {})

    const firstDuplicate = addCriterion(session.id, {
      id: 'tests-pass',
      description: 'Duplicate criterion',
      status: { type: 'pending' },
      attempts: [],
    })
    const secondDuplicate = addCriterion(session.id, {
      id: 'tests-pass',
      description: 'Another duplicate criterion',
      status: { type: 'pending' },
      attempts: [],
    })

    expect(firstDuplicate).toEqual({ success: true, actualId: 'tests-pass-1' })
    expect(secondDuplicate).toEqual({ success: true, actualId: 'tests-pass-2' })
    expect(getCriteria(session.id).map((criterion) => criterion.id)).toEqual([
      'tests-pass',
      'docs-updated',
      'tests-pass-1',
      'tests-pass-2',
    ])

    removeCriterion(session.id, 'tests-pass-1')
    expect(getCriteria(session.id).map((criterion) => criterion.id)).toEqual([
      'tests-pass',
      'docs-updated',
      'tests-pass-2',
    ])

    setExecutionState(session.id, {
      iteration: 2,
      modifiedFiles: ['src/index.ts'],
      readFiles: {
        'src/index.ts': { hash: 'hash-1', readAt: '2024-01-01T00:00:00.000Z' },
      },
      consecutiveFailures: 1,
      lastFailedTool: 'edit_file',
      lastFailureReason: 'Patch failed',
      currentTokenCount: 123,
      messageCountAtLastUpdate: 4,
      compactionCount: 1,
      startedAt: '2024-01-01T00:00:00.000Z',
      lastActivityAt: '2024-01-01T00:00:01.000Z',
    })
    expect(getExecutionState(session.id)).toEqual({
      iteration: 2,
      modifiedFiles: ['src/index.ts'],
      readFiles: {
        'src/index.ts': { hash: 'hash-1', readAt: '2024-01-01T00:00:00.000Z' },
      },
      consecutiveFailures: 1,
      lastFailedTool: 'edit_file',
      lastFailureReason: 'Patch failed',
      currentTokenCount: 123,
      messageCountAtLastUpdate: 4,
      compactionCount: 1,
      startedAt: '2024-01-01T00:00:00.000Z',
      lastActivityAt: '2024-01-01T00:00:01.000Z',
    })

    clearExecutionState(session.id)
    expect(getExecutionState(session.id)).toBeNull()
  })
})
