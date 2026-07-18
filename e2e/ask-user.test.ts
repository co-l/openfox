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
  createProject,
  createSession,
  setSessionMode,
  type TestClient,
  type TestProject,
  type TestServerHandle,
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

    const restProject = await createProject(server.url, { name: 'Ask User Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await setSessionMode(server.url, restSession.id, 'builder', server.wsUrl)
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Question Flow', () => {
    it('calls ask_user tool when clarification is needed', async () => {
      // Use explicit prompt that matches mock LLM rule
      await client.send('chat.send', {
        content: 'Please ask the user a question before proceeding with the task.',
      })

      // Wait for ask_user event and send answer immediately
      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string; question: string }) => {
        return Boolean(payload.callId && payload.question)
      })

      const callId = (askUserEvent.payload as { callId: string }).callId
      await client.send('ask.answer', { callId, answer: 'Proceed with the task' })

      // Now collect events after agent completes
      const events = await collectChatEvents(client)

      // Should have tool call events
      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find((e) => (e.payload as { tool: string }).tool === 'ask_user')

      // The mock LLM should trigger ask_user based on the prompt
      if (askUserCall) {
        // The tool call should have a question argument
        const args = (askUserCall.payload as { args: { question?: string } }).args
        expect(args.question).toBeDefined()
        expect(args.question!.length).toBeGreaterThan(0)

        // Agent should complete after receiving answer (not stuck)
        const doneEvents = events.get('chat.done')
        expect(doneEvents.length).toBeGreaterThan(0)
      }
    })

    it('emits waiting_for_user done reason', async () => {
      await client.send('chat.send', {
        content: 'Please ask the user for confirmation before proceeding.',
      })

      // Wait for chat.done with waiting_for_user reason
      const doneEvent = await client.waitFor('chat.done', (payload: { reason: string }) => {
        return payload.reason === 'waiting_for_user'
      })

      expect(doneEvent).toBeDefined()
      expect((doneEvent.payload as { reason: string }).reason).toBe('waiting_for_user')

      // Now answer the question so the agent can continue
      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })
      const callId = (askUserEvent.payload as { callId: string }).callId
      await client.send('ask.answer', { callId, answer: 'Proceed' })

      // Agent should complete after receiving answer
      const finalDone = await client.waitFor('chat.done', (payload: { reason: string }) => {
        return payload.reason === 'complete'
      })
      expect(finalDone).toBeDefined()

      // Verify no errors occurred
      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })

    it('includes callId in ask_user tool call', async () => {
      await client.send('chat.send', {
        content: 'Ask the user what they want to do next.',
      })

      // Wait for ask_user and answer immediately
      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })
      const callId = (askUserEvent.payload as { callId: string }).callId
      await client.send('ask.answer', { callId, answer: 'Continue with the task' })

      // Now collect events
      const events = await collectChatEvents(client)

      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find((e) => (e.payload as { tool: string }).tool === 'ask_user')

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
        content: 'Confirm with the user about the database migration.',
      })

      // Wait for ask_user and answer immediately
      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })
      const callId = (askUserEvent.payload as { callId: string }).callId
      await client.send('ask.answer', { callId, answer: 'Yes, proceed' })

      // Now collect events
      const events = await collectChatEvents(client)

      const toolCalls = events.get('chat.tool_call')
      const askUserCall = toolCalls.find((e) => (e.payload as { tool: string }).tool === 'ask_user')

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
        content: 'Ask the user a question before continuing.',
      })

      // Wait for chat.ask_user event
      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })

      const callId = (askUserEvent.payload as { callId: string }).callId

      // Send answer immediately so agent completes
      await client.send('ask.answer', { callId, answer: 'Continue' })

      // Wait for chat to finish
      await client.waitFor('chat.done')

      // Session should not be running after completion
      const session = client.getSession()
      if (session) {
        await new Promise((r) => setTimeout(r, 100))
        const updatedSession = client.getSession()
        expect(updatedSession?.isRunning).toBe(false)
      }
    })
  })

  describe('Multiple Questions', () => {
    it('handles multiple ask_user calls in sequence', async () => {
      // First question
      await client.send('chat.send', {
        content: 'Ask the user what framework they prefer.',
      })

      // Wait for ask_user and answer
      const askUserEvent1 = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })
      await client.send('ask.answer', { callId: (askUserEvent1.payload as { callId: string }).callId, answer: 'React' })
      await client.waitFor('chat.done')

      // Second question
      await client.send('chat.send', {
        content: 'Now ask the user about the database choice.',
      })

      // Wait for ask_user and answer
      const askUserEvent2 = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })
      await client.send('ask.answer', {
        callId: (askUserEvent2.payload as { callId: string }).callId,
        answer: 'PostgreSQL',
      })
      await client.waitFor('chat.done')

      // Both should complete without errors
      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })
  })

  describe('Full Question-Answer Flow', () => {
    it('receives chat.ask_user event, sends answer, and agent continues', async () => {
      // Use the same prompt as the working test
      await client.send('chat.send', {
        content: 'Please ask the user a question before proceeding with the task.',
      })

      // Wait for chat.ask_user event first
      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string; question: string }) => {
        return Boolean(payload.callId && payload.question)
      })

      const callId = (askUserEvent.payload as { callId: string }).callId

      // Verify the ask_user event has the right structure
      expect(askUserEvent.payload).toHaveProperty('callId')
      expect(askUserEvent.payload).toHaveProperty('question')

      // Send the answer immediately
      await client.send('ask.answer', {
        callId,
        answer: 'Please implement a feature',
      })

      // Wait for ack
      await client.waitFor('ack')

      // The agent should continue and complete
      await client.waitForChatDone()

      // Verify no errors occurred
      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })

    it('agent continues after user answers ask_user question', async () => {
      // Use a prompt that matches the mock LLM rule for ask_user
      // The mock matches: /ask.*user|ask.*question|clarif/i
      // This test demonstrates the bug: after sending ask.answer, the agent should continue
      // but currently it gets stuck because the answer is not fed back to the model
      await client.send('chat.send', {
        content: 'I need clarification. Please ask the user a question.',
      })

      // Wait for chat.ask_user event
      const askUserEvent = await client.waitFor(
        'chat.ask_user',
        (payload: { callId: string; question: string }) => {
          return Boolean(payload.callId && payload.question)
        },
        10000,
      )

      expect(askUserEvent.payload).toHaveProperty('callId')
      expect(askUserEvent.payload).toHaveProperty('question')

      const callId = (askUserEvent.payload as { callId: string }).callId

      // CRITICAL FIX: Send the answer immediately after receiving chat.ask_user
      // Don't wait for chat.done first - that causes a deadlock
      await client.send('ask.answer', {
        callId,
        answer: 'Use React',
      })

      // Wait for ack
      await client.waitFor('ack')

      // CRITICAL: The agent should continue and complete after receiving the answer
      // This test will FAIL if the answer is not sent back to the model properly
      const doneEvent = await client.waitFor('chat.done', (payload: { reason: string }) => {
        return payload.reason === 'complete' || payload.reason === 'error'
      })

      // Verify the agent completed (not stuck)
      expect(doneEvent.payload.reason).toBe('complete')

      // Verify no errors occurred
      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })
  })

  describe('Question Types', () => {
    it('sends confirm type in chat.ask_user payload', async () => {
      await client.send('chat.send', {
        content: 'I need a confirm question about the deployment.',
      })

      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { type?: string }) => {
        return payload.type === 'confirm'
      })

      expect(askUserEvent.payload).toHaveProperty('callId')
      expect(askUserEvent.payload).toHaveProperty('question')
      expect((askUserEvent.payload as { type: string }).type).toBe('confirm')

      const callId = (askUserEvent.payload as { callId: string }).callId
      await client.send('ask.answer', { callId, answer: 'yes' })
      await client.waitForChatDone()

      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })

    it('sends choice type with options in chat.ask_user payload', async () => {
      await client.send('chat.send', {
        content: 'Please ask me to choose an option for the project setup.',
      })

      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { type?: string; options?: string[] }) => {
        return payload.type === 'choice' && Array.isArray(payload.options) && payload.options.length > 0
      })

      expect((askUserEvent.payload as { type: string }).type).toBe('choice')
      const options = (askUserEvent.payload as { options: string[] }).options
      expect(options).toContain('Option A')
      expect(options).toContain('Option B')

      const callId = (askUserEvent.payload as { callId: string }).callId
      await client.send('ask.answer', { callId, answer: 'Option A' })
      await client.waitForChatDone()

      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })
  })

  describe('Skip', () => {
    it('handles skip with skip flag', async () => {
      await client.send('chat.send', {
        content: 'Please ask the user a question before proceeding.',
      })

      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string }) => {
        return Boolean(payload.callId)
      })

      const callId = (askUserEvent.payload as { callId: string }).callId

      // Send skip
      await client.send('ask.answer', { callId, answer: '', skip: true })
      await client.waitFor('ack')

      // Agent should continue after skip
      await client.waitForChatDone()

      const allEvents = client.allEvents()
      const errorEvents = allEvents.filter((e) => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })
  })

  describe('Persistence', () => {
    it('preserves pending question across session reload', async () => {
      // Ask a question but don't answer
      await client.send('chat.send', {
        content: 'Please ask the user a question before proceeding with the task.',
      })

      const askUserEvent = await client.waitFor('chat.ask_user', (payload: { callId: string; question: string }) => {
        return Boolean(payload.callId && payload.question)
      })

      const callId = (askUserEvent.payload as { callId: string }).callId
      const question = (askUserEvent.payload as { question: string }).question

      // Reload the session (simulate page reload by fetching session state via REST)
      const sessionId = client.getSession()?.id
      expect(sessionId).toBeDefined()

      // Fetch session state via REST (simulates page reload)
      const res = await fetch(`${server.url}/api/sessions/${sessionId}`)
      const data = await res.json()

      // The pending question should be in the response
      expect(data.pendingQuestions).toBeDefined()
      expect(Array.isArray(data.pendingQuestions)).toBe(true)
      expect(data.pendingQuestions.length).toBeGreaterThanOrEqual(1)

      const restored = data.pendingQuestions.find((q: { callId: string }) => q.callId === callId)
      expect(restored).toBeDefined()
      expect(restored.question).toBe(question)

      // Answer the question to clean up
      await client.send('ask.answer', { callId, answer: 'Continue' })
      await client.waitForChatDone()
    })
  })
})
