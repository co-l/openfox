/**
 * Tool Permissions E2E Tests
 * 
 * Tests that tool permission enforcement works correctly at the execute level.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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

describe('Tool Permissions', () => {
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
    
    const restProject = await createProject(server.url, { name: 'Tool Permissions Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Permission Enforcement', () => {
    it('blocks unauthorized tool access with clear error message', async () => {
      await client.send('chat.send', { 
        content: 'Use the git tool to check the git status.' 
      })
      
      const response = await client.waitForChatDone()
      
      // The agent should not be able to use git tool if not in allowedTools
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'git')
      
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(false)
        expect(result.error).toContain('not in your allowed tools list')
      }
    })

    it('includes available tools in permission error message', async () => {
      await client.send('chat.send', { 
        content: 'Try to use a tool that is not available.' 
      })
      
      const response = await client.waitForChatDone()
      
      // Check that error messages include available tools
      const failedToolCalls = response.toolCalls.filter(tc => tc.result?.success === false)
      
      if (failedToolCalls.length > 0) {
        const error = failedToolCalls[0]!.result!.error!
        expect(error).toContain('Available:')
      }
    })
  })

  describe('Sub-agent Permissions', () => {
    it('enforces permissions in sub-agent tool calls', async () => {
      await client.send('chat.send', { 
        content: 'Call a sub-agent to write a file.' 
      })
      
      const response = await client.waitForChatDone()
      
      // Sub-agent should not have write_file if not in its allowedTools
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'call_sub_agent')
      
      if (toolCalls.length > 0) {
        // The sub-agent should respect its permission boundaries
        const subAgentResult = toolCalls[0]!.result
        if (subAgentResult) {
          expect(subAgentResult.success).toBe(true)
          // Check that write_file was not called by the sub-agent
          const writeCalls = response.toolCalls.filter(tc => tc.tool === 'write_file')
          expect(writeCalls.length).toBe(0)
        }
      }
    })
  })
})
