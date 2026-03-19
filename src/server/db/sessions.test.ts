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

  it('lists sessions by project including nested workdirs', () => {
    const sessionA = createSession(projectAId, rootA, 'Session A')
    const sessionNested = createSession(projectBId, join(rootA, 'nested'), 'Nested Session')
    createSession(projectBId, rootB, 'Session B')

    const filtered = listSessionsByProject(projectAId, rootA)
    expect(filtered.map(s => s.id)).toContain(sessionA.id)
    expect(filtered.map(s => s.id)).toContain(sessionNested.id)
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
})
