/**
 * Concurrency E2E Tests
 *
 * Tests that the server properly guards against concurrent execution
 * on the same session (prevents multiple orchestrators/chat handlers).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  setSessionMode,
  stopSessionChat,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

describe('Concurrency Guards', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject
  let projectId: string
  let sessionId: string

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

    const restSession = await createSession(server.url, { projectId })
    await client.send('session.load', { sessionId: restSession.id })
    sessionId = client.getSession()!.id
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('chat.send guard', () => {
    it.skip('rejects chat.send when session is already running', async () => {
      // chat.send is now routed to REST API and always returns ack
      // This test is skipped because the behavior no longer applies
    })
  })

  describe('runner.launch guard', () => {
    it('rejects runner.launch when session is already running', async () => {
      const sessionId = client.getSession()!.id

      // Set up criteria so runner.launch is valid
      await client.send('criteria.edit', {
        criteria: [{ id: 'AC1', description: 'Test criterion', status: { type: 'pending' }, attempts: [] }],
      })

      // Switch to builder mode
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Start a chat to make session running
      client.send('chat.send', { content: 'Write a very long and detailed explanation of TypeScript.' })

      // Wait for session to be marked as running
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)

      // Try to launch runner while running - should be queued (new behavior)
      const response = await client.send('runner.launch', {})

      expect(response.type).toBe('queue.state')

      // Stop the running chat
      await stopSessionChat(server.url, sessionId)
    })
  })

  describe('mode.accept guard', () => {
    it.skip('queues mode.accept when session is already running', async () => {
      // mode.accept is removed; use runner.launch instead
    })
  })

  describe('abort existing agent', () => {
    it('aborts existing agent when starting a new one (defense in depth)', async () => {
      const sessionId = client.getSession()!.id

      // This tests that even if the guard is bypassed somehow,
      // the existing agent gets aborted before starting a new one.
      // This is harder to test directly - we mainly verify the guard works.
      // The abort behavior is tested implicitly by ensuring only one runs.

      // For now, just verify the session can recover after stopping
      client.send('chat.send', { content: 'Write a very long and detailed explanation of TypeScript.' })
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)

      await stopSessionChat(server.url, sessionId)
      await client.waitFor('session.running', (p: { isRunning: boolean }) => !p.isRunning)

      // Session should be able to start again
      client.send('chat.send', { content: 'Write a very long and detailed explanation of TypeScript.' })
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)

      await stopSessionChat(server.url, sessionId)
    })
  })
})
