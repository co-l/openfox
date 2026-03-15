/**
 * Session Management E2E Tests
 * 
 * Tests session CRUD operations, state management, and reconnection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, createTestProject, type TestClient, type TestProject } from './utils/index.js'
import type { Session, SessionSummary, Message } from '@openfox/shared'

describe('Session Management', () => {
  let client: TestClient
  let testDir: TestProject
  let projectId: string

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Create a project for sessions
    await client.send('project.create', { name: 'Test Project', workdir: testDir.path })
    projectId = client.getProject()!.id
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('session.create', () => {
    it('creates a session in planner mode', async () => {
      const response = await client.send('session.create', { projectId })

      expect(response.type).toBe('session.state')
      const session = client.getSession()!
      expect(session.projectId).toBe(projectId)
      expect(session.mode).toBe('planner')
      expect(session.phase).toBe('plan')
      expect(session.isRunning).toBe(false)
      expect(session.workdir).toBe(testDir.path)
    })

    it('auto-generates session title', async () => {
      // First session
      await client.send('session.create', { projectId })
      const session1 = client.getSession()!
      expect(session1.metadata.title).toBe('Session 1')

      // Second session
      await client.send('session.create', { projectId })
      const session2 = client.getSession()!
      expect(session2.metadata.title).toBe('Session 2')
    })

    it('uses provided title when specified', async () => {
      await client.send('session.create', { projectId, title: 'My Custom Session' })
      const session = client.getSession()!
      expect(session.metadata.title).toBe('My Custom Session')
    })

    it('initializes with empty criteria and messages', async () => {
      const response = await client.send('session.create', { projectId })
      
      const payload = response.payload as { session: Session; messages: Message[] }
      expect(payload.session.criteria).toEqual([])
      expect(payload.messages).toEqual([])
    })
  })

  describe('session.load', () => {
    it('loads an existing session with full state', async () => {
      await client.send('session.create', { projectId })
      const created = client.getSession()!

      // Create new client and load the session
      const client2 = await createTestClient()
      try {
        const response = await client2.send('session.load', { sessionId: created.id })

        expect(response.type).toBe('session.state')
        const loaded = client2.getSession()!
        expect(loaded.id).toBe(created.id)
        expect(loaded.projectId).toBe(projectId)
        expect(loaded.mode).toBe('planner')
      } finally {
        await client2.close()
      }
    })

    it('receives context.state after load', async () => {
      await client.send('session.create', { projectId })
      const created = client.getSession()!

      const client2 = await createTestClient()
      try {
        await client2.send('session.load', { sessionId: created.id })
        
        // Should receive context.state event
        const contextEvent = await client2.waitFor('context.state')
        expect(contextEvent.type).toBe('context.state')
        const payload = contextEvent.payload as { context: { currentTokens: number; maxTokens: number } }
        expect(payload.context.maxTokens).toBeGreaterThan(0)
      } finally {
        await client2.close()
      }
    })

    it('returns NOT_FOUND for invalid session ID', async () => {
      const response = await client.send('session.load', { sessionId: 'nonexistent' })
      
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })

  describe('session.list', () => {
    it('returns sessions for a project', async () => {
      // Create multiple sessions
      await client.send('session.create', { projectId })
      const session1 = client.getSession()!
      await client.send('session.create', { projectId })
      const session2 = client.getSession()!

      const response = await client.send('session.list', {})
      const payload = response.payload as { sessions: SessionSummary[] }

      const ids = payload.sessions.map(s => s.id)
      expect(ids).toContain(session1.id)
      expect(ids).toContain(session2.id)
    })

    it('includes criteria counts in summary', async () => {
      await client.send('session.create', { projectId })

      const response = await client.send('session.list', {})
      const payload = response.payload as { sessions: SessionSummary[] }

      const sessionSummary = payload.sessions[0]!
      expect(sessionSummary.criteriaCount).toBe(0)
      expect(sessionSummary.criteriaCompleted).toBe(0)
    })
  })

  describe('session.delete', () => {
    it('deletes a session', async () => {
      await client.send('session.create', { projectId })
      const created = client.getSession()!

      const response = await client.send('session.delete', { sessionId: created.id })

      expect(response.type).toBe('session.deleted')
      expect((response.payload as { sessionId: string }).sessionId).toBe(created.id)

      // Verify it's gone
      const loadResponse = await client.send('session.load', { sessionId: created.id })
      expect(loadResponse.type).toBe('error')
      expect((loadResponse.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })

  describe('Multiple Sessions', () => {
    it('maintains independent state across sessions', async () => {
      await client.send('session.create', { projectId })
      const session1 = client.getSession()!

      await client.send('session.create', { projectId })
      const session2 = client.getSession()!

      expect(session1.id).not.toBe(session2.id)
      expect(session1.mode).toBe('planner')
      expect(session2.mode).toBe('planner')
    })

    it('can have multiple sessions per project', async () => {
      // Create 3 sessions
      await client.send('session.create', { projectId })
      await client.send('session.create', { projectId })
      await client.send('session.create', { projectId })

      const response = await client.send('session.list', {})
      const payload = response.payload as { sessions: SessionSummary[] }

      const projectSessions = payload.sessions.filter(s => s.projectId === projectId)
      expect(projectSessions.length).toBeGreaterThanOrEqual(3)
    })
  })
})
