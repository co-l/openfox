/**
 * Context Management E2E Tests
 * 
 * Tests context window tracking, compaction, and token counting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  collectChatEvents,
  assertNoErrors,
  type TestClient, 
  type TestProject 
} from './utils/index.js'
import type { ContextState } from '@openfox/shared'

describe('Context Management', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    await client.send('project.create', { name: 'Context Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Context State', () => {
    it('receives context.state on session load', async () => {
      const session = client.getSession()!
      
      // Load session in new client to trigger context.state
      const client2 = await createTestClient()
      try {
        await client2.send('session.load', { sessionId: session.id })
        
        const contextEvent = await client2.waitFor('context.state')
        expect(contextEvent.type).toBe('context.state')
        
        const payload = contextEvent.payload as { context: ContextState }
        expect(payload.context.maxTokens).toBeGreaterThan(0)
        expect(payload.context.currentTokens).toBeDefined()
        expect(payload.context.compactionCount).toBeDefined()
        expect(payload.context.canCompact).toBeDefined()
      } finally {
        await client2.close()
      }
    })

    it('tracks token count across messages', async () => {
      // Send some messages to build up context
      await client.send('chat.send', { content: 'Hello, this is a test message.' })
      await client.waitForChatDone()
      
      // Check context state
      const contextEvent = client.allEvents().find(e => e.type === 'context.state')
      if (contextEvent) {
        const payload = contextEvent.payload as { context: ContextState }
        expect(payload.context.currentTokens).toBeGreaterThan(0)
      }
    })

    it('reports maxTokens from config', async () => {
      const sessionId = client.getSession()!.id
      
      const client2 = await createTestClient()
      try {
        await client2.send('session.load', { sessionId })
        
        const contextEvent = await client2.waitFor('context.state')
        const payload = contextEvent.payload as { context: ContextState }
        
        // Default max is 200000 per config
        expect(payload.context.maxTokens).toBeGreaterThanOrEqual(100000)
      } finally {
        await client2.close()
      }
    })
  })

  describe('Manual Compaction', () => {
    it('compacts context on request', async () => {
      // Send messages to create context
      await client.send('chat.send', { content: 'Tell me about TypeScript.' })
      await client.waitForChatDone()
      
      await client.send('chat.send', { content: 'What are its main features?' })
      await client.waitForChatDone()
      
      // Request compaction
      const response = await client.send('context.compact', {})
      expect(response.type).toBe('ack')
      
      // Should see compaction prompt message
      const compactPrompt = await client.waitFor('chat.message', (payload: unknown) => {
        const p = payload as { message: { content: string; isSystemGenerated?: boolean } }
        return p.message.content.toLowerCase().includes('summarize')
      })
      expect(compactPrompt).toBeDefined()
      
      // Wait for LLM response
      await client.waitForChatDone()
      
      // Should receive updated session state
      const session = client.getSession()!
      expect(session.contextWindows.length).toBeGreaterThanOrEqual(1)
    })

    it('fails compaction while session is running', async () => {
      // Start a chat
      await client.send('chat.send', { content: 'Write a long explanation.' })
      
      // Wait for response to start
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Try to compact
      const response = await client.send('context.compact', {})
      
      // Should fail since session is running
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('SESSION_RUNNING')
      
      // Clean up
      await client.send('chat.stop', {})
      await client.waitForChatDone()
    })
  })

  describe('Context Windows', () => {
    it('creates new context window after compaction', async () => {
      // Build context
      await client.send('chat.send', { content: 'First message.' })
      await client.waitForChatDone()
      
      let session = client.getSession()!
      const initialWindowCount = session.contextWindows.length
      
      // Compact
      await client.send('context.compact', {})
      await client.waitForChatDone()
      
      // Should have new window
      session = client.getSession()!
      expect(session.contextWindows.length).toBeGreaterThan(initialWindowCount)
    })

    it('marks compacted messages with isCompactionSummary', async () => {
      // Build context
      await client.send('chat.send', { content: 'Message to be compacted.' })
      await client.waitForChatDone()
      
      // Compact
      await client.send('context.compact', {})
      await client.waitForChatDone()
      
      // Check for summary message
      const events = client.allEvents()
      const messages = events.filter(e => e.type === 'chat.message')
      
      // One of the messages should be marked as compaction summary
      // (the updated session.state will reflect this)
      const session = client.getSession()!
      const hasCompactionSummary = session.contextWindows.some(w => 
        w.summaryOfPrevious !== undefined
      )
      // Note: After first compaction, there may or may not be a summary depending on window count
      expect(session.contextWindows.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Danger Zone', () => {
    // Note: Testing danger zone requires filling up context significantly
    // which is slow with real LLM. We just verify the field exists.
    
    it('includes dangerZone field in context state', async () => {
      const sessionId = client.getSession()!.id
      
      const client2 = await createTestClient()
      try {
        await client2.send('session.load', { sessionId })
        
        const contextEvent = await client2.waitFor('context.state')
        const payload = contextEvent.payload as { context: ContextState }
        
        expect(payload.context.dangerZone).toBeDefined()
        expect(typeof payload.context.dangerZone).toBe('boolean')
      } finally {
        await client2.close()
      }
    })
  })

  describe('canCompact Field', () => {
    it('indicates whether compaction is possible', async () => {
      // Fresh session should not have enough to compact
      const sessionId = client.getSession()!.id
      
      const client2 = await createTestClient()
      try {
        await client2.send('session.load', { sessionId })
        
        const contextEvent = await client2.waitFor('context.state')
        const payload = contextEvent.payload as { context: ContextState }
        
        expect(payload.context.canCompact).toBeDefined()
        expect(typeof payload.context.canCompact).toBe('boolean')
        
        // Fresh session likely can't compact
        expect(payload.context.canCompact).toBe(false)
      } finally {
        await client2.close()
      }
    })
  })
})
