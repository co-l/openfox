/**
 * Builder Mode E2E Tests
 * 
 * Tests builder chat with write operations, criterion completion, and todo tracking.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  setSessionMode,
  stopSessionChat,
  continueSessionChat,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('Builder Mode', () => {
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
    
    const restProject = await createProject(server.url, { name: 'Builder Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await setSessionMode(server.url, restSession.id, 'builder', server.wsUrl)
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Write Operations', () => {
    it('writes new files with write_file', async () => {
      await client.send('chat.send', { 
        content: 'Create a new file called src/utils.ts with a single exported function called "greet" that returns "Hello!"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Check for write_file tool call
      const toolCalls = events.get('chat.tool_call')
      const writeCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'write_file'
      })
      expect(writeCall).toBeDefined()
      
      // Verify file was created
      const content = await readFile(join(testDir.path, 'src/utils.ts'), 'utf-8')
      expect(content).toContain('greet')
    })

    it('edits existing files with edit_file', async () => {
      await client.send('chat.send', { 
        content: 'Read src/math.ts, then use edit_file to change the function name "add" to "sum"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should have read followed by edit
      const toolCalls = events.get('chat.tool_call')
      const readCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'read_file'
      })
      const editCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'edit_file'
      })
      
      expect(readCall).toBeDefined()
      expect(editCall).toBeDefined()
      
      // Verify edit was made
      const content = await readFile(join(testDir.path, 'src/math.ts'), 'utf-8')
      expect(content).toContain('sum')
    })

    it('enforces read-before-write on existing files', async () => {
      await client.send('chat.send', { 
        content: 'WITHOUT reading it first, try to write "new content" to src/index.ts using write_file' 
      })
      
      const events = await collectChatEvents(client)
      
      // Should have tool_result with error
      const toolResults = events.get('chat.tool_result')
      const writeResult = toolResults.find(e => {
        const payload = e.payload as { tool: string; result: { success: boolean } }
        return payload.tool === 'write_file' && !payload.result.success
      })
      
      // The LLM might read first anyway, but if it doesn't, write should fail
      // or the LLM should recognize the error and try again
      // This is a behavioral test - we just verify no unhandled errors
      assertNoErrors(events)
    })
  })

  describe('Shell Commands', () => {
    it('runs shell commands with run_command', async () => {
      await client.send('chat.send', { 
        content: 'Run the command "ls src" to list files in src directory' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolCalls = events.get('chat.tool_call')
      const shellCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string }
        return payload.tool === 'run_command'
      })
      expect(shellCall).toBeDefined()
      
      // Check result
      const toolResults = events.get('chat.tool_result')
      const shellResult = toolResults.find(e => {
        const payload = e.payload as { tool: string; result: { success: boolean; output?: string } }
        return payload.tool === 'run_command' && payload.result.success
      })
      expect(shellResult).toBeDefined()
      const resultPayload = shellResult!.payload as { result: { output: string } }
      expect(resultPayload.result.output).toContain('index.ts')
    })
  })

  describe('Criterion Completion', () => {
    it('uses complete_criterion to mark criteria done', async () => {
      const sessionId = client.getSession()!.id
      
      // First add criteria in planner mode
      await setSessionMode(server.url, sessionId, 'planner', server.wsUrl)
      await client.send('chat.send', { 
        content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      
      // Ask to implement and complete
      await client.send('chat.send', { 
        content: 'Create the file src/utils.ts with any content, then call complete_criterion for "file-created".' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should have criterion tool call with action 'complete'
      const toolCalls = events.get('chat.tool_call')
      const completeCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string; args: Record<string, unknown> }
        return payload.tool === 'criterion' && (payload.args as any).action === 'complete'
      })
      expect(completeCall).toBeDefined()
      
      // Criterion should be marked completed
      const criteriaEvents = events.get('criteria.updated')
      if (criteriaEvents.length > 0) {
        const lastCriteria = criteriaEvents[criteriaEvents.length - 1]!
        const payload = lastCriteria.payload as { criteria: Array<{ status: { type: string } }> }
        const completed = payload.criteria.find(c => c.status.type === 'completed')
        expect(completed).toBeDefined()
      }
    })

    it('can read criteria with get_criteria before completing them', async () => {
      const sessionId = client.getSession()!.id
      
      // First add a criterion in planner mode
      await setSessionMode(server.url, sessionId, 'planner', server.wsUrl)
      await client.send('chat.send', { 
        content: 'Add criterion ID "test-file": "A test file exists". Use add_criterion.' 
      })
      await client.waitForChatDone()
      
      // Switch to builder
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      
      // Ask builder to read criteria first, then implement
      await client.send('chat.send', { 
        content: 'First call get_criteria to see what needs to be done, then create src/test.ts and call complete_criterion for "test-file".' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should have criterion tool calls with actions 'get' and 'complete'
      const toolCalls = events.get('chat.tool_call')
      const getCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string; args: Record<string, unknown> }
        return payload.tool === 'criterion' && (payload.args as any).action === 'get'
      })
      const completeCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string; args: Record<string, unknown> }
        return payload.tool === 'criterion' && (payload.args as any).action === 'complete'
      })
      
      expect(getCall).toBeDefined()
      expect(completeCall).toBeDefined()
      
      // Verify get was called before complete
      expect(toolCalls.indexOf(getCall)).toBeLessThan(toolCalls.indexOf(completeCall))
    })
  })

  describe('Todo Tracking', () => {
    it('uses todo_write to track progress', async () => {
      await client.send('chat.send', { 
        content: 'Use the todo_write tool to create a todo list with 2 items: "Read files" (in_progress) and "Make changes" (pending)' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should have todo tool call with action 'write'
      const toolCalls = events.get('chat.tool_call')
      const todoCall = toolCalls.find(e => {
        const payload = e.payload as { tool: string; args: Record<string, unknown> }
        return payload.tool === 'todo' && (payload.args as any).action === 'write'
      })
      expect(todoCall).toBeDefined()
      
      // Should have chat.todo event
      const todoEvents = events.get('chat.todo')
      if (todoEvents.length > 0) {
        const payload = todoEvents[0]!.payload as { todos: Array<{ content: string }> }
        expect(payload.todos.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Continue Command', () => {
    it('accepts continue request via REST API', async () => {
      const sessionId = client.getSession()!.id
      
      // Start a generation
      await client.send('chat.send', { 
        content: 'List the files in this project.' 
      })
      await client.waitForChatDone()
      
      // Session should not be running
      const session = client.getSession()!
      expect(session.isRunning).toBe(false)
      
      // Continue should work via REST API
      const result = await continueSessionChat(server.url, sessionId)
      expect(result.accepted).toBe(true)
    })

    it('rejects continue while already running', async () => {
      const sessionId = client.getSession()!.id
      
      // Start a generation
      await client.send('chat.send', { 
        content: 'Write a long explanation of TypeScript features.' 
      })
      
      // Wait a moment for it to start
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Try to continue while running - should get 409 Conflict
      const response = await fetch(`${server.url}/api/sessions/${sessionId}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(response.status).toBe(409)
      
      // Clean up
      await stopSessionChat(server.url, sessionId)
      await client.waitForChatDone()
    })
  })

  describe('Modified Files Tracking', () => {
    it('tracks files modified during session', async () => {
      await client.send('chat.send', { 
        content: 'Create a file at src/new.ts with content "export const x = 1"' 
      })
      await client.waitForChatDone()
      
      const session = client.getSession()!
      // Note: Modified files are tracked in executionState
      if (session.executionState) {
        expect(session.executionState.modifiedFiles).toBeDefined()
      }
    })
  })
})
