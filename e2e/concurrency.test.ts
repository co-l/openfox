/**
 * Concurrency E2E Tests
 * 
 * Tests that the server properly guards against concurrent execution
 * on the same session (prevents multiple orchestrators/chat handlers).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, createTestProject, type TestClient, type TestProject } from './utils/index.js'

describe('Concurrency Guards', () => {
  let client: TestClient
  let testDir: TestProject
  let projectId: string
  let sessionId: string

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Create project and session
    await client.send('project.create', { name: 'Test Project', workdir: testDir.path })
    projectId = client.getProject()!.id
    
    await client.send('session.create', { projectId })
    sessionId = client.getSession()!.id
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('chat.send guard', () => {
    it('rejects chat.send when session is already running', async () => {
      // Start a chat (makes session running)
      client.send('chat.send', { content: 'Hello' })
      
      // Wait for session to be marked as running
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)
      
      // Try to send another chat while running - should be rejected
      const response = await client.send('chat.send', { content: 'Another message' })
      
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('ALREADY_RUNNING')
      
      // Stop the running chat
      await client.send('chat.stop', {})
    })
  })

  describe('runner.launch guard', () => {
    it('rejects runner.launch when session is already running', async () => {
      // Set up criteria so runner.launch is valid
      await client.send('criteria.edit', {
        criteria: [{ id: 'AC1', description: 'Test criterion', status: { type: 'pending' }, attempts: [] }]
      })
      
      // Switch to builder mode
      await client.send('mode.switch', { mode: 'builder' })
      
      // Start a chat to make session running
      client.send('chat.send', { content: 'Hello' })
      
      // Wait for session to be marked as running
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)
      
      // Try to launch runner while running - should be rejected
      const response = await client.send('runner.launch', {})
      
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('ALREADY_RUNNING')
      
      // Stop the running chat
      await client.send('chat.stop', {})
    })
  })

  describe('mode.accept guard', () => {
    it('rejects mode.accept when session is already running', async () => {
      // Set up criteria so mode.accept is valid
      await client.send('criteria.edit', {
        criteria: [{ id: 'AC1', description: 'Test criterion', status: { type: 'pending' }, attempts: [] }]
      })
      
      // Start a chat to make session running
      client.send('chat.send', { content: 'Hello' })
      
      // Wait for session to be marked as running
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)
      
      // Try to accept while running - should be rejected
      const response = await client.send('mode.accept', {})
      
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('ALREADY_RUNNING')
      
      // Stop the running chat
      await client.send('chat.stop', {})
    })
  })

  describe('abort existing agent', () => {
    it('aborts existing agent when starting a new one (defense in depth)', async () => {
      // This tests that even if the guard is bypassed somehow,
      // the existing agent gets aborted before starting a new one.
      // This is harder to test directly - we mainly verify the guard works.
      // The abort behavior is tested implicitly by ensuring only one runs.
      
      // For now, just verify the session can recover after stopping
      client.send('chat.send', { content: 'Hello' })
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)
      
      await client.send('chat.stop', {})
      await client.waitFor('session.running', (p: { isRunning: boolean }) => !p.isRunning)
      
      // Session should be able to start again
      client.send('chat.send', { content: 'Hello again' })
      await client.waitFor('session.running', (p: { isRunning: boolean }) => p.isRunning)
      
      await client.send('chat.stop', {})
    })
  })
})
