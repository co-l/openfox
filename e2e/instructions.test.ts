/**
 * Instructions System E2E Tests
 * 
 * Tests AGENTS.md discovery, global instructions, and project custom instructions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  type TestClient, 
  type TestProject 
} from './utils/index.js'
import type { Message, PromptContext } from '@openfox/shared'

describe('Instructions System', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
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
      
      await client.send('project.create', { name: 'Instructions Test', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      // Send a message and check if AGENTS.md was injected
      await client.send('chat.send', { content: 'Hello' })
      await client.waitForChatDone()
      
      // Get messages and find the one with promptContext
      const events = client.allEvents()
      const messageEvents = events.filter(e => e.type === 'chat.message')
      
      // Find a message with promptContext (should be on user message)
      const userMessage = messageEvents.find(e => {
        const payload = e.payload as { message: Message }
        return payload.message.promptContext !== undefined
      })
      
      if (userMessage) {
        const payload = userMessage.payload as { message: Message }
        const promptContext = payload.message.promptContext!
        expect(promptContext.injectedFiles.length).toBeGreaterThan(0)
        
        const agentsMd = promptContext.injectedFiles.find(f => 
          f.path.includes('AGENTS.md')
        )
        expect(agentsMd).toBeDefined()
        expect(agentsMd!.content).toContain('TypeScript strict mode')
      }
    })

    it('discovers AGENTS.md in parent directories', async () => {
      // Create project with AGENTS.md template
      testDir = await createTestProject({ template: 'with-agents-md' })
      
      await client.send('project.create', { name: 'Parent Test', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      await client.send('chat.send', { content: 'What guidelines should I follow?' })
      const response = await client.waitForChatDone()
      
      // The LLM should have access to the guidelines
      expect(response.content.toLowerCase()).toMatch(/function|test|tdd|style/i)
    })
  })

  describe('Project Custom Instructions', () => {
    it('injects project custom instructions into prompts', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      // Create project with custom instructions
      await client.send('project.create', { 
        name: 'Custom Instructions Test', 
        workdir: testDir.path 
      })
      const project = client.getProject()!
      
      // Set custom instructions
      await client.send('project.update', {
        projectId: project.id,
        customInstructions: 'CUSTOM_MARKER: Always respond with "ACKNOWLEDGED" first.',
      })
      
      await client.send('session.create', { projectId: project.id })
      
      await client.send('chat.send', { content: 'Hello there!' })
      const response = await client.waitForChatDone()
      
      // LLM should follow the custom instruction
      expect(response.content.toUpperCase()).toContain('ACKNOWLEDGED')
    })

    it('updates instructions are picked up on next turn', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      await client.send('project.create', { name: 'Update Test', workdir: testDir.path })
      const project = client.getProject()!
      await client.send('session.create', { projectId: project.id })
      
      // First message without custom instructions
      await client.send('chat.send', { content: 'Say the magic word.' })
      const response1 = await client.waitForChatDone()
      
      // Add custom instructions
      await client.send('project.update', {
        projectId: project.id,
        customInstructions: 'CUSTOM: The magic word is ABRACADABRA.',
      })
      
      // Second message should see new instructions
      await client.send('chat.send', { content: 'What is the magic word?' })
      const response2 = await client.waitForChatDone()
      
      expect(response2.content.toUpperCase()).toContain('ABRACADABRA')
    })
  })

  describe('Global Instructions via Settings', () => {
    it('uses global instructions from settings', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      // Set global instructions
      await client.send('settings.set', { 
        key: 'global_instructions', 
        value: 'GLOBAL_MARKER: Always end responses with "[DONE]"' 
      })
      
      await client.send('project.create', { name: 'Global Test', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      await client.send('chat.send', { content: 'Say hello briefly.' })
      const response = await client.waitForChatDone()
      
      // LLM should follow global instruction
      expect(response.content).toContain('[DONE]')
    })
  })

  describe('Prompt Context Inspection', () => {
    it('includes system prompt in promptContext', async () => {
      testDir = await createTestProject({ template: 'typescript' })
      
      await client.send('project.create', { name: 'Prompt Test', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
      await client.send('chat.send', { content: 'Hello' })
      await client.waitForChatDone()
      
      // Find message with promptContext
      const events = client.allEvents()
      const messageWithContext = events.find(e => {
        if (e.type !== 'chat.message') return false
        const payload = e.payload as { message: Message }
        return payload.message.promptContext !== undefined
      })
      
      if (messageWithContext) {
        const payload = messageWithContext.payload as { message: Message }
        const promptContext = payload.message.promptContext!
        
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
      
      await client.send('project.create', { name: 'Live Edit Test', workdir: testDir.path })
      const projectId = client.getProject()!.id
      await client.send('session.create', { projectId })
      
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
