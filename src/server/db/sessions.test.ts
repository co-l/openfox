/**
 * Session Database Tests
 *
 * Tests session metadata CRUD operations. Message, criteria, and context
 * data is now stored in the events table (tested in events/store.test.ts).
 */

import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import { createProject } from './projects.js'
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  listSessionsByProject,
  updateSessionMetadata,
  updateSessionMode,
  updateSessionPhase,
  updateSessionRunning,
  updateSessionSummary,
} from './sessions.js'
import { getDatabase } from './index.js'

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

  it('creates sessions with default values', () => {
    const session = createSession(projectAId, rootA, 'Test Session')

    expect(session).toMatchObject({
      projectId: projectAId,
      workdir: rootA,
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      summary: null,
      messages: [],
      criteria: [],
      contextWindows: [],
      executionState: null,
      metadata: {
        title: 'Test Session',
        totalTokensUsed: 0,
        totalToolCalls: 0,
        iterationCount: 0,
      },
    })
    expect(session.id).toBeDefined()
    expect(session.createdAt).toBeDefined()
    expect(session.updatedAt).toBeDefined()
  })

  it('gets session by id', () => {
    const session = createSession(projectAId, rootA, 'Session A')

    const retrieved = getSession(session.id)
    expect(retrieved).toMatchObject({
      id: session.id,
      projectId: projectAId,
      workdir: rootA,
      phase: 'plan',
      mode: 'planner',
      isRunning: false,
      metadata: {
        title: 'Session A',
        totalTokensUsed: 0,
        totalToolCalls: 0,
        iterationCount: 0,
      },
    })

    expect(getSession('non-existent')).toBeNull()
  })

  it('updates session mode', () => {
    const session = createSession(projectAId, rootA)

    updateSessionMode(session.id, 'builder')
    expect(getSession(session.id)?.mode).toBe('builder')

    updateSessionMode(session.id, 'planner')
    expect(getSession(session.id)?.mode).toBe('planner')
  })

  it('updates session phase', () => {
    const session = createSession(projectAId, rootA)

    updateSessionPhase(session.id, 'build')
    expect(getSession(session.id)?.phase).toBe('build')

    updateSessionPhase(session.id, 'verification')
    expect(getSession(session.id)?.phase).toBe('verification')
  })

  it('updates session running state', () => {
    const session = createSession(projectAId, rootA)

    updateSessionRunning(session.id, true)
    expect(getSession(session.id)?.isRunning).toBe(true)

    updateSessionRunning(session.id, false)
    expect(getSession(session.id)?.isRunning).toBe(false)
  })

  it('updates session summary', () => {
    const session = createSession(projectAId, rootA)

    updateSessionSummary(session.id, 'This is a summary')
    expect(getSession(session.id)?.summary).toBe('This is a summary')
  })

  it('updates session metadata', () => {
    const session = createSession(projectAId, rootA)

    updateSessionMetadata(session.id, {
      title: 'Updated Title',
      totalTokensUsed: 1000,
      totalToolCalls: 50,
      iterationCount: 5,
    })

    const retrieved = getSession(session.id)
    expect(retrieved?.metadata).toMatchObject({
      title: 'Updated Title',
      totalTokensUsed: 1000,
      totalToolCalls: 50,
      iterationCount: 5,
    })
  })

  it('lists all sessions', () => {
    createSession(projectAId, rootA, 'Session A')
    createSession(projectBId, rootB, 'Session B')

    const sessions = listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.title)).toContain('Session A')
    expect(sessions.map(s => s.title)).toContain('Session B')
  })

  it('lists sessions by project using project_id only', () => {
    const sessionA = createSession(projectAId, rootA, 'Session A')
    const sessionANested = createSession(projectAId, join(rootA, 'nested'), 'Nested Session A')
    const sessionB = createSession(projectBId, rootB, 'Session B')
    // This session belongs to projectB but has a workdir nested under projectA
    // It should NOT appear when listing sessions for projectA
    createSession(projectBId, join(rootA, 'nested'), 'Nested Session B')

    const filtered = listSessionsByProject(projectAId)
    expect(filtered.map(s => s.id)).toContain(sessionA.id)
    expect(filtered.map(s => s.id)).toContain(sessionANested.id)
    expect(filtered.map(s => s.id)).not.toContain(sessionB.id)
    expect(filtered).toHaveLength(2)
  })

  it('deletes sessions', () => {
    const session = createSession(projectAId, rootA)

    expect(getSession(session.id)).not.toBeNull()

    deleteSession(session.id)

    expect(getSession(session.id)).toBeNull()
  })

  it('handles sessions without title', () => {
    const session = createSession(projectAId, rootA)

    expect(session.metadata.title).toBeUndefined()

    const retrieved = getSession(session.id)
    expect(retrieved?.metadata.title).toBeUndefined()
  })

  it('prevents session leakage between projects with similar names', () => {
    // Simulate the bug scenario: projects with similar names (e.g., "openfox" and "openfox-agent2")
    // Create sessions in both projects
    const sessionA1 = createSession(projectAId, rootA, 'Session A1')
    const sessionA2 = createSession(projectAId, rootA, 'Session A2')
    const sessionB1 = createSession(projectBId, rootB, 'Session B1')
    const sessionB2 = createSession(projectBId, rootB, 'Session B2')

    // List sessions for project A - should only return A sessions
    const projectASessions = listSessionsByProject(projectAId)
    expect(projectASessions).toHaveLength(2)
    expect(projectASessions.map(s => s.id)).toContain(sessionA1.id)
    expect(projectASessions.map(s => s.id)).toContain(sessionA2.id)
    expect(projectASessions.map(s => s.id)).not.toContain(sessionB1.id)
    expect(projectASessions.map(s => s.id)).not.toContain(sessionB2.id)

    // List sessions for project B - should only return B sessions
    const projectBSessions = listSessionsByProject(projectBId)
    expect(projectBSessions).toHaveLength(2)
    expect(projectBSessions.map(s => s.id)).toContain(sessionB1.id)
    expect(projectBSessions.map(s => s.id)).toContain(sessionB2.id)
    expect(projectBSessions.map(s => s.id)).not.toContain(sessionA1.id)
    expect(projectBSessions.map(s => s.id)).not.toContain(sessionA2.id)

    // Verify all sessions exist in the global list
    const allSessions = listSessions()
    expect(allSessions).toHaveLength(4)
  })

  it('includes messageCount in session summaries', () => {
    const sessionA = createSession(projectAId, rootA, 'Session A')
    const sessionB = createSession(projectBId, rootB, 'Session B')

    const allSessions = listSessions()
    expect(allSessions).toHaveLength(2)
    
    const sessionASummary = allSessions.find(s => s.id === sessionA.id)
    const sessionBSummary = allSessions.find(s => s.id === sessionB.id)
    
    expect(sessionASummary).toBeDefined()
    expect(sessionASummary?.messageCount).toBe(0)
    expect(sessionBSummary).toBeDefined()
    expect(sessionBSummary?.messageCount).toBe(0)
  })

  it('counts messages correctly in session summaries', () => {
    const session = createSession(projectAId, rootA, 'Test Session')
    
    const db = getDatabase()
    db.prepare(`
      INSERT INTO events (session_id, event_type, payload, timestamp, seq)
      VALUES (?, 'message.start', ?, ?, 1)
    `).run(
      session.id,
      JSON.stringify({ messageId: 'msg1', role: 'user', content: 'Hello' }),
      Date.now()
    )
    db.prepare(`
      INSERT INTO events (session_id, event_type, payload, timestamp, seq)
      VALUES (?, 'message.start', ?, ?, 2)
    `).run(
      session.id,
      JSON.stringify({ messageId: 'msg2', role: 'assistant', content: 'Hi there' }),
      Date.now() + 1000
    )
    // Tool messages should NOT be counted
    db.prepare(`
      INSERT INTO events (session_id, event_type, payload, timestamp, seq)
      VALUES (?, 'message.start', ?, ?, 3)
    `).run(
      session.id,
      JSON.stringify({ messageId: 'msg3', role: 'tool', content: 'Tool result' }),
      Date.now() + 2000
    )

    const sessions = listSessionsByProject(projectAId)
    const sessionSummary = sessions.find(s => s.id === session.id)
    
    expect(sessionSummary).toBeDefined()
    expect(sessionSummary?.messageCount).toBe(2) // Only user and assistant messages
  })
})
