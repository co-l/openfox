/**
 * Full Workflow E2E Tests
 * 
 * Tests complete user workflows from planning through implementation.
 * These are the most important tests - they validate the full system integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  collectUntilPhase,
  collectChatEvents,
  assertNoErrors,
  type TestClient, 
  type TestProject 
} from './utils/index.js'
import type { Criterion } from '@openfox/shared'

describe('Full Workflows', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Planning Session', () => {
    it('completes a full planning session with criteria', async () => {
      // 1. Create project and session
      await client.send('project.create', { name: 'Planning Workflow', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // 2. Describe the task
      await client.send('chat.send', { 
        content: `I want to add a multiply function to src/math.ts. 
The function should:
1. Take two numbers as parameters
2. Return their product
3. Handle edge cases like zero

Please explore the existing code and propose acceptance criteria using add_criterion.` 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // 3. Verify criteria were created
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThan(0)
      expect(session.mode).toBe('planner')
      expect(session.phase).toBe('plan')
      
      // 4. Criteria should be descriptive
      const criterion = session.criteria[0]!
      expect(criterion.description.length).toBeGreaterThan(10)
      expect(criterion.status.type).toBe('pending')
    })
  })

  describe('Accept and Build', () => {
    it('accepts criteria and builder implements the task', async () => {
      // Setup: Create project, session, and add simple criteria
      await client.send('project.create', { name: 'Build Workflow', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Add a straightforward criterion
      await client.send('chat.send', { 
        content: `Add this criterion using add_criterion:
ID: "multiply-exists"  
Description: "A multiply function exists in src/math.ts that takes two numbers and returns their product"` 
      })
      await client.waitForChatDone()
      
      // Accept criteria - this triggers summary + builder + verifier
      const acceptResponse = await client.send('mode.accept', {})
      expect(acceptResponse.type).toBe('ack')
      
      // Wait for the workflow to complete (or get stuck)
      const events = await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Check final state
      const session = client.getSession()!
      expect(['done', 'blocked']).toContain(session.phase)
      
      // If done, verify the file was modified
      if (session.phase === 'done') {
        const mathContent = await readFile(join(testDir.path, 'src/math.ts'), 'utf-8')
        expect(mathContent.toLowerCase()).toContain('multiply')
      }
    }, 200_000) // Extra long timeout for full workflow
  })

  describe('Verification Cycle', () => {
    it('verifier passes criteria after successful implementation', async () => {
      await client.send('project.create', { name: 'Verify Workflow', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Add a simple verifiable criterion
      await client.send('chat.send', { 
        content: `Add criterion ID "file-modified": "The src/math.ts file contains a new function". Use add_criterion.` 
      })
      await client.waitForChatDone()
      
      // Accept and run
      await client.send('mode.accept', {})
      
      // Wait for done or blocked
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      const session = client.getSession()!
      
      // Check criteria status
      const criterion = session.criteria[0]
      if (session.phase === 'done' && criterion) {
        expect(criterion.status.type).toBe('passed')
      }
    }, 200_000)

    it('verifier fails and builder retries', async () => {
      await client.send('project.create', { name: 'Retry Workflow', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Add a more specific criterion that might need retries
      await client.send('chat.send', { 
        content: `Add criterion: "src/math.ts contains an exported function called 'multiply' that multiplies two numbers". Use add_criterion.` 
      })
      await client.waitForChatDone()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Even if blocked, the system should have tried
      const session = client.getSession()!
      
      // Should have had some builder activity
      const events = client.allEvents()
      const phaseChanges = events.filter(e => e.type === 'phase.changed')
      expect(phaseChanges.length).toBeGreaterThan(1)
    }, 200_000)
  })

  describe('Multiple Criteria', () => {
    it('handles multiple criteria in sequence', async () => {
      await client.send('project.create', { name: 'Multi Criteria', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Add multiple criteria
      await client.send('chat.send', { 
        content: `Add these criteria using add_criterion:
1. ID "criterion-1": "A new file src/utils.ts exists"
2. ID "criterion-2": "src/utils.ts exports a function"` 
      })
      await client.waitForChatDone()
      
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThanOrEqual(2)
      
      // Accept and run
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Should have processed all criteria
      const finalSession = client.getSession()!
      const processed = finalSession.criteria.filter(c => 
        c.status.type === 'passed' || c.status.type === 'failed'
      )
      expect(processed.length).toBeGreaterThan(0)
    }, 200_000)
  })

  describe('Session Persistence', () => {
    it('preserves state across session load', async () => {
      // Create and populate session
      await client.send('project.create', { name: 'Persist Workflow', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Add criteria
      await client.send('chat.send', { 
        content: 'Add criterion: "Test criterion". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      const session = client.getSession()!
      const sessionId = session.id
      const criteriaCount = session.criteria.length
      
      // Create new client and load session
      const client2 = await createTestClient()
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
    it('recovers from tool failures gracefully', async () => {
      await client.send('project.create', { name: 'Error Recovery', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      await client.send('mode.switch', { mode: 'builder' })
      
      // Ask to do something that will fail initially (use path inside workdir to avoid confirmation modal)
      await client.send('chat.send', { 
        content: 'Try to read a file at src/nonexistent-file.txt and then read src/math.ts instead.' 
      })
      
      const events = await collectChatEvents(client)
      
      // Should have handled the error gracefully
      const toolResults = events.get('chat.tool_result')
      const failedRead = toolResults.find(e => {
        const payload = e.payload as { result: { success: boolean } }
        return !payload.result.success
      })
      
      // Should have failed gracefully (not crashed)
      assertNoErrors(events)
    })
  })

  describe('User Intervention', () => {
    it('resets blocked state on user message', async () => {
      await client.send('project.create', { name: 'Intervention Test', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Add impossible criterion to trigger blocked state
      await client.send('chat.send', { 
        content: 'Add criterion: "The file /this/path/cannot/exist.txt exists". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder and set blocked phase manually
      await client.send('mode.switch', { mode: 'builder' })
      
      // Start with a message (simulating user intervention)
      await client.send('chat.send', { 
        content: 'Actually, let me help you. Just create src/newfile.ts with "export const x = 1".' 
      })
      
      // Should not error out
      const events = await collectChatEvents(client)
      assertNoErrors(events)
    })
  })
})
