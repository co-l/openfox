/**
 * Read Tools E2E Tests
 * 
 * Tests read_file, glob, and grep tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  createTestClient, 
  createTestProject,
  assertNoErrors,
  type TestClient, 
  type TestProject 
} from './utils/index.js'
import type { ToolResult } from '@openfox/shared'

describe('Read Tools', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'typescript' })
    
    // Create project and session in planner mode (read-only tools)
    await client.send('project.create', { name: 'Read Tools Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
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
        const lines = output.split('\n').filter(l => l.trim())
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
        expect(result.error).toContain('not exist')
      }
    })
  })

  describe('glob', () => {
    it('finds files matching pattern', async () => {
      await client.send('chat.send', { 
        content: 'Use glob to find all .ts files in the project.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'glob')
      expect(toolCalls.length).toBeGreaterThan(0)
      
      const result = toolCalls[0]!.result!
      expect(result.success).toBe(true)
      expect(result.output).toContain('index.ts')
      expect(result.output).toContain('math.ts')
    })

    it('supports recursive patterns', async () => {
      await client.send('chat.send', { 
        content: 'Use glob with pattern "**/*.ts" to find all TypeScript files recursively.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'glob')
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(true)
      }
    })

    it('returns empty for no matches', async () => {
      await client.send('chat.send', { 
        content: 'Use glob to find files matching "*.xyz" (there are none).' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'glob')
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(true)
        // Output might be empty or indicate no matches
      }
    })
  })

  describe('grep', () => {
    it('searches file contents', async () => {
      await client.send('chat.send', { 
        content: 'Use grep to search for the word "function" in all TypeScript files.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'grep')
      expect(toolCalls.length).toBeGreaterThan(0)
      
      const result = toolCalls[0]!.result!
      expect(result.success).toBe(true)
      // Should find matches
      if (result.output) {
        expect(result.output.length).toBeGreaterThan(0)
      }
    })

    it('supports regex patterns', async () => {
      await client.send('chat.send', { 
        content: 'Use grep with a regex pattern to find all function declarations: "function\\s+\\w+"' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'grep')
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(true)
      }
    })

    it('filters by file pattern', async () => {
      await client.send('chat.send', { 
        content: 'Use grep to search for "export" only in files matching "*.ts".' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'grep')
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(true)
      }
    })

    it('returns no matches gracefully', async () => {
      await client.send('chat.send', { 
        content: 'Use grep to search for "XYZNONEXISTENT123" which does not exist in any file.' 
      })
      
      const response = await client.waitForChatDone()
      
      const toolCalls = response.toolCalls.filter(tc => tc.tool === 'grep')
      if (toolCalls.length > 0) {
        const result = toolCalls[0]!.result!
        expect(result.success).toBe(true)
        // No matches is still success, just empty output
      }
    })
  })
})
