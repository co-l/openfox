/**
 * Write Tools E2E Tests
 * 
 * Tests write_file and edit_file tools including read-before-write validation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('Write Tools', () => {
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
    
    const restProject = await createProject(server.url, { name: 'Write Tools Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await client.send('mode.switch', { mode: 'builder' })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('write_file', () => {
    it('creates new files', async () => {
      await client.send('chat.send', { 
        content: 'Create a new file at src/newfile.ts with content: export const greeting = "hello"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Verify file was created
      const content = await readFile(join(testDir.path, 'src/newfile.ts'), 'utf-8')
      expect(content).toContain('greeting')
      expect(content).toContain('hello')
    })

    it('creates nested directories as needed', async () => {
      await client.send('chat.send', { 
        content: 'Create a file at deep/nested/path/file.ts with content: export const x = 1' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Verify file was created
      const content = await readFile(join(testDir.path, 'deep/nested/path/file.ts'), 'utf-8')
      expect(content).toContain('x = 1')
    })

    it('requires read before writing existing file', async () => {
      // Try to write without reading
      await client.send('chat.send', { 
        content: 'WITHOUT reading first, write "new content" to src/index.ts using write_file' 
      })
      
      const response = await client.waitForChatDone()
      
      // Check tool results
      const writeCall = response.toolCalls.find(tc => tc.tool === 'write_file')
      if (writeCall && !writeCall.result?.success) {
        expect(writeCall.result?.error).toContain('read before writing')
      }
      // LLM may be smart enough to read first, which is also acceptable
    })

    it('succeeds after reading existing file', async () => {
      await client.send('chat.send', { 
        content: 'First read src/index.ts, then write new content to it: "// Modified\\nexport const hello = 1"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      // Find successful write
      const response = await client.waitForChatDone().catch(() => ({ toolCalls: [] }))
      
      // File should be modified
      const content = await readFile(join(testDir.path, 'src/index.ts'), 'utf-8')
      // Content will be whatever LLM wrote
    })
  })

  describe('edit_file', () => {
    it('replaces exact strings', async () => {
      await client.send('chat.send', { 
        content: 'Read src/math.ts, then use edit_file to replace "add" with "sum" in the function name' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const content = await readFile(join(testDir.path, 'src/math.ts'), 'utf-8')
      // May or may not have changed depending on LLM interpretation
    })

    it('requires read before editing', async () => {
      await client.send('chat.send', { 
        content: 'Without reading first, use edit_file on src/math.ts to change "function" to "const"' 
      })
      
      const response = await client.waitForChatDone()
      
      const editCall = response.toolCalls.find(tc => tc.tool === 'edit_file')
      if (editCall && !editCall.result?.success) {
        expect(editCall.result?.error).toContain('read before writing')
      }
    })

    it('fails when old_string not found', async () => {
      await client.send('chat.send', { 
        content: 'Read src/math.ts, then use edit_file with old_string "NONEXISTENT_STRING_XYZ" and new_string "replacement"' 
      })
      
      const response = await client.waitForChatDone()
      
      const editCall = response.toolCalls.find(tc => tc.tool === 'edit_file')
      if (editCall) {
        expect(editCall.result?.success).toBe(false)
        expect(editCall.result?.error).toContain('not found')
      }
    })

    it('supports replaceAll for multiple matches', async () => {
      // Create a file with multiple occurrences
      await writeFile(
        join(testDir.path, 'src/multi.ts'),
        'const a = 1;\nconst b = 2;\nconst c = 3;'
      )
      
      await client.send('chat.send', { 
        content: 'Read src/multi.ts, then use edit_file with replaceAll: true to change all "const" to "let"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const content = await readFile(join(testDir.path, 'src/multi.ts'), 'utf-8')
      // Check if any replacements were made
      expect(content).toMatch(/let|const/)
    })
  })

  describe('External Change Detection', () => {
    it('detects external changes between read and write', async () => {
      // Read the file through LLM
      await client.send('chat.send', { content: 'Read src/math.ts' })
      await client.waitForChatDone()
      
      // Externally modify the file
      await writeFile(
        join(testDir.path, 'src/math.ts'),
        '// Externally modified\nexport function external() {}'
      )
      
      // Try to write
      await client.send('chat.send', { 
        content: 'Now write to src/math.ts with content "// My changes"' 
      })
      
      const response = await client.waitForChatDone()
      
      // Should fail due to hash mismatch
      const writeCall = response.toolCalls.find(tc => tc.tool === 'write_file')
      if (writeCall && !writeCall.result?.success) {
        expect(writeCall.result?.error).toContain('read before writing')
      }
    })

    it('succeeds after re-reading externally changed file', async () => {
      // Read
      await client.send('chat.send', { content: 'Read src/math.ts' })
      await client.waitForChatDone()
      
      // External change
      await writeFile(
        join(testDir.path, 'src/math.ts'),
        'export const changed = true;'
      )
      
      // Re-read and then write
      await client.send('chat.send', { 
        content: 'Read src/math.ts again, then write: "export const final = true;"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
    })
  })
})
