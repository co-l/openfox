/**
 * Mode Switching E2E Tests
 * 
 * Tests mode transitions, accept criteria, and phase changes.
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

describe('Mode Switching', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Create project and session
    await client.send('project.create', { name: 'Mode Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Manual Mode Switch', () => {
    it('switches from planner to builder', async () => {
      const response = await client.send('mode.switch', { mode: 'builder' })
      
      expect(response.type).toBe('mode.changed')
      const payload = response.payload as { mode: string; auto: boolean }
      expect(payload.mode).toBe('builder')
      expect(payload.auto).toBe(false)
      
      const session = client.getSession()!
      expect(session.mode).toBe('builder')
    })

    it('switches from builder back to planner', async () => {
      // First switch to builder
      await client.send('mode.switch', { mode: 'builder' })
      
      // Then back to planner
      const response = await client.send('mode.switch', { mode: 'planner' })
      
      expect(response.type).toBe('mode.changed')
      const session = client.getSession()!
      expect(session.mode).toBe('planner')
    })
  })

  describe('Accept Criteria (mode.accept)', () => {
    it('fails without criteria defined', async () => {
      const response = await client.send('mode.accept', {})
      
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NO_CRITERIA')
    })

    it('generates summary and starts builder with criteria', async () => {
      // First add some criteria via planner
      await client.send('chat.send', { 
        content: 'Add a simple criterion: "test criterion". Use add_criterion tool.' 
      })
      await client.waitForChatDone()
      
      // Verify criterion was added
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThan(0)
      
      // Accept and start builder
      const response = await client.send('mode.accept', {})
      expect(response.type).toBe('ack')
      
      // Should receive mode.changed event
      const modeEvent = await client.waitFor('mode.changed')
      const modePayload = modeEvent.payload as { mode: string; auto: boolean }
      expect(modePayload.mode).toBe('builder')
      expect(modePayload.auto).toBe(false)
      
      // Should receive phase.changed event
      const phaseEvent = await client.waitFor('phase.changed')
      const phasePayload = phaseEvent.payload as { phase: string }
      expect(phasePayload.phase).toBe('build')
    })

    it('generates summary message before switching', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: File exists. Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      client.clearEvents()
      
      // Accept
      await client.send('mode.accept', {})
      
      // Wait for summary request message (auto-prompt)
      const summaryPrompt = await client.waitFor('chat.message', (payload: unknown) => {
        const p = payload as { message: { content: string; isSystemGenerated?: boolean } }
        return p.message.isSystemGenerated === true && 
               p.message.content.includes('summary')
      })
      expect(summaryPrompt).toBeDefined()
    })
  })

  describe('Phase Transitions', () => {
    it('transitions through plan → build → verification → done', async () => {
      // Start in plan phase
      let session = client.getSession()!
      expect(session.phase).toBe('plan')
      
      // Add a trivial criterion
      await client.send('chat.send', { 
        content: 'Add criterion with ID "trivial-pass": "This is a trivial test criterion that passes immediately". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept and start runner
      await client.send('mode.accept', {})
      
      // Should go through build → verification → done
      // (For a trivial criterion, this should be fast)
      const events = await collectUntilPhase(client, 'done', 120_000)
      assertNoErrors(events)
      
      // Verify we saw phase changes
      const phaseEvents = events.get('phase.changed')
      const phases = phaseEvents.map(e => (e.payload as { phase: string }).phase)
      
      expect(phases).toContain('build')
      // Note: might not see 'verification' if criterion is trivial
      expect(phases).toContain('done')
    })

    it('sets phase to blocked after max failures', async () => {
      // Add an impossible criterion
      await client.send('chat.send', { 
        content: 'Add criterion: "The file /impossible/path/that/does/not/exist.txt contains the text MAGIC". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept and start
      await client.send('mode.accept', {})
      
      // Should eventually get blocked (or done if LLM gives up gracefully)
      const events = await collectUntilPhase(client, 'blocked', 180_000)
        .catch(() => collectUntilPhase(client, 'done', 10_000))
      
      // Either blocked or done is acceptable
      const lastPhase = events.get('phase.changed').slice(-1)[0]
      const phase = (lastPhase?.payload as { phase: string })?.phase
      expect(['blocked', 'done']).toContain(phase)
    })
  })

  describe('Phase from Session State', () => {
    it('includes phase in session state', async () => {
      await client.send('mode.switch', { mode: 'builder' })
      
      const session = client.getSession()!
      expect(session.phase).toBe('plan') // Phase doesn't auto-change on manual mode switch
    })
  })
})
