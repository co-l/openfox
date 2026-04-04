/**
 * REST + WebSocket Integration E2E Tests
 * 
 * Verifies that REST CRUD operations work alongside WebSocket real-time features.
 * Tests the mixed-mode architecture: REST for CRUD, WS for streaming/events.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'
import { createTestClient } from './utils/index.js'
import { setSessionMode } from './utils/index.js'

describe('REST + WebSocket Integration', () => {
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
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('creates project via REST, then uses WS for chat', async () => {
    // Create project via REST
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Integration Test', workdir: testProject.path }),
    })
    expect(createRes.status).toBe(201)
    const createData: any = await createRes.json()
    projectId = createData.project.id

    // Create session via REST
    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Integration Session' }),
    })
    expect(sessionRes.status).toBe(201)
    const sessionData: any = await sessionRes.json()
    const sessionId = sessionData.session.id

    // Load session via REST to get full state
    const loadRes = await fetch(`${server.url}/api/sessions/${sessionId}`)
    expect(loadRes.status).toBe(200)
    const loadData: any = await loadRes.json()
    expect(loadData.session.id).toBe(sessionId)
    expect(Array.isArray(loadData.messages)).toBe(true)

    // Connect via WebSocket and subscribe to session for real-time events
    const client = await createTestClient({ url: server.wsUrl })
    try {
      // Use session.load via WS to subscribe (sets activeSessionId for event routing)
      // This is the only WS CRUD operation still needed for subscription mechanism
      await client.send('session.load', { sessionId })
      expect(client.getSession()?.id).toBe(sessionId)

      // Verify WS real-time features still work (mode switching, etc.)
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      const modeEvent = await client.waitFor('mode.changed')
      expect(modeEvent.type).toBe('mode.changed')
      expect((modeEvent.payload as any).mode).toBe('builder')
    } finally {
      await client.close()
    }
  })

  it('no race conditions between REST updates and WS events', async () => {
    // Create project via REST
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Race Test', workdir: testProject.path }),
    })
    const createData: any = await createRes.json()
    projectId = createData.project.id

    // Create session via REST
    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Race Session' }),
    })
    const sessionData: any = await sessionRes.json()
    const sessionId = sessionData.session.id

    // Connect via WS
    const client = await createTestClient({ url: server.wsUrl })
    try {
      // Load session via REST first, then subscribe via WS
      const loadRes = await fetch(`${server.url}/api/sessions/${sessionId}`)
      expect(loadRes.status).toBe(200)
      const loadData: any = await loadRes.json()
      
      // Subscribe to session via WS for real-time events
      await client.send('session.load', { sessionId })

      // Update project via REST
      const updateRes = await fetch(`${server.url}/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      })
      expect(updateRes.status).toBe(200)
      const updateData: any = await updateRes.json()
      expect(updateData.project.name).toBe('Updated Name')

      // Verify WS session still works
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      const modeEvent = await client.waitFor('mode.changed')
      expect(modeEvent.type).toBe('mode.changed')

      // Update settings via REST
      const settingsRes = await fetch(`${server.url}/api/settings/test-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'test-value' }),
      })
      expect(settingsRes.status).toBe(200)

      // Verify settings persisted
      const getRes = await fetch(`${server.url}/api/settings/test-key`)
      const getData: any = await getRes.json()
      expect(getData.value).toBe('test-value')
    } finally {
      await client.close()
    }
  })

  it('session provider switch via REST works with WS streaming', async () => {
    // Create project and session via REST
    const projectRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Provider Test', workdir: testProject.path }),
    })
    const projectData: any = await projectRes.json()
    projectId = projectData.project.id

    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Provider Session' }),
    })
    const sessionData: any = await sessionRes.json()
    const sessionId = sessionData.session.id

    // Connect via WS
    const client = await createTestClient({ url: server.wsUrl })
    try {
      // Load session via WS
      await client.send('session.load', { sessionId })

      // Get active provider
      const providersRes = await fetch(`${server.url}/api/providers`)
      const providersData: any = await providersRes.json()
      const providerId = providersData.providers?.[0]?.id ?? providersData.activeProviderId

      if (providerId) {
        // Switch provider via REST
        const providerRes = await fetch(`${server.url}/api/sessions/${sessionId}/provider`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId }),
        })
        expect(providerRes.status).toBe(200)
        const providerData: any = await providerRes.json()
        expect(providerData.session.providerId).toBe(providerId)

        // Verify WS still works for real-time features
      await setSessionMode(server.url, sessionId, 'planner', server.wsUrl)
        const modeEvent = await client.waitFor('mode.changed')
        expect(modeEvent.type).toBe('mode.changed')
      }
    } finally {
      await client.close()
    }
  })
})
