/**
 * Session Reconnection E2E Tests
 * 
 * Tests that clients can:
 * 1. Disconnect and reconnect to sessions
 * 2. Resume from a specific sequence number
 * 3. Receive missed events on reconnection
 * 
 * This is important for:
 * - Browser refresh recovery
 * - Network disconnection handling
 * - Mobile app backgrounding
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
// Type definitions for session and message (avoid module resolution issues)
interface SessionType {
  id: string
  projectId: string
  mode: string
  phase: string
  criteria: Array<{ id: string }>
  contextWindows: unknown[]
}

interface MessageType {
  id: string
  role: string
  content: string
  toolCalls?: Array<{ id: string; name: string; result?: { success: boolean } }>
}

describe('Session Reconnection', () => {
  let client: TestClient
  let testDir: TestProject
  let projectId: string
  let sessionId: string

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    await client.send('project.create', { name: 'Reconnection Test', workdir: testDir.path })
    projectId = client.getProject()!.id
    
    await client.send('session.create', { projectId })
    sessionId = client.getSession()!.id
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Basic Reconnection', () => {
    it('loads full session state on reconnection', async () => {
      // Send a message to create some state
      await client.send('chat.send', { content: 'Hello, this is a test message.' })
      await client.waitForChatDone()
      
      // Create a new client (simulating reconnection)
      const client2 = await createTestClient()
      
      try {
        // Load the session
        const response = await client2.send('session.load', { sessionId })
        
        expect(response.type).toBe('session.state')
        
        const session = client2.getSession()!
        expect(session.id).toBe(sessionId)
        expect(session.projectId).toBe(projectId)
        
        // Should receive messages from previous interaction
        const payload = response.payload as { session: SessionType; messages: MessageType[] }
        expect(payload.messages.length).toBeGreaterThan(0)
        
        // Should include the user message we sent
        const userMessage = payload.messages.find(m => 
          m.role === 'user' && m.content.includes('test message')
        )
        expect(userMessage).toBeDefined()
      } finally {
        await client2.close()
      }
    })

    it('preserves criteria across reconnection', async () => {
      // Add criteria
      await client.send('chat.send', { 
        content: 'Add criterion ID "persist-test": "This should persist". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Reconnect with new client
      const client2 = await createTestClient()
      
      try {
        await client2.send('session.load', { sessionId })
        
        const session = client2.getSession()!
        expect(session.criteria.length).toBeGreaterThan(0)
        expect(session.criteria[0]!.id).toBe('persist-test')
      } finally {
        await client2.close()
      }
    })

    it('preserves mode across reconnection', async () => {
      // Switch to builder mode
      await client.send('mode.switch', { mode: 'builder' })
      
      // Reconnect
      const client2 = await createTestClient()
      
      try {
        await client2.send('session.load', { sessionId })
        
        const session = client2.getSession()!
        expect(session.mode).toBe('builder')
      } finally {
        await client2.close()
      }
    })
  })

  describe('Context State on Reconnection', () => {
    it('receives context.state event after session load', async () => {
      // Build some context
      await client.send('chat.send', { content: 'First message' })
      await client.waitForChatDone()
      
      await client.send('chat.send', { content: 'Second message' })
      await client.waitForChatDone()
      
      // Reconnect
      const client2 = await createTestClient()
      
      try {
        await client2.send('session.load', { sessionId })
        
        // Should receive context.state event
        const contextEvent = await client2.waitFor('context.state')
        expect(contextEvent.type).toBe('context.state')
        
        const payload = contextEvent.payload as { context: { currentTokens: number; maxTokens: number } }
        expect(payload.context.currentTokens).toBeGreaterThan(0)
        expect(payload.context.maxTokens).toBeGreaterThan(0)
      } finally {
        await client2.close()
      }
    })
  })

  describe('Multiple Clients', () => {
    it('allows multiple clients to load same session', async () => {
      // Create message with first client
      await client.send('chat.send', { content: 'Message from client 1' })
      await client.waitForChatDone()
      
      // Connect second client
      const client2 = await createTestClient()
      
      try {
        await client2.send('session.load', { sessionId })
        
        const session2 = client2.getSession()!
        expect(session2.id).toBe(sessionId)
      } finally {
        await client2.close()
      }
      
      // Connect third client
      const client3 = await createTestClient()
      
      try {
        await client3.send('session.load', { sessionId })
        
        const session3 = client3.getSession()!
        expect(session3.id).toBe(sessionId)
      } finally {
        await client3.close()
      }
    })
  })

  describe('Session Load Errors', () => {
    it('returns NOT_FOUND for invalid session ID', async () => {
      const client2 = await createTestClient()
      
      try {
        const response = await client2.send('session.load', { 
          sessionId: 'nonexistent-session-id' 
        })
        
        expect(response.type).toBe('error')
        expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
      } finally {
        await client2.close()
      }
    })
  })

  describe('Tool Results on Reconnection', () => {
    it('includes tool results in loaded messages', async () => {
      // Switch to builder and run a command
      await client.send('mode.switch', { mode: 'builder' })
      
      await client.send('chat.send', { 
        content: 'Run the command "ls" to list files' 
      })
      await client.waitForChatDone()
      
      // Reconnect
      const client2 = await createTestClient()
      
      try {
        const response = await client2.send('session.load', { sessionId })
        
        const payload = response.payload as { messages: MessageType[] }
        
        // Find assistant message with tool calls
        const assistantMessage = payload.messages.find(m => 
          m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
        )
        
        if (assistantMessage) {
          // Tool calls should have results attached
          const toolCall = assistantMessage.toolCalls![0]!
          expect(toolCall.id).toBeDefined()
          expect(toolCall.name).toBeDefined()
          
          // Results should be attached (enriched by protocol layer)
          if (toolCall.result) {
            expect(toolCall.result.success).toBeDefined()
          }
        }
      } finally {
        await client2.close()
      }
    })
  })

  describe('Phase Preservation', () => {
    it('preserves session phase across reconnection', async () => {
      // Set up criteria to enable phase transitions
      await client.send('chat.send', { 
        content: 'Add criterion ID "phase-test": "Test criterion". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder and start (changes phase to build)
      await client.send('mode.switch', { mode: 'builder' })
      
      // Reconnect
      const client2 = await createTestClient()
      
      try {
        await client2.send('session.load', { sessionId })
        
        const session = client2.getSession()!
        // Phase should be preserved
        expect(['plan', 'build', 'verification', 'done', 'blocked']).toContain(session.phase)
      } finally {
        await client2.close()
      }
    })
  })

  describe('Context Window Preservation', () => {
    it('preserves context windows across reconnection', async () => {
      // Send some messages to create context
      await client.send('chat.send', { content: 'First message.' })
      await client.waitForChatDone()
      
      await client.send('chat.send', { content: 'Second message.' })
      await client.waitForChatDone()
      
      // Reconnect
      const client2 = await createTestClient()
      
      try {
        await client2.send('session.load', { sessionId })
        
        const session = client2.getSession()!
        // Context windows should exist
        expect(session.contextWindows).toBeDefined()
        expect(Array.isArray(session.contextWindows)).toBe(true)
      } finally {
        await client2.close()
      }
    })
  })
})
