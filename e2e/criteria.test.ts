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
      it('adds a criterion with auto-generated ID', async () => {
        await client.send('chat.send', { 
          content: 'Add a criterion using the criterion tool with action "add".' 
        })
        
        const events = await collectChatEvents(client)
        assertNoErrors(events)
        
        const session = client.getSession()!
        expect(session.criteria.length).toBe(1)
        
        const criterion = session.criteria[0]!
        expect(criterion.id).toBe('0')
        expect(criterion.description).toBe('Test criterion')
        expect(criterion.status.type).toBe('pending')
      })

      it('adds multiple criteria with auto-incrementing IDs', async () => {
        // Add two criteria with separate prompts
        await client.send('chat.send', { 
          content: 'Add a criterion using the criterion tool with action "add".' 
        })
        await client.waitForChatDone()
        
        await client.send('chat.send', { 
          content: 'Add another criterion using the criterion tool with action "add".' 
        })
        await client.waitForChatDone()
        
        const session = client.getSession()!
        expect(session.criteria.length).toBe(2)
        expect(session.criteria[0]!.id).toBe('0')
        expect(session.criteria[1]!.id).toBe('1')
      })

      it('emits criteria.updated event', async () => {
        await client.send('chat.send', { 
          content: 'Add a criterion with description "Testing events". Use add_criterion.' 
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
          content: 'Add a criterion with description "For testing get".' 
        })
        await client.waitForChatDone()
        
        // Ask to get criteria
        await client.send('chat.send', { 
          content: 'Show the current criteria.' 
        })
        
        await client.waitForChatDone()
        
        // Small delay to ensure all events are received (mock LLM is fast)
        await new Promise(r => setTimeout(r, 100))
        
        // Check all events for criterion tool call with action "get"
        const allEvents = client.allEvents()
        const toolCallEvents = allEvents.filter(e => e.type === 'chat.tool_call')
        const getCriteriaCall = toolCallEvents.find(e => {
          const payload = e.payload as any
          return payload.tool === 'criterion' && payload.args?.action === 'get'
        })
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
          content: 'Add a criterion with description "Original description".' 
        })
        await client.waitForChatDone()
        
        // Update it
        await client.send('chat.send', { 
          content: 'Use update_criterion to change the first criterion (ID "0") description to "Updated description".' 
        })
        
        await client.waitForChatDone()
        
        // Wait for criteria.updated event to be processed
        await new Promise(r => setTimeout(r, 100))
        
        const session = client.getSession()!
        const criterion = session.criteria.find((c: { id: string }) => c.id === '0')
        expect(criterion?.description).toContain('Updated')
      })
    })

    describe('remove_criterion', () => {
      it('removes a criterion by ID', async () => {
        // Add criterion
        await client.send('chat.send', { 
          content: 'Add a criterion with description "Will be removed".' 
        })
        await client.waitForChatDone()
        
        // Wait for criteria.updated event
        await new Promise(r => setTimeout(r, 100))
        expect(client.getSession()!.criteria.length).toBe(1)
        
        // Remove it
        await client.send('chat.send', { 
          content: 'Use remove_criterion to remove the first criterion (ID "0").' 
        })
        
        await client.waitForChatDone()
        
        // Wait for criteria.updated event
        await new Promise(r => setTimeout(r, 100))
        
        const session = client.getSession()!
        expect(session.criteria.length).toBe(0)
      })
    })
  })

  describe('Builder Criteria Tools', () => {
    beforeEach(async () => {
      // Add criteria in planner mode
      await client.send('chat.send', { 
        content: 'Add a criterion with description "A new file utils.ts exists".' 
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
          content: 'Create the file src/utils.ts with any content, then call criterion with action "complete" for the first criterion (ID "0").' 
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
    it.skip('passes a completed criterion during verification', async () => {
      // Skipped: requires complex mock LLM setup for verifier workflow
      const session = client.getSession()!
      expect(session.criteria.length).toBe(0)
    })
  })

  describe('Manual Criteria Edit', () => {
    it('allows direct criteria editing via criteria.edit', async () => {
      // Add initial criterion
      await client.send('chat.send', { 
        content: 'Add a criterion with description "Initial".' 
      })
      await client.waitForChatDone()
      
      // Edit directly via protocol
      const newCriteria: Criterion[] = [
        {
          id: '0',
          description: 'Completely replaced criterion',
          status: { type: 'pending' },
          attempts: [],
        },
        {
          id: '1',
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
      expect(session.criteria[0]!.id).toBe('0')
    })
  })

  describe('Status Transitions', () => {
    it.skip('transitions: pending → in_progress → completed', async () => {
      // Skipped: requires complex mock LLM setup
      const session = client.getSession()!
      expect(session.criteria.length).toBe(0)
    })
  })

  describe('Criterion Persistence', () => {
    it('preserves criteria across session loads', async () => {
      // Add criteria
      await client.send('chat.send', { 
        content: 'Add a criterion with description "Should persist".' 
      })
      await client.waitForChatDone()
      
      const sessionId = client.getSession()!.id
      
      // Load in new client
      const client2 = await createTestClient({ url: server.wsUrl })
      try {
        await client2.send('session.load', { sessionId })
        
        const session = client2.getSession()!
        expect(session.criteria.length).toBe(1)
        expect(session.criteria[0]!.id).toBe('0')
      } finally {
        await client2.close()
      }
    })
  })
})
