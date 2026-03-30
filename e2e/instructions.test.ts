/**
 * Instructions System E2E Tests
 * 
 * Tests AGENTS.md discovery, global instructions, and project custom instructions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'
import type { Message, PromptContext } from '@openfox/shared'

describe('Instructions System', () => {
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
  })

  afterEach(async () => {
    await client.close()
    if (testDir) {
      await testDir.cleanup()
    }
  })

  describe('AGENTS.md Discovery', () => {
    it('discovers AGENTS.md in project root', async () => {
      testDir = await createTestProject({
        template: 'typescript',
        agentsMd: `# Project Guidelines
Always use TypeScript strict mode.
Never use any type.`,
      })
      
      const restProject = await createProject(server.url, { name: 'Instructions Test', workdir: testDir.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      // Send a message and check if AGENTS.md was injected
      await client.send('chat.send', { content: 'Hello' })
      await client.waitForChatDone()
      
      // Get message updates and find the assistant turn with promptContext
      const events = client.allEvents()
      const messageEvents = events.filter(e => e.type === 'chat.message_updated')
      
      const assistantMessage = messageEvents.find(e => {
        const payload = e.payload as { updates: Message }
        return payload.updates.promptContext !== undefined
      })
      
      if (assistantMessage) {
        const payload = assistantMessage.payload as { updates: Message }
        const promptContext = payload.updates.promptContext!
        expect(promptContext.injectedFiles.length).toBeGreaterThan(0)
        
        const agentsMd = promptContext.injectedFiles.find((f: { path: string }) => 
          f.path.includes('AGENTS.md')
        )
        expect(agentsMd).toBeDefined()
        expect(agentsMd!.content).toContain('TypeScript strict mode')
      }
    })

    it('discovers AGENTS.md in parent directories', async () => {
      // Create project with AGENTS.md template
      testDir = await createTestProject({ template: 'with-agents-md' })
      
      const restProject = await createProject(server.url, { name: 'Parent Test', workdir: testDir.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      await client.send('chat.send', { content: 'What guidelines should I follow?' })
      const response = await client.waitForChatDone()
      
      // The LLM should have access to the guidelines
      expect(response.content.toLowerCase()).toMatch(/function|test|tdd|style/i)
    })
  })

  describe('Project Custom Instructions', () => {
    it('injects project custom instructions into prompts', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      const restProject = await createProject(server.url, { 
        name: 'Custom Instructions Test', 
        workdir: testDir.path 
      })
      
      // Update project via REST API
      const updateRes = await fetch(`${server.url}/api/projects/${restProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions: 'CUSTOM_MARKER: Always respond with "ACKNOWLEDGED" first.' }),
      })
      expect(updateRes.status).toBe(200)
      
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      await client.send('chat.send', { content: 'Hello there!' })
      const response = await client.waitForChatDone()
      
      // LLM should follow the custom instruction
      expect(response.content.toUpperCase()).toContain('ACKNOWLEDGED')
    })

    it('updates instructions are picked up on next turn', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      const restProject = await createProject(server.url, { name: 'Update Test', workdir: testDir.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      // First message without custom instructions
      await client.send('chat.send', { content: 'Say the magic word.' })
      await client.waitForChatDone()
      
      // Add custom instructions via REST API
      const updateRes = await fetch(`${server.url}/api/projects/${restProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions: 'CUSTOM: The magic word is ABRACADABRA.' }),
      })
      expect(updateRes.status).toBe(200)
      
      // Second message should see new instructions
      await client.send('chat.send', { content: 'What is the magic word?' })
      const response2 = await client.waitForChatDone()
      
      expect(response2.content.toUpperCase()).toContain('ABRACADABRA')
    })
  })

  describe('Global Instructions via Settings', () => {
    it('uses global instructions from settings', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      // Set global instructions via REST API
      const settingsRes = await fetch(`${server.url}/api/settings/global_instructions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'GLOBAL_MARKER: Always end responses with "[DONE]"' }),
      })
      expect(settingsRes.status).toBe(200)
      
      const restProject = await createProject(server.url, { name: 'Global Test', workdir: testDir.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      await client.send('chat.send', { content: 'Say hello briefly.' })
      const response = await client.waitForChatDone()
      
      // LLM should follow global instruction
      expect(response.content).toContain('[DONE]')
    })
  })

  describe('Prompt Context Inspection', () => {
    it('includes system prompt in promptContext', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      const restProject = await createProject(server.url, { name: 'Prompt Test', workdir: testDir.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      await client.send('chat.send', { content: 'Hello' })
      await client.waitForChatDone()
      
      // Find message with promptContext
      const events = client.allEvents()
      const messageWithContext = events.find(e => {
        if (e.type !== 'chat.message_updated') return false
        const payload = e.payload as { updates: Message }
        return payload.updates.promptContext !== undefined
      })
      
      if (messageWithContext) {
        const payload = messageWithContext.payload as { updates: Message }
        const promptContext = payload.updates.promptContext!
        
        expect(promptContext.systemPrompt).toBeDefined()
        expect(promptContext.systemPrompt.length).toBeGreaterThan(100)
        expect(promptContext.userMessage).toBe('Hello')
      }
    })
  })

  describe('Live Edit Support', () => {
    it('picks up AGENTS.md changes mid-session', async () => {
      testDir = await createTestProject({ 
        template: 'typescript',
        agentsMd: 'Original instruction: say ORIGINAL',
      })
      
      const restProject = await createProject(server.url, { name: 'Live Edit Test', workdir: testDir.path })
      const restSession = await createSession(server.url, { projectId: restProject.id })
      await client.send('session.load', { sessionId: restSession.id })
      
      // First turn with original instruction
      await client.send('chat.send', { content: 'What should you say?' })
      const response1 = await client.waitForChatDone()
      expect(response1.content.toUpperCase()).toContain('ORIGINAL')
      
      // Modify AGENTS.md
      await writeFile(
        join(testDir.path, 'AGENTS.md'),
        'Updated instruction: say UPDATED'
      )
      
      // Next turn should see updated instructions
      await client.send('chat.send', { content: 'What should you say now?' })
      const response2 = await client.waitForChatDone()
      expect(response2.content.toUpperCase()).toContain('UPDATED')
    })
  })
})
