/**
 * Planner Mode E2E Tests
 *
 * Tests planner chat, tool usage, and criteria creation with real LLM.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createSessionPool,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  type TestServerHandle,
  type SessionPool,
} from './utils/index.js'
import type { Message } from '@openfox/shared'

// Server and pool are created in beforeAll
let server: TestServerHandle
let pool: SessionPool

describe('Planner Mode', () => {
  beforeAll(async () => {
    server = await createTestServer()
    pool = createSessionPool({ template: 'typescript', mode: 'planner', wsUrl: server.wsUrl })
    await pool.setup()
  })
  afterAll(async () => {
    await pool.cleanup()
    await server.close()
  })
  beforeEach(async () => {
    await pool.reset()
  })

  describe('Basic Chat', () => {
    it('sends message and receives streaming response', async () => {
      const { client } = pool.get()

      // Send a simple message
      await client.send('chat.send', { content: 'What files are in this project?' })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // Should have chat.message for user message
      const messageEvents = events.get('chat.message')
      expect(messageEvents.length).toBeGreaterThan(0)

      // Should have streaming deltas
      const deltaEvents = events.get('chat.delta')
      expect(deltaEvents.length).toBeGreaterThan(0)

      // Should end with chat.done
      const doneEvents = events.get('chat.done')
      expect(doneEvents.length).toBe(1)
    })

    it('includes stats in chat.done', async () => {
      const { client } = pool.get()

      await client.send('chat.send', { content: 'Hello, briefly introduce yourself.' })

      const response = await client.waitForChatDone()

      expect(response.stats).toBeDefined()
      expect(response.stats!.model).toBeDefined()
      expect(response.stats!.prefillTokens).toBeGreaterThan(0)
      expect(response.stats!.generationTokens).toBeGreaterThan(0)
      expect(response.stats!.totalTime).toBeGreaterThan(0)
    })

    it('accumulates content from deltas', async () => {
      const { client } = pool.get()

      await client.send('chat.send', { content: 'Say exactly: "Hello World"' })

      const response = await client.waitForChatDone()

      // Content should be accumulated from deltas
      expect(response.content.toLowerCase()).toContain('hello')
      expect(response.reason).toBe('complete')
    })
  })

  describe('Tool Usage', () => {
    it('uses read_file tool when asked about file contents', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: 'Read the package.json file and tell me the project name.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // Should have tool call events
      const toolCallEvents = events.get('chat.tool_call')
      expect(toolCallEvents.length).toBeGreaterThan(0)

      // Find read_file call
      const readCall = toolCallEvents.find((e) => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'read_file'
      })
      expect(readCall).toBeDefined()

      // Should have corresponding tool result
      const toolResultEvents = events.get('chat.tool_result')
      expect(toolResultEvents.length).toBeGreaterThan(0)
    })

    it('uses glob tool to find files', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: 'Find all TypeScript files in this project using glob.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      const toolCalls = events.get('chat.tool_call')
      const globCall = toolCalls.find((e) => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'glob'
      })
      expect(globCall).toBeDefined()
    })

    it('uses grep tool to search file contents', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: 'Search for the word "export" in the TypeScript files using grep.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      const toolCalls = events.get('chat.tool_call')
      const grepCall = toolCalls.find((e) => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'grep'
      })
      expect(grepCall).toBeDefined()
    })
  })

  describe('Criteria Management', () => {
    it('creates criteria when asked to propose them', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content:
          'I want to add a multiply function to math.ts. Propose acceptance criteria for this task. Use the session_metadata tool.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // Should have criteria update event
      const metadataEvents = events.get('metadata.updated')
      expect(metadataEvents.length).toBeGreaterThan(0)

      // Check session has criteria
      const session = client.getSession()!
      expect(session.metadataEntries?.['criteria']?.length ?? 0).toBeGreaterThan(0)
    })

    it('can add multiple criteria', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: `Add these two acceptance criteria:
1. A multiply function exists in math.ts that takes two numbers
2. The multiply function returns the correct product

Use session_metadata for each one.`,
      })

      await client.waitForChatDone()

      const session = client.getSession()!
      expect(session.metadataEntries?.['criteria']?.length ?? 0).toBeGreaterThanOrEqual(2)
    })

    it('criteria have pending status initially', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: 'Add a criterion: Tests pass with npm test. Use session_metadata.',
      })

      await client.waitForChatDone()

      const session = client.getSession()!
      const criteria = session.metadataEntries?.['criteria'] ?? []
      const criterion = criteria[0] as { status: string } | undefined
      expect(criterion?.status).toBe('pending')
    })
  })

  describe('Multi-turn Conversation', () => {
    it('maintains context across turns', async () => {
      const { client } = pool.get()

      // First turn: establish context
      await client.send('chat.send', { content: 'The project name is "test-project".' })
      await client.waitForChatDone()

      // Second turn: reference previous context
      await client.send('chat.send', { content: 'What did I say the project name was?' })
      const response = await client.waitForChatDone()

      expect(response.content.toLowerCase()).toContain('test-project')
    })

    it('accumulates criteria across turns', async () => {
      const { client } = pool.get()

      // Add first criterion
      await client.send('chat.send', {
        content: 'Add criterion: Function is exported. Use session_metadata.',
      })
      await client.waitForChatDone()

      // Add second criterion
      await client.send('chat.send', {
        content: 'Add criterion: Function has JSDoc. Use session_metadata.',
      })
      await client.waitForChatDone()

      const session = client.getSession()!
      expect(session.metadataEntries?.['criteria']?.length ?? 0).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Stop Generation', () => {
    it('stops generation when requested', async () => {
      const { client } = pool.get()

      // Send a message that would generate a long response
      await client.send('chat.send', {
        content: 'Write a very long and detailed explanation of TypeScript.',
      })

      // Wait a bit for generation to start
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Stop it
      await client.send('chat.stop', {})

      // Should receive stopped event
      const doneEvent = await client.waitFor('chat.done')
      const payload = doneEvent.payload as { reason: string }
      expect(['stopped', 'complete']).toContain(payload.reason)
    })
  })

  describe('Thinking Content', () => {
    it('streams thinking content when model supports it', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: 'Think step by step about how to add a new function to a TypeScript file.',
      })

      const events = await collectChatEvents(client)

      // Note: Thinking events depend on model capability
      // Some models emit thinking, others don't
      // We just verify no errors occur
      assertNoErrors(events)
    })
  })

  describe('Stats Bar', () => {
    it('attaches stats to only ONE message after chat with tool calls', async () => {
      const { client } = pool.get()

      // This chat will require at least one tool call (read_file)
      // then a follow-up response, creating multiple assistant messages
      await client.send('chat.send', {
        content: 'Read package.json and tell me the project version.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // Verify we had tool calls (meaning multiple LLM turns)
      const toolCalls = events.get('chat.tool_call')
      expect(toolCalls.length).toBeGreaterThan(0)

      // Count assistant messages that have stats attached
      const messageEvents = events.get('chat.message')
      const assistantMessagesWithStats = messageEvents
        .map((e) => (e.payload as { message: Message }).message)
        .filter((m) => m.role === 'assistant' && m.stats !== undefined)

      // Should have exactly ONE assistant message with stats (the final one)
      expect(assistantMessagesWithStats.length).toBe(1)
    })

    it('emits exactly one chat.done with complete reason per conversation turn', async () => {
      const { client } = pool.get()

      await client.send('chat.send', {
        content: 'Read package.json and summarize it.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // Should have exactly ONE chat.done with 'complete' reason
      const doneEvents = events.get('chat.done')
      const completeEvents = doneEvents.filter((e) => (e.payload as { reason: string }).reason === 'complete')

      expect(completeEvents.length).toBe(1)
    })

    it('streams live chat.stats throughout a multi-call turn', async () => {
      const { client } = pool.get()

      // This chat requires at least one tool call (read_file) then a follow-up
      // response — multiple LLM calls in a single turn.
      await client.send('chat.send', {
        content: 'Read package.json and tell me the project version.',
      })

      const events = await collectChatEvents(client)
      assertNoErrors(events)

      // Guard the multi-call premise: a tool call means a follow-up LLM call,
      // so the turn spans at least two calls.
      const toolCalls = events.get('chat.tool_call')
      expect(toolCalls.length).toBeGreaterThan(0)

      // Live stats are emitted after each completed LLM call.
      const statsEvents = events.get('chat.stats')
      expect(statsEvents.length).toBeGreaterThanOrEqual(2)

      // The last live update must agree with the final chat.done stats — they
      // describe the same cumulative turn.
      const doneEvents = events.get('chat.done')
      const doneStats = (doneEvents[0]!.payload as { stats?: { prefillTokens: number; generationTokens: number } })
        .stats
      expect(doneStats).toBeDefined()
      const lastStats = (
        statsEvents[statsEvents.length - 1]!.payload as {
          stats: { prefillTokens: number; generationTokens: number }
        }
      ).stats
      expect(lastStats.prefillTokens).toBe(doneStats!.prefillTokens)
      expect(lastStats.generationTokens).toBe(doneStats!.generationTokens)
    })
  })
})
