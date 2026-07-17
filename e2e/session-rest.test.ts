/**
 * Session Management REST API E2E Tests
 *
 * Tests session CRUD operations via REST API (not WebSocket).
 * Following TDD: these tests should FAIL initially before implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'
import { createTestClient } from './utils/index.js'
import { setTimeout as sleep } from 'node:timers/promises'

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

    it('cancels active agent execution when deleting a running session', async () => {
      // Create session
      const createRes = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Delete While Running' }),
      })
      const created: any = await createRes.json()
      const sessionId = created.session.id

      // Connect WS client and load the session
      const client = await createTestClient({ url: server.wsUrl })
      await client.send('session.load', { sessionId })

      // Send a message that triggers slow streaming (gives us time to delete mid-flight)
      client.send('chat.send', { content: 'Write a very long and detailed explanation of TypeScript.' })

      // Wait for session to be marked as running
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)

      // Confirm the session is actually running via REST
      const runningCheck: any = await (await fetch(`${server.url}/api/sessions/${sessionId}`)).json()
      expect(runningCheck.session.isRunning).toBe(true)

      // Wait for at least one chat.delta to confirm streaming has started
      await client.waitFor('chat.delta')

      // Record events before deletion
      const eventsBeforeDelete = client.allEvents().length

      // Delete the session while it's running
      const deleteRes = await fetch(`${server.url}/api/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(200)

      // Wait to see if any events arrive after deletion
      await sleep(1500)

      // Collect events that arrived after deletion
      const eventsAfterDelete = client.allEvents().slice(eventsBeforeDelete)

      // Filter for chat events that indicate continued agent activity
      const chatActivityEvents = eventsAfterDelete.filter((e) =>
        ['chat.done', 'chat.tool_call', 'chat.tool_result', 'chat.delta', 'chat.thinking'].includes(e.type),
      )

      // There should be no chat activity after deletion
      expect(chatActivityEvents.length).toBe(0)

      // Verify session is gone
      const getRes = await fetch(`${server.url}/api/sessions/${sessionId}`)
      expect(getRes.status).toBe(404)

      await client.close()
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

  describe('PUT /api/sessions/:id/metadata/:key', () => {
    let sessionId: string

    beforeEach(async () => {
      const res = await fetch(`${server.url}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title: 'Metadata Test' }),
      })
      const data: any = await res.json()
      sessionId = data.session.id
    })

    it('sets entries for an arbitrary key', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{ id: '0', description: 'Login button broken', status: 'open' }],
        }),
      })
      expect(res.status).toBe(200)
      const data: any = await res.json()
      expect(data.success).toBe(true)

      const getRes = await fetch(`${server.url}/api/sessions/${sessionId}`)
      const sessionData: any = await getRes.json()
      const entries = sessionData.session.metadataEntries?.['qa_findings'] ?? []
      expect(entries).toHaveLength(1)
      expect(entries[0].description).toBe('Login button broken')
    })

    it('clears entries when passed an empty array', async () => {
      await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{ id: '0', description: 'Some finding', status: 'open' }],
        }),
      })

      const clearRes = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [] }),
      })
      expect(clearRes.status).toBe(200)

      const getRes = await fetch(`${server.url}/api/sessions/${sessionId}`)
      const sessionData: any = await getRes.json()
      const entries = sessionData.session.metadataEntries?.['qa_findings'] ?? []
      expect(entries).toHaveLength(0)
    })

    it('preserves additional fields on entries', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{ id: '0', description: 'Bug', status: 'open', severity: 'high', file: 'src/foo.ts' }],
        }),
      })
      expect(res.status).toBe(200)

      const getRes = await fetch(`${server.url}/api/sessions/${sessionId}`)
      const sessionData: any = await getRes.json()
      const entry = sessionData.session.metadataEntries?.['qa_findings']?.[0]
      expect(entry?.severity).toBe('high')
      expect(entry?.file).toBe('src/foo.ts')
    })

    it('returns 404 for unknown session', async () => {
      const res = await fetch(`${server.url}/api/sessions/nonexistent/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [] }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 400 when entries is not an array', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: 'not-an-array' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when an entry is null', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [null] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when an entry is a primitive', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [42] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when description is not a string', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ description: 42, status: 'open' }] }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when status is not a string', async () => {
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/metadata/qa_findings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ description: 'Bug', status: {} }] }),
      })
      expect(res.status).toBe(400)
    })
  })
})
