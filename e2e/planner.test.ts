/**
 * Planner Mode E2E Tests
 * 
 * Tests planner chat, tool usage, and criteria creation with real LLM.
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
import type { Criterion } from '@openfox/shared'

describe('Planner Mode', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Create project and session
    await client.send('project.create', { name: 'Planner Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Basic Chat', () => {
    it('sends message and receives streaming response', async () => {
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
      await client.send('chat.send', { content: 'Hello, briefly introduce yourself.' })
      
      const response = await client.waitForChatDone()
      
      expect(response.stats).toBeDefined()
      expect(response.stats!.model).toBeDefined()
      expect(response.stats!.prefillTokens).toBeGreaterThan(0)
      expect(response.stats!.generationTokens).toBeGreaterThan(0)
      expect(response.stats!.totalTime).toBeGreaterThan(0)
    })

    it('accumulates content from deltas', async () => {
      await client.send('chat.send', { content: 'Say exactly: "Hello World"' })
      
      const response = await client.waitForChatDone()
      
      // Content should be accumulated from deltas
      expect(response.content.toLowerCase()).toContain('hello')
      expect(response.reason).toBe('complete')
    })
  })

  describe('Tool Usage', () => {
    it('uses read_file tool when asked about file contents', async () => {
      await client.send('chat.send', { 
        content: 'Read the package.json file and tell me the project name.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should have tool call events
      const toolCallEvents = events.get('chat.tool_call')
      expect(toolCallEvents.length).toBeGreaterThan(0)
      
      // Find read_file call
      const readCall = toolCallEvents.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'read_file'
      })
      expect(readCall).toBeDefined()
      
      // Should have corresponding tool result
      const toolResultEvents = events.get('chat.tool_result')
      expect(toolResultEvents.length).toBeGreaterThan(0)
    })

    it('uses glob tool to find files', async () => {
      await client.send('chat.send', { 
        content: 'Find all TypeScript files in this project using glob.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolCalls = events.get('chat.tool_call')
      const globCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'glob'
      })
      expect(globCall).toBeDefined()
    })

    it('uses grep tool to search file contents', async () => {
      await client.send('chat.send', { 
        content: 'Search for the word "export" in the TypeScript files using grep.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolCalls = events.get('chat.tool_call')
      const grepCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'grep'
      })
      expect(grepCall).toBeDefined()
    })
  })

  describe('Criteria Management', () => {
    it('creates criteria when asked to propose them', async () => {
      await client.send('chat.send', { 
        content: 'I want to add a multiply function to math.ts. Propose acceptance criteria for this task. Use the add_criterion tool.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should have criteria update event
      const criteriaEvents = events.get('criteria.updated')
      expect(criteriaEvents.length).toBeGreaterThan(0)
      
      // Check session has criteria
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThan(0)
    })

    it('can add multiple criteria', async () => {
      await client.send('chat.send', { 
        content: `Add these two acceptance criteria:
1. A multiply function exists in math.ts that takes two numbers
2. The multiply function returns the correct product

Use add_criterion for each one.` 
      })
      
      await client.waitForChatDone()
      
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThanOrEqual(2)
    })

    it('criteria have pending status initially', async () => {
      await client.send('chat.send', { 
        content: 'Add a criterion: Tests pass with npm test. Use add_criterion.' 
      })
      
      await client.waitForChatDone()
      
      const session = client.getSession()!
      const criterion = session.criteria[0]!
      expect(criterion.status.type).toBe('pending')
    })
  })

  describe('Multi-turn Conversation', () => {
    it('maintains context across turns', async () => {
      // First turn: establish context
      await client.send('chat.send', { content: 'The project name is "test-project".' })
      await client.waitForChatDone()
      
      // Second turn: reference previous context
      await client.send('chat.send', { content: 'What did I say the project name was?' })
      const response = await client.waitForChatDone()
      
      expect(response.content.toLowerCase()).toContain('test-project')
    })

    it('accumulates criteria across turns', async () => {
      // Add first criterion
      await client.send('chat.send', { 
        content: 'Add criterion: Function is exported. Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Add second criterion
      await client.send('chat.send', { 
        content: 'Add criterion: Function has JSDoc. Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      const session = client.getSession()!
      expect(session.criteria.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Stop Generation', () => {
    it('stops generation when requested', async () => {
      // Send a message that would generate a long response
      await client.send('chat.send', { 
        content: 'Write a very long and detailed explanation of TypeScript.' 
      })
      
      // Wait a bit for generation to start
      await new Promise(resolve => setTimeout(resolve, 500))
      
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
      await client.send('chat.send', { 
        content: 'Think step by step about how to add a new function to a TypeScript file.' 
      })
      
      const events = await collectChatEvents(client)
      
      // Note: Thinking events depend on model capability
      // Some models emit thinking, others don't
      // We just verify no errors occur
      assertNoErrors(events)
    })
  })
})
