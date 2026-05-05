/**
 * System Reminder Injection E2E Tests
 *
 * Tests that mode definitions (planner/builder system reminders) are injected
 * the correct number of times during a session with mode switches.
 *
 * Scenario: planner("hi") -> builder("hi") -> planner("hi")
 * Expected: planner definition injected 2x, builder definition injected 1x
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  setSessionMode,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

describe('System Reminder Injection', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    testDir = await createTestProject({ template: 'typescript' })

    const restProject = await createProject(server.url, { name: 'Reminder Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Planner and Builder definition injection counts', () => {
    it('injects planner definition twice and builder definition once across mode switches', async () => {
      const sessionId = client.getSession()!.id

      client.clearEvents()

      // Step 1: First message in planner mode - planner definition should be injected
      await client.send('chat.send', { content: 'hi' })
      await client.waitForChatDone()

      // Step 2: Switch to builder mode
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Step 3: Second message in builder mode - builder definition should be injected
      await client.send('chat.send', { content: 'hi' })
      await client.waitForChatDone()

      // Step 4: Switch back to planner mode
      await setSessionMode(server.url, sessionId, 'planner', server.wsUrl)

      // Step 5: Third message in planner mode - planner definition should be injected again
      await client.send('chat.send', { content: 'hi' })
      await client.waitForChatDone()

      // Collect all events to count definition injections
      const allEvents = client.allEvents()

      // Inspect events directly
      console.log('All events count:', allEvents.length)
      for (let i = 0; i < allEvents.length; i++) {
        const evt = allEvents[i]!
        if (evt.type === 'chat.message') {
          const p = evt.payload as { message: { isSystemGenerated?: boolean; content?: string } }
          console.log(
            `Event ${i}: chat.message, isSystemGenerated=${p.message.isSystemGenerated}, content=${p.message.content?.slice(0, 80)}`,
          )
        } else {
          console.log(`Event ${i}: ${evt.type}`)
        }
      }

      const plannerDefinitions = allEvents.filter((event) => {
        if (event.type !== 'chat.message') return false
        const payload = event.payload as { message: { content: string; isSystemGenerated?: boolean } }
        return payload.message.isSystemGenerated === true && payload.message.content.includes('Plan Mode')
      })

      const builderDefinitions = allEvents.filter((event) => {
        if (event.type !== 'chat.message') return false
        const payload = event.payload as { message: { content: string; isSystemGenerated?: boolean } }
        return payload.message.isSystemGenerated === true && payload.message.content.includes('Build Mode')
      })

      console.log('Planner definitions:', plannerDefinitions.length)
      console.log('Builder definitions:', builderDefinitions.length)

      expect(plannerDefinitions).toHaveLength(2)
      expect(builderDefinitions).toHaveLength(1)
    })
  })
})
