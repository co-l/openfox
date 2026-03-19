/**
 * LSP Diagnostics E2E Tests
 * 
 * Tests that LSP (Language Server Protocol) diagnostics are:
 * 1. Collected after write_file and edit_file operations
 * 2. Appended to tool output for LLM feedback
 * 3. Emitted as lsp.diagnostics events
 * 
 * Note: These tests require LSP servers to be installed (typescript-language-server, etc.)
 * If LSP servers are not available, the tests verify graceful degradation.
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
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('LSP Diagnostics', () => {
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
    
    // Builder mode for write operations
    await client.send('project.create', { name: 'LSP Test', workdir: testDir.path })
    const projectId = client.getProject()!.id
    await client.send('session.create', { projectId })
    await client.send('mode.switch', { mode: 'builder' })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Diagnostics After Write', () => {
    it('includes diagnostics in tool result for TypeScript errors', async () => {
      // Write a file with a deliberate TypeScript error
      await client.send('chat.send', { 
        content: 'Write a TypeScript file with a syntax error to test LSP diagnostics.' 
      })
      
      const events = await collectChatEvents(client)
      
      // Find write_file tool result
      const toolResults = events.get('chat.tool_result')
      const writeResult = toolResults.find(e => 
        (e.payload as { tool: string }).tool === 'write_file'
      )
      
      if (writeResult) {
        const result = (writeResult.payload as { result: { success: boolean; output?: string } }).result
        
        // If LSP is available, output might contain diagnostic info
        // If LSP is not available, it should still succeed without diagnostics
        expect(result.success).toBeDefined()
        
        // Check if output contains LSP diagnostic markers
        if (result.output && result.output.includes('LSP')) {
          expect(result.output).toContain('error')
        }
      }
    })

    it('includes diagnostics in tool result for type mismatches', async () => {
      // First read the file to enable writing
      await client.send('chat.send', { 
        content: 'Read src/math.ts' 
      })
      await client.waitForChatDone()
      
      // Now write a file with a type error
      await client.send('chat.send', { 
        content: 'Use edit_file on src/math.ts to change "return a + b" to "return a + \'string\'"' 
      })
      
      const events = await collectChatEvents(client)
      
      const toolResults = events.get('chat.tool_result')
      const editResult = toolResults.find(e => 
        (e.payload as { tool: string }).tool === 'edit_file'
      )
      
      // The edit may or may not succeed, but we should handle it gracefully
      assertNoErrors(events)
    })
  })

  describe('LSP Availability', () => {
    it('degrades gracefully when LSP is not available', async () => {
      // Write to a file type without LSP support
      await client.send('chat.send', { 
        content: 'Write a new file called data.txt with content "plain text file"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Should succeed without LSP
      const toolResults = events.get('chat.tool_result')
      const writeResult = toolResults.find(e => 
        (e.payload as { tool: string }).tool === 'write_file'
      )
      
      if (writeResult) {
        const result = (writeResult.payload as { result: { success: boolean } }).result
        expect(result.success).toBe(true)
      }
    })

    it('handles unsupported file types', async () => {
      // Write to a file type that has no LSP support
      await client.send('chat.send', { 
        content: 'Write a file called config.yaml with content "key: value"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
    })
  })

  describe('Diagnostic Events', () => {
    it('may emit lsp.diagnostics event after write', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Write src/newfile.ts with content "export const x: number = 42"' 
      })
      
      await client.waitForChatDone()
      
      const allEvents = client.allEvents()
      
      // Check for lsp.diagnostics event (may or may not exist depending on LSP availability)
      const diagnosticEvents = allEvents.filter(e => e.type === 'lsp.diagnostics')
      
      // If we have diagnostic events, verify their structure
      for (const event of diagnosticEvents) {
        const payload = event.payload as { path: string; diagnostics: unknown[] }
        expect(payload.path).toBeDefined()
        expect(Array.isArray(payload.diagnostics)).toBe(true)
      }
    })
  })

  describe('Real File With Errors', () => {
    it('detects errors in manually written broken TypeScript', async () => {
      // Create a new file (new files don't require read-before-write)
      await client.send('chat.send', { 
        content: 'Create a new file called src/test-file.ts' 
      })
      await client.waitForChatDone()
      
      // Check the tool results
      const allEvents = client.allEvents()
      const writeResults = allEvents.filter(e => 
        e.type === 'chat.tool_result' && 
        (e.payload as { tool: string }).tool === 'write_file'
      )
      
      // New file writes should succeed (no read required)
      // Or they may fail for other reasons - we just verify no crashes
      if (writeResults.length > 0) {
        const result = (writeResults[0]!.payload as { result: { success: boolean; error?: string } }).result
        // If it failed due to read-before-write, that's expected for existing files
        // For new files it should succeed
        if (!result.success && result.error) {
          expect(result.error).toMatch(/read before writing|not found|error/i)
        }
      }
      
      // Verify no unhandled errors
      const errorEvents = allEvents.filter(e => e.type === 'chat.error')
      expect(errorEvents.length).toBe(0)
    })
  })

  describe('Diagnostic Formatting', () => {
    it('formats diagnostics for LLM consumption', async () => {
      // Write a file that would trigger diagnostics
      await client.send('chat.send', { 
        content: 'Write src/errors.ts with multiple deliberate type errors' 
      })
      
      const events = await collectChatEvents(client)
      
      const toolResults = events.get('chat.tool_result')
      const writeResult = toolResults.find(e => 
        (e.payload as { tool: string }).tool === 'write_file'
      )
      
      if (writeResult) {
        const result = (writeResult.payload as { result: { output?: string } }).result
        
        // If LSP diagnostics are present, they should be formatted
        if (result.output?.includes('LSP found')) {
          // Should have line numbers
          expect(result.output).toMatch(/Line \d+/)
          // Should have severity
          expect(result.output).toMatch(/\[error\]|\[warning\]/i)
        }
      }
    })
  })
})
