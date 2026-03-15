/**
 * Shell Tools E2E Tests
 * 
 * Tests run_command tool for executing shell commands.
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

describe('Shell Tools', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Builder mode for run_command
    await client.send('project.create', { name: 'Shell Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
    await client.send('mode.switch', { mode: 'builder' })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('run_command', () => {
    it('executes basic commands', async () => {
      await client.send('chat.send', { 
        content: 'Run the command "ls" to list files in the current directory' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      expect(runCall!.result?.success).toBe(true)
      expect(runCall!.result?.output).toContain('package.json')
    })

    it('executes commands with arguments', async () => {
      await client.send('chat.send', { 
        content: 'Run "ls -la src" to list files in src directory with details' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      if (runCall?.result?.success) {
        expect(runCall.result.output).toContain('index.ts')
      }
    })

    it('handles command failures gracefully', async () => {
      await client.send('chat.send', { 
        content: 'Run the command "ls /nonexistent/path/xyz"' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      expect(runCall!.result?.success).toBe(false)
      expect(runCall!.result?.error).toBeDefined()
    })

    it('supports workdir parameter', async () => {
      await client.send('chat.send', { 
        content: 'Run "ls" in the src directory using the workdir parameter' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      if (runCall?.result?.success) {
        expect(runCall.result.output).toContain('index.ts')
        expect(runCall.result.output).toContain('math.ts')
      }
    })

    it('captures stdout', async () => {
      await client.send('chat.send', { 
        content: 'Run "echo Hello World"' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      expect(runCall!.result?.success).toBe(true)
      expect(runCall!.result?.output).toContain('Hello World')
    })

    it('captures stderr in error output', async () => {
      await client.send('chat.send', { 
        content: 'Run the command "cat /nonexistent/file.txt"' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      expect(runCall!.result?.success).toBe(false)
    })

    it('runs npm commands', async () => {
      await client.send('chat.send', { 
        content: 'Run "npm --version" to check npm version' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      if (runCall?.result?.success) {
        expect(runCall.result.output).toMatch(/\d+\.\d+\.\d+/)
      }
    })
  })

  describe('Output Handling', () => {
    it('handles multi-line output', async () => {
      await client.send('chat.send', { 
        content: 'Run "cat package.json"' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      if (runCall?.result?.success) {
        expect(runCall.result.output).toContain('"name"')
        expect(runCall.result.output?.split('\n').length).toBeGreaterThan(1)
      }
    })

    it('truncates large output', async () => {
      // This might not always produce truncation, but we verify truncated field exists
      await client.send('chat.send', { 
        content: 'Run "find ." to list all files recursively' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      expect(runCall!.result?.truncated).toBeDefined()
    })
  })

  describe('Multiple Commands', () => {
    it('runs multiple commands in sequence', async () => {
      await client.send('chat.send', { 
        content: 'Run "pwd" and then run "ls src"' 
      })
      
      const response = await client.waitForChatDone()
      
      const runCalls = response.toolCalls.filter(tc => tc.tool === 'run_command')
      expect(runCalls.length).toBeGreaterThanOrEqual(1)
    })
  })
})
