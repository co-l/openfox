/**
 * Criteria System E2E Tests
 * 
 * Tests criterion CRUD operations and status transitions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'
import type { Criterion } from '@openfox/shared'

describe('Criteria System', () => {
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
    
    const restProject = await createProject(server.url, { name: 'Criteria Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Planner Criteria Tools', () => {
    describe('add_criterion', () => {
      it('adds a criterion with ID and description', async () => {
        await client.send('chat.send', { 
          content: 'Add criterion ID "test-1" with description "The tests pass". Use add_criterion.' 
        })
        
        const events = await collectChatEvents(client)
        assertNoErrors(events)
        
        const session = client.getSession()!
        expect(session.criteria.length).toBe(1)
        
        const criterion = session.criteria[0]!
        expect(criterion.id).toBe('test-1')
        expect(criterion.description).toContain('tests pass')
        expect(criterion.status.type).toBe('pending')
      })

      it('adds multiple criteria', async () => {
        await client.send('chat.send', { 
          content: `Add these criteria using add_criterion:
1. ID "crit-a": "First criterion"
2. ID "crit-b": "Second criterion"` 
        })
        
        await client.waitForChatDone()
        
        const session = client.getSession()!
        expect(session.criteria.length).toBe(2)
      })

      it('emits criteria.updated event', async () => {
        await client.send('chat.send', { 
          content: 'Add criterion ID "emit-test": "Testing events". Use add_criterion.' 
        })
        
        const events = await collectChatEvents(client)
        const criteriaEvents = events.get('criteria.updated')
        
        expect(criteriaEvents.length).toBeGreaterThan(0)
      })
    })

    describe('get_criteria', () => {
      it('returns current criteria list', async () => {
        // Add criteria first
        await client.send('chat.send', { 
          content: 'Add criterion ID "get-test": "For testing get". Use add_criterion.' 
        })
        await client.waitForChatDone()
        
        // Ask to get criteria
        await client.send('chat.send', { 
          content: 'Use get_criteria to show the current criteria.' 
        })
        
        await client.waitForChatDone()
        
        // Small delay to ensure all events are received (mock LLM is fast)
        await new Promise(r => setTimeout(r, 100))
        
        // Check all events for get_criteria tool call
        const allEvents = client.allEvents()
        const toolCallEvents = allEvents.filter(e => e.type === 'chat.tool_call')
        const getCriteriaCall = toolCallEvents.find(e => (e.payload as any).tool === 'get_criteria')
        expect(getCriteriaCall).toBeDefined()
        
        // Check for successful result
        const resultEvent = allEvents.find(e => 
          e.type === 'chat.tool_result' && 
          (e.payload as any).callId === (getCriteriaCall!.payload as any).callId
        )
        expect(resultEvent).toBeDefined()
        expect((resultEvent!.payload as any).result.success).toBe(true)
      })
    })

    describe('update_criterion', () => {
      it('updates criterion description', async () => {
        // Add criterion
        await client.send('chat.send', { 
          content: 'Add criterion ID "update-me": "Original description". Use add_criterion.' 
        })
        await client.waitForChatDone()
        
        // Update it
        await client.send('chat.send', { 
          content: 'Use update_criterion to change "update-me" description to "Updated description".' 
        })
        
        await client.waitForChatDone()
        
        // Wait for criteria.updated event to be processed
        await new Promise(r => setTimeout(r, 100))
        
        const session = client.getSession()!
        const criterion = session.criteria.find((c: { id: string }) => c.id === 'update-me')
        expect(criterion?.description).toContain('Updated')
      })
    })

    describe('remove_criterion', () => {
      it('removes a criterion by ID', async () => {
        // Add criterion
        await client.send('chat.send', { 
          content: 'Add criterion ID "remove-me": "Will be removed". Use add_criterion.' 
        })
        await client.waitForChatDone()
        
        // Wait for criteria.updated event
        await new Promise(r => setTimeout(r, 100))
        expect(client.getSession()!.criteria.length).toBe(1)
        
        // Remove it
        await client.send('chat.send', { 
          content: 'Use remove_criterion to remove "remove-me".' 
        })
        
        await client.waitForChatDone()
        
        // Wait for criteria.updated event
        await new Promise(r => setTimeout(r, 100))
        
        const session = client.getSession()!
        expect(session.criteria.find((c: { id: string }) => c.id === 'remove-me')).toBeUndefined()
      })
    })
  })

  describe('Builder Criteria Tools', () => {
    beforeEach(async () => {
      // Add criteria in planner mode
      await client.send('chat.send', { 
        content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Wait for criteria.updated event
      await new Promise(r => setTimeout(r, 100))
      
      // Switch to builder
      await client.send('mode.switch', { mode: 'builder' })
      await new Promise(r => setTimeout(r, 50))
    })

    describe('complete_criterion', () => {
      it('marks criterion as completed', async () => {
        await client.send('chat.send', { 
          content: 'Create the file src/utils.ts with any content, then call complete_criterion for "file-created".' 
        })
        
        const events = await collectChatEvents(client)
        
        // Wait for all events to be processed
        await new Promise(r => setTimeout(r, 100))
        
        // Check criteria.updated event
        const allEvents = client.allEvents()
        const criteriaEvents = allEvents.filter(e => e.type === 'criteria.updated')
        expect(criteriaEvents.length).toBeGreaterThan(0)
        
        const session = client.getSession()!
        const criterion = session.criteria[0]!
        expect(criterion.status.type).toBe('completed')
      })
    })
  })

  describe('Verifier Criteria Tools', () => {
    it('passes a completed criterion during verification', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use add_criterion.',
      })
      await client.waitForChatDone()

      await client.send('mode.switch', { mode: 'builder' })
      await client.send('runner.launch', {})
      await client.waitFor('phase.changed', (payload: unknown) => {
        return (payload as { phase: string }).phase === 'done'
      }, 1_500)

      const session = client.getSession()!
      expect(session.criteria[0]?.status.type).toBe('passed')
    })
  })

  describe('Manual Criteria Edit', () => {
    it('allows direct criteria editing via criteria.edit', async () => {
      // Add initial criterion
      await client.send('chat.send', { 
        content: 'Add criterion ID "edit-direct": "Initial". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Edit directly via protocol
      const newCriteria: Criterion[] = [
        {
          id: 'replaced-1',
          description: 'Completely replaced criterion',
          status: { type: 'pending' },
          attempts: [],
        },
        {
          id: 'replaced-2',
          description: 'Another replaced criterion',
          status: { type: 'pending' },
          attempts: [],
        },
      ]
      
      const response = await client.send('criteria.edit', { criteria: newCriteria })
      expect(response.type).toBe('ack')
      
      // Verify criteria were replaced
      const session = client.getSession()!
      expect(session.criteria.length).toBe(2)
      expect(session.criteria[0]!.id).toBe('replaced-1')
    })
  })

  describe('Status Transitions', () => {
    it('transitions: pending → in_progress → completed', async () => {
      // Add criterion
        await client.send('chat.send', { 
          content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.' 
        })
      await client.waitForChatDone()
      
      let session = client.getSession()!
      expect(session.criteria[0]!.status.type).toBe('pending')
      
      // Switch to builder and complete
      await client.send('mode.switch', { mode: 'builder' })
      await client.send('chat.send', { 
        content: 'Create the file src/utils.ts with any content, then call complete_criterion for "file-created".' 
      })
      await client.waitForChatDone()
      
      session = client.getSession()!
      expect(session.criteria[0]!.status.type).toBe('completed')
    })
  })

  describe('Criterion Persistence', () => {
    it('preserves criteria across session loads', async () => {
      // Add criteria
      await client.send('chat.send', { 
        content: 'Add criterion ID "persist-test": "Should persist". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      const sessionId = client.getSession()!.id
      
      // Load in new client
      const client2 = await createTestClient({ url: server.wsUrl })
      try {
        await client2.send('session.load', { sessionId })
        
        const session = client2.getSession()!
        expect(session.criteria.length).toBe(1)
        expect(session.criteria[0]!.id).toBe('persist-test')
      } finally {
        await client2.close()
      }
    })
  })
})
