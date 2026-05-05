/**
 * Provider Configuration REST API E2E Tests
 *
 * Tests session provider/model configuration via REST API.
 * Following TDD: these tests should FAIL initially before implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'

describe('Provider Configuration REST API', () => {
  let server: TestServerHandle
  let testProject: TestProject
  let projectId: string
  let sessionId: string

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

    // Create a session
    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Test Session' }),
    })
    const sessionData: any = await sessionRes.json()
    sessionId = sessionData.session.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  describe('POST /api/sessions/:id/provider', () => {
    it('sets session provider and model', async () => {
      // Get available providers first
      const providersRes = await fetch(`${server.url}/api/providers`)
      const providersData: any = await providersRes.json()
      const providerId = providersData.providers?.[0]?.id ?? providersData.activeProviderId

      if (!providerId) {
        // Skip test if no providers available (mock mode)
        console.log('No providers available, skipping test')
        return
      }

      // Set provider for session
      const response = await fetch(`${server.url}/api/sessions/${sessionId}/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.session.providerId).toBe(providerId)
    })

    it('updates context state with new maxTokens', async () => {
      // Get available providers first
      const providersRes = await fetch(`${server.url}/api/providers`)
      const providersData: any = await providersRes.json()
      const providerId = providersData.providers?.[0]?.id ?? providersData.activeProviderId

      if (!providerId) {
        // Skip test if no providers available (mock mode)
        console.log('No providers available, skipping test')
        return
      }

      // Set provider for session
      const response = await fetch(`${server.url}/api/sessions/${sessionId}/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()

      // Context state should be included
      expect(data.contextState).toBeDefined()
      expect(data.contextState.maxTokens).toBeGreaterThan(0)
    })

    it('returns 404 for non-existent session', async () => {
      const providersRes = await fetch(`${server.url}/api/providers`)
      const providersData: any = await providersRes.json()
      const providerId = providersData.activeProviderId

      const response = await fetch(`${server.url}/api/sessions/nonexistent-id/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })

      expect(response.status).toBe(404)
    })

    it('returns 400 for missing providerId', async () => {
      const response = await fetch(`${server.url}/api/sessions/${sessionId}/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
      const data: any = await response.json()
      expect(data.error).toBeDefined()
    })
  })
})
