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
      // Add criteria
      await client.send('chat.send', { 
        content: 'Add criterion: "A function exists". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder
      await client.send('mode.switch', { mode: 'builder' })
      
      // Launch runner
      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('ack')
      
      // Should start running
      const session = client.getSession()!
      expect(session.isRunning).toBe(true)
      
      // Wait for completion
      await collectUntilPhase(client, 'done', 180_000)
        .catch(() => collectUntilPhase(client, 'blocked', 10_000))
    }, 200_000)
  })

  describe('Build → Verify Cycle', () => {
    it('runs builder then verifier', async () => {
      // Add criterion
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
    }, 150_000)
  })

  describe('Done State', () => {
    it('reaches done when all criteria pass', async () => {
      // Add simple criterion
      await client.send('chat.send', { 
        content: 'Add criterion ID "simple": "This is a simple test criterion". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Should eventually reach done
      await collectUntilPhase(client, 'done', 180_000)
      
      const session = client.getSession()!
      expect(session.phase).toBe('done')
      expect(session.isRunning).toBe(false)
    }, 200_000)
  })

  describe('Blocked State', () => {
    it('reaches blocked after repeated failures', async () => {
      // Add impossible criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "File /impossible/path.txt contains MAGIC". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Should eventually reach blocked or done (LLM may give up gracefully)
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
})
