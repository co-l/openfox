/**
 * Shell Tools E2E Tests
 * 
 * Tests run_command tool for executing shell commands.
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

describe('Shell Tools', () => {
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
        content: 'Run the command "cat nonexistent-file-xyz.txt"' 
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

  describe('Output Streaming', () => {
    it('streams stdout before tool_result', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Run the exact command: echo "streaming test output"' 
      })
      
      const response = await client.waitForChatDone()
      const allEvents = client.allEvents()
      
      // Find the run_command tool call
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      
      // Find chat.tool_output events for this call
      const outputEvents = allEvents.filter(
        e => e.type === 'chat.tool_output' && 
             (e.payload as { callId: string }).callId === runCall!.callId
      )
      
      // Should have at least one output event
      expect(outputEvents.length).toBeGreaterThan(0)
      
      // Output events should come before tool_result
      const outputIdx = allEvents.indexOf(outputEvents[0]!)
      const resultEvent = allEvents.find(
        e => e.type === 'chat.tool_result' && 
             (e.payload as { callId: string }).callId === runCall!.callId
      )
      const resultIdx = allEvents.indexOf(resultEvent!)
      
      expect(outputIdx).toBeLessThan(resultIdx)
    })

    it('streams stderr separately', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Run the exact command: echo "stdout" && echo "stderr" >&2' 
      })
      
      const response = await client.waitForChatDone()
      const allEvents = client.allEvents()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      
      // Find output events
      const outputEvents = allEvents.filter(
        e => e.type === 'chat.tool_output' && 
             (e.payload as { callId: string }).callId === runCall!.callId
      )
      
      // Should have stdout and stderr events
      const stdoutEvents = outputEvents.filter(
        e => (e.payload as { stream: string }).stream === 'stdout'
      )
      const stderrEvents = outputEvents.filter(
        e => (e.payload as { stream: string }).stream === 'stderr'
      )
      
      expect(stdoutEvents.length).toBeGreaterThan(0)
      expect(stderrEvents.length).toBeGreaterThan(0)
      
      // Verify content
      const stdoutContent = stdoutEvents.map(
        e => (e.payload as { output: string }).output
      ).join('')
      const stderrContent = stderrEvents.map(
        e => (e.payload as { output: string }).output
      ).join('')
      
      expect(stdoutContent).toContain('stdout')
      expect(stderrContent).toContain('stderr')
    })

    it('streams output for slow commands', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Run exactly: echo "first" && sleep 0.2 && echo "second"' 
      })
      
      const response = await client.waitForChatDone()
      const allEvents = client.allEvents()
      
      const runCall = response.toolCalls.find(tc => tc.tool === 'run_command')
      expect(runCall).toBeDefined()
      
      // Should have multiple output events (one before sleep, one after)
      const outputEvents = allEvents.filter(
        e => e.type === 'chat.tool_output' && 
             (e.payload as { callId: string }).callId === runCall!.callId
      )
      
      // At minimum, we should have output events
      expect(outputEvents.length).toBeGreaterThan(0)
      
      // Combined content should have both "first" and "second"
      const allOutput = outputEvents.map(
        e => (e.payload as { output: string }).output
      ).join('')
      
      expect(allOutput).toContain('first')
      expect(allOutput).toContain('second')
    })
  })
})
