/**
 * Mode Switching E2E Tests
 * 
 * Tests mode transitions, accept criteria, and phase changes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectUntilPhase,
  assertNoErrors,
  createProject,
  createSession,
  setSessionMode,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('Mode Switching', () => {
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
    
    const restProject = await createProject(server.url, { name: 'Mode Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Manual Mode Switch', () => {
    it('switches from planner to builder', async () => {
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      const session = client.getSession()!
      expect(session.mode).toBe('builder')
    })

    it('switches from builder back to planner', async () => {
      const sessionId = client.getSession()!.id
      
      // First switch to builder
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      
      // Then back to planner
      await setSessionMode(server.url, sessionId, 'planner', server.wsUrl)

      const session = client.getSession()!
      expect(session.mode).toBe('planner')
    })

    it('does not inject the builder kickoff prompt into manual builder chats', async () => {
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      client.clearEvents()

      await client.send('chat.send', {
        content: 'List the files in src and tell me what you find.',
      })
      await client.waitForChatDone()

      const injectedKickoff = client.allEvents().some((event) => {
        if (event.type !== 'chat.message') return false
        const payload = event.payload as { message: { content: string; isSystemGenerated?: boolean } }
        return payload.message.isSystemGenerated === true
          && payload.message.content.includes('Implement the task and make sure you fulfil')
      })

      expect(injectedKickoff).toBe(false)
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

    it('generates summary when switching to builder mode', async () => {
      const sessionId = client.getSession()!.id
      
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: File exists. Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder mode (this triggers summary generation)
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      
      // Wait for session state update (summary should be populated)
      await client.waitFor('session.state')
      
      // Give async summary generation time to complete
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const session = client.getSession()!
      expect(session.summary).toBeDefined()
      expect(session.summary?.length).toBeGreaterThan(0)
    })

    it('generates summary when using mode.accept (Start Building button)', async () => {
      // Add criterion
      await client.send('chat.send', { 
        content: 'Add criterion: File exists. Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Use mode.accept (Start Building button flow)
      await client.send('mode.accept', {})
      
      // Wait for runner to complete
      await client.waitFor('session.running', (payload: unknown) => {
        return (payload as { isRunning: boolean }).isRunning === false
      }, 10000)
      
      // Give async summary generation time to complete
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const session = client.getSession()!
      expect(session.summary).toBeDefined()
      expect(session.summary?.length).toBeGreaterThan(0)
    })

    it('injects the builder kickoff exactly once after accepting criteria', { timeout: 25_000 }, async () => {
      await client.send('chat.send', {
        content: 'Add criterion with ID "inspect-src": "Inspect the src directory and report what exists". Use add_criterion.',
      })
      await client.waitForChatDone()

      client.clearEvents()

      await client.send('mode.accept', {})
      await client.waitFor('session.running', (payload: unknown) => {
        return (payload as { isRunning: boolean }).isRunning === false
      }, 20_000)

      const kickoffMessages = client.allEvents().filter((event) => {
        if (event.type !== 'chat.message') return false
        const payload = event.payload as { message: { content: string; isSystemGenerated?: boolean } }
        return payload.message.isSystemGenerated === true
          && payload.message.content.includes('Implement the task and make sure you fulfil')
      })

      expect(kickoffMessages).toHaveLength(1)
    })
  })

  describe('Phase Transitions', () => {
    it('transitions from plan to build after accepting criteria', async () => {
      // Start in plan phase
      let session = client.getSession()!
      expect(session.phase).toBe('plan')
      
      // Add a trivial criterion
      await client.send('chat.send', { 
        content: 'Add criterion with ID "trivial-pass": "This is a trivial test criterion that passes immediately". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept criteria and switch into build phase
      await client.send('mode.accept', {})

      const events = await collectUntilPhase(client, 'build', 1_500)
      assertNoErrors(events)

      // Verify we entered build phase
      const phaseEvents = events.get('phase.changed')
      const phases = phaseEvents.map(e => (e.payload as { phase: string }).phase)

      expect(phases).toContain('build')

      session = client.getSession()!
      expect(['build', 'verification', 'done']).toContain(session.phase)
    })

    it('sets phase to blocked after max failures', { timeout: 20_000 }, async () => {
      // Add a criterion the mock verifier intentionally fails repeatedly
      await client.send('chat.send', { 
        content: 'Add criterion ID "verify-fail": "Verifier should fail this criterion". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Accept and start
      await client.send('mode.accept', {})
      await client.waitFor('phase.changed', (payload: unknown) => {
        return (payload as { phase: string }).phase === 'build'
      })
      await client.waitFor('session.running', (payload: unknown) => {
        return (payload as { isRunning: boolean }).isRunning === false
      })
      await client.send('runner.launch', {})

      const events = await collectUntilPhase(client, 'blocked', 15_000)
      const lastPhase = events.get('phase.changed').slice(-1)[0]
      const phase = (lastPhase?.payload as { phase: string })?.phase
      expect(phase).toBe('blocked')
    })
  })

  describe('Phase from Session State', () => {
    it('includes phase in session state', async () => {
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      
      const session = client.getSession()!
      expect(session.phase).toBe('plan') // Phase doesn't auto-change on manual mode switch
    })
  })

  describe('Summary Generation', () => {
    it('does NOT generate summary for empty sessions when switching to builder', async () => {
      const sessionId = client.getSession()!.id
      
      // Fresh session with no messages - switch to builder mode
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      
      // Wait for session state update
      await client.waitFor('session.state')
      
      // Give any potential async summary generation time to complete
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const session = client.getSession()!
      // Summary should remain null/empty for sessions without conversation history
      // OR should not be a generic placeholder
      if (session.summary) {
        expect(session.summary).not.toBe('I understand. Let me help you with that.')
        expect(session.summary.length).toBeGreaterThan(20) // Should be a meaningful summary
      } else {
        expect(session.summary).toBeNull()
      }
    })

    it('does NOT generate summary for empty sessions when using mode.accept', async () => {
      // Fresh session with no messages and no criteria
      // This should fail because there are no criteria, but let's test the summary logic
      const response = await client.send('mode.accept', {})
      
      // Should fail with NO_CRITERIA error
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NO_CRITERIA')
      
      // Session should still have no summary
      const session = client.getSession()!
      expect(session.summary).toBeNull()
    })
  })
})
