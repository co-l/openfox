/**
 * Full Workflow E2E Tests
 *
 * Tests complete user workflows from planning through implementation.
 * These are the most important tests - they validate the full system integration.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  collectUntilPhase,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  setSessionMode,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'
import type { Criterion } from '../src/shared/types.js'

describe('Full Workflows', () => {
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
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Planning Session', () => {
    it('completes a full planning session with criteria', async () => {
      // 1. Create project and session via REST API
      const project = await createProject(server.url, { name: 'Planning Workflow', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })

      // 2. Load session via WebSocket to subscribe to events
      await client.send('session.load', { sessionId: session.id })

      // 3. Describe the task
      await client.send('chat.send', {
        content: `I want to add a multiply function to src/math.ts. 
The function should:
1. Take two numbers as parameters
2. Return their product
3. Handle edge cases like zero

Please explore the existing code and propose acceptance criteria using add_criterion.`,
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // 4. Verify criteria were created
      const currentSession = client.getSession()!
      expect(currentSession.criteria.length).toBeGreaterThan(0)
      expect(currentSession.mode).toBe('planner')
      expect(currentSession.phase).toBe('plan')

      // 5. Criteria should be descriptive
      const criterion = currentSession.criteria[0]!
      expect(criterion.description.length).toBeGreaterThan(10)
      expect(criterion.status.type).toBe('pending')
    })
  })

  describe('Accept and Build', () => {
    it.skip('accepts criteria and builder implements the task', async () => {
      // Setup: Create project and session via REST
      const project = await createProject(server.url, { name: 'Build Workflow', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })

      // Add a straightforward criterion the mock builder can satisfy automatically
      await client.send('chat.send', {
        content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.',
      })
      await client.waitForChatDone()

      // Accept criteria - this should run the builder and verifier quickly
      const acceptResponse = await client.send('mode.accept', {})
      expect(acceptResponse.type).toBe('ack')

      const events = await collectUntilPhase(client, 'done', 1_500)
      assertNoErrors(events)

      const currentSession = client.getSession()!
      expect(currentSession.mode).toBe('builder')
      expect(currentSession.phase).toBe('done')

      const utilsContent = await readFile(join(testDir.path, 'src/utils.ts'), 'utf-8')
      expect(utilsContent).toContain('created')
    })
  })

  describe('Verification Cycle', () => {
    it.skip('verifier passes criteria after successful implementation', async () => {
      const project = await createProject(server.url, { name: 'Verify Workflow', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })

      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      await collectUntilPhase(client, 'done', 1_500)

      const currentSession = client.getSession()!
      const criterion = currentSession.criteria[0]
      expect(currentSession.phase).toBe('done')
      expect(criterion?.status.type).toBe('passed')
    })

    it.skip('verifier fails and builder retries', async () => {
      const project = await createProject(server.url, { name: 'Retry Workflow', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })

      await client.send('chat.send', {
        content: 'Add criterion ID "verify-fail": "Verifier should fail this criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      await collectUntilPhase(client, 'blocked', 5_000)

      const currentSession = client.getSession()!
      const events = client.allEvents()
      const phaseChanges = events.filter((e) => e.type === 'phase.changed')
      expect(currentSession.phase).toBe('blocked')
      expect(phaseChanges.length).toBeGreaterThan(1)
    })
  })

  describe('Multiple Criteria', () => {
    it.skip('handles multiple criteria in sequence', async () => {
      const project = await createProject(server.url, { name: 'Multi Criteria', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })

      await client.send('chat.send', {
        content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.',
      })
      await client.waitForChatDone()
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      await collectUntilPhase(client, 'done', 15_000)

      const finalSession = client.getSession()!
      const processed = finalSession.criteria.filter((c: Criterion) => c.status.type === 'passed')
      expect(processed).toHaveLength(2)
    })
  })

  describe('Session Persistence', () => {
    it.skip('preserves state across session load', async () => {
      // Create and populate session via REST
      const project = await createProject(server.url, { name: 'Persist Workflow', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })

      // Add criteria
      await client.send('chat.send', {
        content: 'Add criterion: "Test criterion". Use add_criterion.',
      })
      await client.waitForChatDone()

      const currentSession = client.getSession()!
      const sessionId = currentSession.id
      const criteriaCount = currentSession.criteria.length

      // Create new client and load session
      const client2 = await createTestClient({ url: server.wsUrl })
      try {
        await client2.send('session.load', { sessionId })

        const loadedSession = client2.getSession()!
        expect(loadedSession.id).toBe(sessionId)
        expect(loadedSession.criteria.length).toBe(criteriaCount)
      } finally {
        await client2.close()
      }
    })
  })

  describe('Error Recovery', () => {
    it.skip('recovers from tool failures gracefully', async () => {
      const project = await createProject(server.url, { name: 'Error Recovery', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Ask to do something that will fail initially (use path inside workdir to avoid confirmation modal)
      await client.send('chat.send', {
        content: 'Try to read a file at src/nonexistent-file.txt and then read src/math.ts instead.',
      })

      const events = await collectChatEvents(client)

      // Should have handled the error gracefully
      const toolResults = events.get('chat.tool_result')
      const failedRead = toolResults?.find((e) => {
        const payload = e.payload as { result: { success: boolean } }
        return !payload.result.success
      })

      // Should have failed gracefully (not crashed)
      assertNoErrors(events)
    })
  })

  describe('User Intervention', () => {
    it.skip('resets blocked state on user message', { timeout: 10_000 }, async () => {
      const project = await createProject(server.url, { name: 'Intervention Test', workdir: testDir.path })
      const session = await createSession(server.url, { projectId: project.id })
      await client.send('session.load', { sessionId: session.id })

      // Add impossible criterion to trigger blocked state
      await client.send('chat.send', {
        content: 'Add criterion: "The file /this/path/cannot/exist.txt exists". Use add_criterion.',
      })
      await client.waitForChatDone()

      // Switch to builder and set blocked phase manually
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Start with a message (simulating user intervention)
      await client.send('chat.send', {
        content: 'Actually, let me help you. Just create src/newfile.ts with "export const x = 1".',
      })

      await client.waitForChatDone(5_000)

      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((event) => event.type === 'error' || event.type === 'chat.error')
      expect(errorEvents).toHaveLength(0)
    })
  })
})
