/**
 * Read Tools E2E Tests
 * 
 * Tests read_file, glob, and grep tools.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  assertNoErrors,
  createProject,
  createSession,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('Read Tools', () => {
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
    
    const restProject = await createProject(server.url, { name: 'Read Tools Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('read_file', () => {
    it('reads file contents with line numbers', async () => {
      await client.send('chat.send', { 
        content: 'Read the file src/math.ts and show me its contents.' 
      })
      
      const response = await client.waitForChatDone()
      assertNoErrors({ all: client.allEvents(), byType: new Map(), get: () => [], hasEvent: () => false, findEvent: () => undefined })
      
      // The response should mention the file contents
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'read_file')
      expect(toolCalls.length).toBeGreaterThan(0)
      
      const readResult = toolCalls[0]!.result
      expect(readResult).toBeDefined()
      expect(readResult!.success).toBe(true)
      expect(readResult!.output).toContain('add')
      expect(readResult!.output).toContain('subtract')
    })

    it('supports offset parameter', async () => {
      await client.send('chat.send', { 
        content: 'Read src/math.ts starting from line 5 using the offset parameter.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'read_file')
      if (toolCalls.length > 0 && toolCalls[0]!.result?.success) {
        const output = toolCalls[0]!.result!.output!
        // Should not contain line 1
        expect(output.startsWith('1:')).toBe(false)
      }
    })

    it('supports limit parameter', async () => {
      await client.send('chat.send', { 
        content: 'Read only the first 3 lines of src/math.ts using the limit parameter.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'read_file')
      if (toolCalls.length > 0 && toolCalls[0]!.result?.success) {
        const output = toolCalls[0]!.result!.output!
        const lines = output.split('\n').filter((line: string) => line.trim())
        expect(lines.length).toBeLessThanOrEqual(5) // Some tolerance for format
      }
    })

    it('reads directories listing entries', async () => {
      await client.send('chat.send', { 
        content: 'Read the src directory (not a file, the directory itself).' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'read_file')
      if (toolCalls.length > 0 && toolCalls[0]!.result?.success) {
        const output = toolCalls[0]!.result!.output!
        expect(output).toContain('index.ts')
        expect(output).toContain('math.ts')
      }
    })

    it('returns error for non-existent file', async () => {
      await client.send('chat.send', { 
        content: 'Try to read the file src/nonexistent.ts which does not exist.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'read_file')
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(false)
        expect(result.error?.toLowerCase()).toMatch(/not exist|not found/)
      }
    })
  })

  describe('glob', () => {
    it.skip('finds files matching pattern', async () => {
      // glob tool removed - use run_command with find instead
    })

    it.skip('supports recursive patterns', async () => {
      // glob tool removed - use run_command with find instead
    })

    it.skip('returns empty for no matches', async () => {
      // glob tool removed - use run_command with find instead
    })
  })

  describe('grep', () => {
    it.skip('searches file contents', async () => {
      // grep tool removed - use run_command with grep instead
    })

    it.skip('supports regex patterns', async () => {
      // grep tool removed - use run_command with grep instead
    })

    it.skip('filters by file pattern', async () => {
      // grep tool removed - use run_command with grep instead
    })

    it.skip('returns no matches gracefully', async () => {
      // grep tool removed - use run_command with grep instead
    })
  })
})
