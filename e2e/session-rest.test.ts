/**
 * Session Management REST API E2E Tests
 * 
 * Tests session CRUD operations via REST API (not WebSocket).
 * Following TDD: these tests should FAIL initially before implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'

describe('Session REST API', () => {
  let server: TestServerHandle
  let testProject: TestProject
  let projectId: string

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    testProject = await createTestProject({ template: 'empty' })
    // Create a project via REST
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Project', workdir: testProject.path }),
    })
    const data: any = await createRes.json()
    projectId = data.project.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  describe('GET /api/sessions', () => {
    it('returns empty array when no sessions exist', async () => {
      const response = await fetch(`${server.url}/api/sessions`)
      
      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.sessions).toEqual([])
    })

    it('returns sessions filtered by projectId', async () => {
      // Create a session
      const createRes = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Test Session' }),
      })
      const created: any = await createRes.json()

      // List sessions for this project
      const response = await fetch(`${server.url}/api/sessions?projectId=${projectId}`)
      expect(response.status).toBe(200)
      const data: any = await response.json()
      
      expect(Array.isArray(data.sessions)).toBe(true)
      const found = data.sessions.find((s: any) => s.id === created.session.id)
      expect(found).toBeDefined()
      expect(found.title).toBe('Test Session')
    })
  })

  describe('POST /api/sessions', () => {
    it('creates a session with projectId and title', async () => {
      const response = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'My Session' }),
      })

      expect(response.status).toBe(201)
      const data: any = await response.json()
      
      expect(data.session).toBeDefined()
      expect(data.session.projectId).toBe(projectId)
      expect(data.session.metadata.title).toBe('My Session')
      expect(data.session.mode).toBe('planner')
      expect(data.session.phase).toBe('plan')
      expect(data.session.isRunning).toBe(false)
    })

    it('auto-generates title when not provided', async () => {
      const response = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })

      expect(response.status).toBe(201)
      const data: any = await response.json()
      expect(data.session.metadata.title).toBeDefined()
    })

    it('returns 400 for missing projectId', async () => {
      const response = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
      const data: any = await response.json()
      expect(data.error).toBeDefined()
    })

    it('returns 404 for non-existent project', async () => {
      const response = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'nonexistent', title: 'Test' }),
      })

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/sessions/:id', () => {
    it('loads an existing session with messages', async () => {
      // Create first
      const createRes = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Load Me' }),
      })
      const created: any = await createRes.json()

      // Load it
      const response = await fetch(`${server.url}/api/sessions/${created.session.id}`)
      
      expect(response.status).toBe(200)
      const data: any = await response.json()
      
      expect(data.session.id).toBe(created.session.id)
      expect(data.session.metadata.title).toBe('Load Me')
      expect(Array.isArray(data.messages)).toBe(true)
      expect(data.contextState).toBeDefined()
      expect(data.contextState.maxTokens).toBeGreaterThan(0)
    })

    it('returns 404 for non-existent session', async () => {
      const response = await fetch(`${server.url}/api/sessions/nonexistent-id`)
      
      expect(response.status).toBe(404)
      const data: any = await response.json()
      expect(data.error).toBe('Session not found')
    })
  })

  describe('DELETE /api/sessions/:id', () => {
    it('deletes a session', async () => {
      // Create first
      const createRes = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Delete Me' }),
      })
      const created: any = await createRes.json()

      // Delete
      const response = await fetch(`${server.url}/api/sessions/${created.session.id}`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.success).toBe(true)

      // Verify it's gone
      const loadResponse = await fetch(`${server.url}/api/sessions/${created.session.id}`)
      expect(loadResponse.status).toBe(404)
    })

    it('returns 404 for non-existent session', async () => {
      const response = await fetch(`${server.url}/api/sessions/nonexistent-id`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/projects/:projectId/sessions', () => {
    it('deletes all sessions for a project', async () => {
      // Create multiple sessions
      await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Session 1' }),
      })
      await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Session 2' }),
      })

      // Delete all
      const response = await fetch(`${server.url}/api/projects/${projectId}/sessions`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.success).toBe(true)

      // Verify all are gone
      const listResponse = await fetch(`${server.url}/api/sessions?projectId=${projectId}`)
      const listData: any = await listResponse.json()
      expect(listData.sessions).toEqual([])
    })
  })
})
