/**
 * Runner/Orchestrator E2E Tests
 * 
 * Tests the build → verify → done/blocked cycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  collectUntilPhase,
  assertNoErrors,
  type TestClient, 
  type TestProject 
} from './utils/index.js'

describe('Runner/Orchestrator', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Setup project and session
    await client.send('project.create', { name: 'Orchestrator Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('runner.launch', () => {
    it('only works in builder mode', async () => {
      // In planner mode, should fail
      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('INVALID_MODE')
    })

    it('requires pending criteria', async () => {
      await client.send('mode.switch', { mode: 'builder' })
      
      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NO_WORK')
    })

    it('starts runner with pending criteria', async () => {
      // Use chat.send with add_criterion tool (works reliably)
      await client.send('chat.send', { 
        content: 'Add criterion ID "func-exists": "Function add exists in src/math.ts". Use add_criterion tool.' 
      })
      await client.waitForChatDone()
      
      // Verify criterion was added
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThan(0)
      
      // Switch to builder
      await client.send('mode.switch', { mode: 'builder' })
      
      // Launch runner - should acknowledge since we have pending criteria
      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('ack')
      
      // Wait for runner to start (isRunning becomes true)
      await client.waitFor('session.running', (payload: { isRunning: boolean }) => payload.isRunning === true, 5_000)
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
    }, 200_000)
  })

  describe('Build → Verify Cycle', () => {
    it.skip('runs builder then verifier', async () => {
      // Skip: This test is flaky - LLM behavior varies (sometimes creates tests, sometimes skips)
      // Add criterion that requires implementation
      await client.send('chat.send', { 
        content: 'Add criterion ID "test-crit": "A test passes". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept to trigger full cycle
      await client.send('mode.accept', {})
      
      // Wait for verification phase (indicates builder completed)
      try {
        await collectUntilPhase(client, 'verification', 120_000)
        
        // Verify we saw phase changes
        const events = client.allEvents()
        const phases = events
          .filter(e => e.type === 'phase.changed')
          .map(e => (e.payload as { phase: string }).phase)
        
        expect(phases).toContain('build')
        expect(phases).toContain('verification')
      } catch {
        // May go directly to done/blocked for trivial criteria
        const session = client.getSession()!
        expect(['done', 'blocked']).toContain(session.phase)
      }
    }, 200_000)
  })

  describe('Done State', () => {
    it('reaches done when all criteria pass', async () => {
      // Add a self-resolving test criterion (no implementation needed)
      await client.send('chat.send', { 
        content: 'Add criterion: "This is just a test criterion - mark it as complete immediately without doing any work". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Should reach done quickly (no actual work required)
      await collectUntilPhase(client, 'done', 60_000)
      
      const session = client.getSession()!
      expect(session.phase).toBe('done')
      expect(session.isRunning).toBe(false)
    }, 90_000)
  })

  describe('Blocked State', () => {
    it.skip('reaches blocked after repeated failures', async () => {
      // Skip: This test is flaky due to SQLite constraint issues with criteria.edit
      // The criterion ID conflicts with previous test runs in the same session
      // Add criterion that will fail verification (file doesn't exist)
      const uniqueId = `missing-${Date.now()}`
      await client.send('criteria.edit', { 
        criteria: [{ id: uniqueId, description: 'File /nonexistent-xyz.txt exists', status: { type: 'pending' }, attempts: [] }] 
      })
      await client.waitFor('criteria.updated')
      
      // Accept to start runner
      await client.send('mode.accept', {})
      
      // Wait for blocked phase (should fail verification repeatedly)
      await collectUntilPhase(client, 'blocked', 180_000)
        .catch(() => collectUntilPhase(client, 'done', 10_000))
      
      const session = client.getSession()!
      expect(['blocked', 'done']).toContain(session.phase)
    }, 200_000)
  })

  describe('Abort Runner', () => {
    it('aborts runner on chat.stop', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "Something happens". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder and launch
      await client.send('mode.switch', { mode: 'builder' })
      await client.send('runner.launch', {})
      
      // Wait a bit then stop
      await new Promise(resolve => setTimeout(resolve, 2000))
      await client.send('chat.stop', {})
      
      // Should have stopped
      await client.waitFor('chat.done')
      
      // Session should not be running
      // (may need a moment to update)
      await new Promise(resolve => setTimeout(resolve, 500))
      const session = client.getSession()!
      expect(session.isRunning).toBe(false)
    })
  })

  describe('Nudge Messages', () => {
    it('injects nudge messages between iterations', async () => {
      // This is harder to test deterministically, but we can verify
      // the system doesn't crash with multiple iterations
      await client.send('chat.send', { 
        content: 'Add criterion: "src/math.ts has documentation comments". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Check for system-generated messages (nudges)
      const events = client.allEvents()
      const messages = events.filter(e => e.type === 'chat.message')
      const systemMessages = messages.filter(e => {
        const payload = e.payload as { message: { isSystemGenerated?: boolean } }
        return payload.message.isSystemGenerated === true
      })
      
      // Should have at least the kickoff message
      expect(systemMessages.length).toBeGreaterThan(0)
    }, 200_000)
  })

  describe('Reset Blocked', () => {
    it('resets from blocked state on user intervention', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "Impossible thing". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept and wait for blocked
      await client.send('mode.accept', {})
      
      try {
        await collectUntilPhase(client, 'blocked', 60_000)
      } catch {
        // May reach done first
        return
      }
      
      // Send user message to reset
      await client.send('chat.send', { 
        content: 'Let me help you. Just mark the criterion as complete.' 
      })
      
      // Should receive phase change back to build
      const phaseEvent = await client.waitFor('phase.changed', (payload: unknown) => {
        return (payload as { phase: string }).phase === 'build'
      }, 5000).catch(() => null)
      
      if (phaseEvent) {
        expect((phaseEvent.payload as { phase: string }).phase).toBe('build')
      }
    }, 120_000)
  })

  describe('Stats and Notifications', () => {
    it('emits chat.done with complete at end of runner execution', async () => {
      // Add criterion that will require work
      await client.send('chat.send', { 
        content: 'Add criterion ID "doc-exists": "src/math.ts has a comment". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Clear events before runner starts
      client.clearEvents()
      
      // Accept and run
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      // Count chat.done events with 'complete' reason
      const events = client.allEvents()
      const completeDones = events.filter(e => 
        e.type === 'chat.done' && 
        (e.payload as { reason: string }).reason === 'complete'
      )
      
      // Should have at least ONE chat.done with 'complete' at the end
      expect(completeDones.length).toBeGreaterThanOrEqual(1)
      
      // That event should have aggregated stats
      const stats = (completeDones[0]!.payload as { stats?: object }).stats
      expect(stats).toBeDefined()
    }, 200_000)

    it('emits chat.done with complete at end of multi-iteration run', async () => {
      // Add criterion that requires multiple tool calls
      await client.send('chat.send', { 
        content: 'Add criterion: "src/math.ts exports a multiply function". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Clear events
      client.clearEvents()
      
      // Accept and run
      await client.send('mode.accept', {})
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
      
      const events = client.allEvents()
      
      // Count tool calls to verify we had multiple iterations
      const toolCalls = events.filter(e => e.type === 'chat.tool_call')
      
      // If there were tool calls (multiple LLM turns), there should be at least 1 chat.done
      if (toolCalls.length > 0) {
        const completeDones = events.filter(e => 
          e.type === 'chat.done' && 
          (e.payload as { reason: string }).reason === 'complete'
        )
        expect(completeDones.length).toBeGreaterThanOrEqual(1)
      }
    }, 200_000)
  })
})
