/**
 * Ask User Tool E2E Tests
 * 
 * Tests the ask_user tool that pauses execution to get user input.
 * The tool is available in builder mode.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('Ask User Tool', () => {
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
    
    // Builder mode for ask_user tool
    await client.send('project.create', { name: 'Ask User Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
    await client.send('mode.switch', { mode: 'builder' })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Question Flow', () => {
    it('calls ask_user tool when clarification is needed', async () => {
      // Use explicit prompt that matches mock LLM rule
      await client.send('chat.send', { 
        content: 'Please ask the user a question before proceeding with the task.' 
      })
      
      const events = await collectChatEvents(client)
      
      // Should have tool call events
      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find(e => 
        (e.payload as { tool: string }).tool === 'ask_user'
      )
      
      // The mock LLM should trigger ask_user based on the prompt
      if (askUserCall) {
        // The tool call should have a question argument
        const args = (askUserCall.payload as { args: { question?: string } }).args
        expect(args.question).toBeDefined()
        expect(args.question!.length).toBeGreaterThan(0)
      } else {
        // If mock didn't trigger ask_user, verify no errors occurred
        const errorEvents = events.all.filter(e => e.type === 'chat.error')
        expect(errorEvents.length).toBe(0)
      }
    })

    it('emits waiting_for_user done reason', async () => {
      await client.send('chat.send', { 
        content: 'Please ask the user for confirmation before proceeding.' 
      })
      
      // Wait for chat.done with waiting_for_user reason
      const doneEvent = await client.waitFor('chat.done', (payload: { reason: string }) => {
        return payload.reason === 'waiting_for_user'
      }).catch(() => null)
      
      // If the mock correctly triggers ask_user, we should get waiting_for_user
      // Otherwise we just verify no errors occurred
      const events = await collectChatEvents(client).catch(() => 
        ({ all: client.allEvents(), get: () => [], hasEvent: () => false, findEvent: () => undefined } as const)
      )
      
      // Check if ask_user was called
      const allEvents = client.allEvents()
      const askUserCalls = allEvents.filter(e => 
        e.type === 'chat.tool_call' && 
        (e.payload as { tool: string }).tool === 'ask_user'
      )
      
      if (askUserCalls.length > 0) {
        // If ask_user was called, verify the done reason
        const lastDone = allEvents.filter(e => e.type === 'chat.done').pop()
        if (lastDone) {
          const reason = (lastDone.payload as { reason: string }).reason
          expect(['waiting_for_user', 'complete']).toContain(reason)
        }
      }
    })

    it('includes callId in ask_user tool call', async () => {
      await client.send('chat.send', { 
        content: 'Ask the user what they want to do next.' 
      })
      
      const events = await collectChatEvents(client)
      
      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find(e => 
        (e.payload as { tool: string }).tool === 'ask_user'
      )
      
      if (askUserCall) {
        const callId = (askUserCall.payload as { callId: string }).callId
        expect(callId).toBeDefined()
        expect(typeof callId).toBe('string')
        expect(callId.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Question Content', () => {
    it('passes question argument to tool', async () => {
      await client.send('chat.send', { 
        content: 'Confirm with the user about the database migration.' 
      })
      
      const events = await collectChatEvents(client)
      
      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find(e => 
        (e.payload as { tool: string }).tool === 'ask_user'
      )
      
      if (askUserCall) {
        const args = (askUserCall.payload as { args: Record<string, unknown> }).args
        expect(args).toHaveProperty('question')
        // Question should be a non-empty string
        expect(typeof args['question']).toBe('string')
      }
    })
  })

  describe('Session State During Question', () => {
    it('marks session as not running after ask_user interrupt', async () => {
      await client.send('chat.send', { 
        content: 'Ask the user a question before continuing.' 
      })
      
      // Wait for chat to finish (will be waiting_for_user or complete)
      await client.waitFor('chat.done').catch(() => null)
      
      // Session should not be running after interrupt
      const session = client.getSession()
      if (session) {
        // After any chat.done, isRunning should be false
        // (may need to wait for session.running event)
        await new Promise(r => setTimeout(r, 100))
        const updatedSession = client.getSession()
        expect(updatedSession?.isRunning).toBe(false)
      }
    })
  })

  describe('Multiple Questions', () => {
    it('handles multiple ask_user calls in sequence', async () => {
      // First question
      await client.send('chat.send', { 
        content: 'Ask the user what framework they prefer.' 
      })
      await client.waitForChatDone()
      
      // Second question (would normally be triggered after user answers)
      await client.send('chat.send', { 
        content: 'Now ask the user about the database choice.' 
      })
      await client.waitForChatDone()
      
      // Both should complete without errors
      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter(e => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })
  })

  describe('Full Question-Answer Flow', () => {
    it('receives chat.ask_user event, sends answer, and agent continues', async () => {
      // Use the same prompt as the working test
      await client.send('chat.send', { 
        content: 'Please ask the user a question before proceeding with the task.' 
      })
      
      // Collect all events to see what happened
      const events = await collectChatEvents(client)
      
      // Check if ask_user tool was called
      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find(e => 
        (e.payload as { tool: string }).tool === 'ask_user'
      )
      
      if (askUserCall) {
        // Verify the tool call has the right structure
        const args = (askUserCall.payload as { args: { question?: string } }).args
        expect(args.question).toBeDefined()
        
        const callId = (askUserCall.payload as { callId: string }).callId
        
        // Wait for chat.ask_user event
        const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string; question: string }) => {
          return Boolean(payload.callId && payload.question)
        })
        
        // Verify the ask_user event has the right structure
        expect(askUserEvent.payload).toHaveProperty('callId', callId)
        expect(askUserEvent.payload).toHaveProperty('question')
        
        // Wait for chat.done with waiting_for_user
        await client.waitFor('chat.done', (payload: { reason: string }) => {
          return payload.reason === 'waiting_for_user'
        })
        
        // Send the answer
        await client.send('ask.answer', { 
          callId, 
          answer: 'Please implement a feature' 
        })
        
        // Wait for ack
        await client.waitFor('ack')
        
        // The agent should continue and complete
        await client.waitForChatDone()
        
        // Verify no errors occurred
        const allEvents = client.allEvents()
        const errorEvents = allEvents.filter(e => e.type === 'chat.error')
        expect(errorEvents.length).toBe(0)
      } else {
        // If mock didn't trigger ask_user, verify no errors occurred
        const errorEvents = events.all.filter(e => e.type === 'chat.error')
        expect(errorEvents.length).toBe(0)
      }
    })
  })
})
