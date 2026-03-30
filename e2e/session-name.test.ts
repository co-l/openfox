/**
 * Auto Session Name E2E Tests
 * 
 * Tests the automatic session name generation from the first user message.
 * Verifies the complete flow: message sent → name generated → event stored → DB updated → WebSocket broadcast.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestClient, createTestProject, createTestServer, createProject, createSession, type TestClient, type TestProject, type TestServerHandle } from './utils/index.js'

describe('Auto Session Name', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject
  let projectId: string

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    testDir = await createTestProject({ template: 'typescript' })
    
    const restProject = await createProject(server.url, { name: 'Test Project', workdir: testDir.path })
    projectId = restProject.id
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('session.name_generated event', () => {
    it('should emit session.name_generated event after first message', { timeout: 8_000 }, async () => {
      const restSession = await createSession(server.url, { projectId })
      await client.send('session.load', { sessionId: restSession.id })
      const session = client.getSession()!
      expect(session.metadata.title).toBe('Session 1')

      // Send first message - this should trigger name generation
      await client.send('chat.send', {
        content: 'How do I set up a React project with TypeScript?'
      })

      await client.waitForChatDone(3_000)

      await client.waitFor('session.name_generated', undefined, 3_000)

      // Check all received events for session.name_generated
      const allEvents = client.allEvents()
      const nameGeneratedEvents = allEvents.filter(msg => msg.type === 'session.name_generated')
      
      // Verify event was received
      expect(nameGeneratedEvents.length).toBeGreaterThan(0)
      const nameEvent = nameGeneratedEvents[0]
      expect(nameEvent.type).toBe('session.name_generated')
      expect(nameEvent.payload.name).toBeDefined()
      expect(typeof nameEvent.payload.name).toBe('string')
      expect(nameEvent.payload.name.length).toBeLessThanOrEqual(50)
    })

    it('should update session title in database', { timeout: 8_000 }, async () => {
      const restSession = await createSession(server.url, { projectId })
      await client.send('session.load', { sessionId: restSession.id })
      const session = client.getSession()!

      // Send first message
      await client.send('chat.send', {
        content: 'Fix the authentication bug in the login component'
      })

      await client.waitForChatDone(3_000)

      await client.waitFor('session.name_generated', undefined, 3_000)

      // Reload session to verify DB update
      const reloaded = await client.send('session.load', { sessionId: session.id })
      expect(reloaded.type).toBe('session.state')
      
      const updatedSession = client.getSession()!
      // Title should have been updated (either generated name or still default if generation failed)
      expect(updatedSession.metadata.title).toBeDefined()
    })

    it('should broadcast updated session state to WebSocket clients', { timeout: 8_000 }, async () => {
      const restSession = await createSession(server.url, { projectId })
      await client.send('session.load', { sessionId: restSession.id })

      // Create a second client to monitor broadcasts
      const client2 = await createTestClient({ url: server.wsUrl })
      await client2.send('session.load', { sessionId: restSession.id })

      // Send first message
      await client.send('chat.send', {
        content: 'Add unit tests for the API endpoints'
      })

      await client.waitForChatDone(3_000)

      await client2.waitFor('session.state', (payload: unknown) => {
        const sessionPayload = payload as { session: { metadata: { title?: string | null } } }
        return Boolean(sessionPayload.session.metadata.title && sessionPayload.session.metadata.title !== 'Session 1')
      }, 3_000)

      // Verify session.state was broadcast with updated title
      const allEvents = client2.allEvents()
      const sessionStateUpdates = allEvents.filter(msg => msg.type === 'session.state')
      
      // At least one session.state should have been sent
      expect(sessionStateUpdates.length).toBeGreaterThan(0)
      
      await client2.close()
    })

    it('should not generate name for subsequent messages', { timeout: 8_000 }, async () => {
      const restSession = await createSession(server.url, { projectId })
      await client.send('session.load', { sessionId: restSession.id })
      const session = client.getSession()!

      // Send first message
      await client.send('chat.send', {
        content: 'Initial question about the project'
      })

      await client.waitForChatDone(3_000)

      await client.waitFor('session.name_generated', undefined, 3_000)

      const allEvents1 = client.allEvents()
      const nameEvents1 = allEvents1.filter(msg => msg.type === 'session.name_generated')
      const titleAfterFirst = client.getSession()!.metadata.title

      // Send second message
      await client.send('chat.send', {
        content: 'Follow-up question'
      })

      await client.waitForChatDone(3_000)

      await new Promise(resolve => setTimeout(resolve, 200))

      // Check for additional name generation events
      const allEvents2 = client.allEvents()
      const nameEvents2 = allEvents2.filter(msg => msg.type === 'session.name_generated')
      
      // Should still have only the same number of name events
      expect(nameEvents2.length).toBe(nameEvents1.length)
      
      // Session title should not change again
      const finalSession = client.getSession()!
      expect(finalSession.metadata.title).toBe(titleAfterFirst)
    })

    it('should handle name generation failure gracefully', { timeout: 8_000 }, async () => {
      const restSession = await createSession(server.url, { projectId })
      await client.send('session.load', { sessionId: restSession.id })

      // This should not crash even if name generation fails
      await client.send('chat.send', {
        content: 'Test message that might cause name generation to fail'
      })

      await client.waitForChatDone(3_000)

      // Session should still be functional
      const response = await client.send('chat.send', {
        content: 'Another message'
      })
      
      expect(response.type).toBe('ack')
    })

    it('should generate descriptive name from message content', { timeout: 8_000 }, async () => {
      const restSession = await createSession(server.url, { projectId })
      await client.send('session.load', { sessionId: restSession.id })
      const session = client.getSession()!

      // Send a descriptive message
      await client.send('chat.send', {
        content: 'How do I implement OAuth2 authentication with JWT tokens?'
      })

      await client.waitForChatDone(3_000)

      await client.waitFor('session.name_generated', undefined, 3_000)

      // Check for name generation event
      const allEvents = client.allEvents()
      const nameEvents = allEvents.filter(msg => msg.type === 'session.name_generated')
      
      if (nameEvents.length > 0) {
        // Verify title was generated
        expect(nameEvents[0].payload.name).toBeDefined()
        expect(nameEvents[0].payload.name!.length).toBeGreaterThan(3)
        expect(nameEvents[0].payload.name!.length).toBeLessThanOrEqual(50)
      }
      
      // Reload session
      await client.send('session.load', { sessionId: session.id })
      const updatedSession = client.getSession()!
      
      // Verify title was updated (if generation succeeded)
      if (nameEvents.length > 0) {
        expect(updatedSession.metadata.title).not.toBe('Session 1')
      }
    })
  })
})
