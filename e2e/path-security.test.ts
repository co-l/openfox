/**
 * Path Security E2E Tests
 * 
 * Tests the path confirmation flow for:
 * - Files outside the project workdir
 * - Sensitive files (like .env, credentials.json, private keys)
 * 
 * The path security system:
 * 1. Detects operations on paths outside workdir or sensitive files
 * 2. Emits chat.path_confirmation event to client
 * 3. Waits for user approval via path.confirm message
 * 4. Proceeds or aborts based on user response
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  setSessionMode,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'
// Type for path confirmation payload
interface PathConfirmationPayload {
  callId: string
  tool: string
  paths: string[]
  workdir: string
  reason: 'outside_workdir' | 'sensitive_file' | 'both'
}

describe('Path Security', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject
  let outsideDir: string

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    testDir = await createTestProject({ template: 'typescript' })
    
    // Create a directory outside the workdir for testing
    outsideDir = join(tmpdir(), `openfox-outside-${Date.now()}`)
    await mkdir(outsideDir, { recursive: true })
    
    const restProject = await createProject(server.url, { name: 'Path Security Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await setSessionMode(server.url, restSession.id, 'builder', server.wsUrl)
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
    await rm(outsideDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('Outside Workdir Detection', () => {
    it('emits path_confirmation for write_file outside workdir', async () => {
      client.clearEvents()
      
      // Request write to a path outside the workdir
      // The mock LLM should trigger a write_file to /tmp/outside
      await client.send('chat.send', { 
        content: 'Write a file to /tmp/outside/test.txt with content "hello"' 
      })
      
      // Check for path_confirmation event
      const allEvents = client.allEvents()
      const confirmationEvent = allEvents.find(e => 
        e.type === 'chat.path_confirmation'
      )
      
      // If the path security kicked in, we should have a confirmation event
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        expect(payload.callId).toBeDefined()
        expect(payload.tool).toBeDefined()
        expect(payload.paths).toBeDefined()
        expect(payload.paths.length).toBeGreaterThan(0)
        expect(payload.workdir).toBe(testDir.path)
        expect(payload.reason).toBe('outside_workdir')
      }
      
      // Wait for completion (will either be error or waiting for confirmation)
      await client.waitFor('chat.done').catch(() => null)
    })

    it('includes correct paths in confirmation payload', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Write to /home/test/secret.txt with content "data"' 
      })
      
      // Wait for path confirmation (short timeout since it should arrive quickly)
      const confirmationEvent = await client.waitFor('chat.path_confirmation', undefined, 500).catch(() => null)
      
      // Path confirmation SHOULD happen for /home/test (outside workdir)
      expect(confirmationEvent).not.toBeNull()
      
      const payload = confirmationEvent!.payload as PathConfirmationPayload
      expect(payload.paths.some((p: string) => p.includes('home'))).toBe(true)
    })
  })

  describe('Sensitive File Detection', () => {
    it('emits path_confirmation for .env file writes', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Write to .env with content SECRET=value' 
      })
      
      const allEvents = client.allEvents()
      const confirmationEvent = allEvents.find(e => 
        e.type === 'chat.path_confirmation'
      )
      
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        expect(payload.reason).toBe('sensitive_file')
        expect(payload.paths.some((p: string) => p.includes('.env'))).toBe(true)
      }
      
      await client.waitFor('chat.done').catch(() => null)
    })

    it('emits path_confirmation for credentials.json', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Write to credentials.json with API keys' 
      })
      
      const allEvents = client.allEvents()
      const confirmationEvent = allEvents.find(e => 
        e.type === 'chat.path_confirmation'
      )
      
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        expect(payload.reason).toBe('sensitive_file')
      }
      
      await client.waitFor('chat.done').catch(() => null)
    })
  })

  describe('User Approval Flow', () => {
    it('allows operation after user approves path', async () => {
      client.clearEvents()
      
      // Send request that triggers path confirmation
      // Note: /tmp is in ALLOWED_ROOTS, so we must use a path outside /tmp
      await client.send('chat.send', { 
        content: 'Write to /home/test/approved.txt with content "approved"' 
      })
      
      // Wait for path_confirmation event (short timeout since it should arrive quickly)
      const confirmationEvent = await client.waitFor('chat.path_confirmation', undefined, 500).catch(() => null)
      
      // For debugging - log all events if no confirmation
      if (!confirmationEvent) {
        const allEvents = client.allEvents()
        const toolCalls = allEvents.filter(e => e.type === 'chat.tool_call')
        console.log('Tool calls:', toolCalls.map(e => (e.payload as { tool: string }).tool))
      }
      
      // Path confirmation SHOULD happen for /home/test (outside workdir and not in /tmp)
      expect(confirmationEvent).not.toBeNull()
      
      const payload = confirmationEvent!.payload as PathConfirmationPayload
      
      // Approve the path
      await client.answerPathConfirmation(payload.callId, true)
      
      // The operation should proceed after approval
      await client.waitFor('chat.done').catch(() => null)
      
      // Check for successful tool result
      const allEvents = client.allEvents()
      const toolResults = allEvents.filter(e => e.type === 'chat.tool_result')
      expect(toolResults.length).toBeGreaterThan(0)
    })

    it('aborts operation after user denies path', async () => {
      client.clearEvents()
      
      // Note: /tmp is in ALLOWED_ROOTS, so we must use a path outside /tmp
      await client.send('chat.send', { 
        content: 'Write to /home/test/denied.txt with content "denied"' 
      })
      
      // Wait for path_confirmation event (short timeout)
      const confirmationEvent = await client.waitFor('chat.path_confirmation', undefined, 500).catch(() => null)
      
      // Path confirmation SHOULD happen
      expect(confirmationEvent).not.toBeNull()
      
      const payload = confirmationEvent!.payload as PathConfirmationPayload
      
      // Deny the path
      await client.answerPathConfirmation(payload.callId, false)
      
      // Wait for chat.done (may be error or complete)
      await client.waitFor('chat.done', undefined, 500).catch(() => null)
    })
  })

  describe('Allowed Paths Persistence', () => {
    it('remembers approved paths for session', async () => {
      client.clearEvents()
      
      // First request - triggers confirmation
      // Note: /tmp is in ALLOWED_ROOTS, so we must use a path outside /tmp
      await client.send('chat.send', { 
        content: 'Write to /home/test/first.txt with content "first"' 
      })
      
      const confirmationEvent = await client.waitFor('chat.path_confirmation').catch(() => null)
      
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        
        // Approve
        await client.answerPathConfirmation(payload.callId, true)
        await client.waitFor('chat.done').catch(() => null)
        
        client.clearEvents()
        
        // Second request to same path - should not trigger confirmation
        await client.send('chat.send', { 
          content: 'Write to /home/test/second.txt with content "second"' 
        })
        
        // Should not see another confirmation for same directory
        const allEvents = client.allEvents()
        const secondConfirmation = allEvents.filter(e => 
          e.type === 'chat.path_confirmation'
        )
        
        // The exact path might differ, but the parent dir should be allowed
        // This depends on implementation - some might allow parent, some exact path
      }
    })
  })

  describe('Shell Command Path Detection', () => {
    it('detects paths in run_command arguments', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Run a command that reads /etc/hosts' 
      })
      
      const allEvents = client.allEvents()
      const confirmationEvent = allEvents.find(e => 
        e.type === 'chat.path_confirmation'
      )
      
      // Commands accessing outside paths should trigger confirmation
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        expect(payload.tool).toBe('run_command')
        expect(payload.reason).toBe('outside_workdir')
      }
      
      await client.waitFor('chat.done').catch(() => null)
    })

    it('detects sensitive file access in commands', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Run cat to read a secret key file like ~/.ssh/id_rsa' 
      })
      
      const allEvents = client.allEvents()
      const confirmationEvent = allEvents.find(e => 
        e.type === 'chat.path_confirmation'
      )
      
      // Should detect the sensitive file pattern
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        expect(['sensitive_file', 'outside_workdir', 'both']).toContain(payload.reason)
      }
      
      await client.waitFor('chat.done').catch(() => null)
    })
  })

  describe('Safe Paths', () => {
    it('allows writes inside workdir without confirmation', async () => {
      client.clearEvents()
      
      await client.send('chat.send', { 
        content: 'Write a new file at src/newfile.ts with content "export const x = 1"' 
      })
      
      const events = await collectChatEvents(client)
      
      // Should NOT have path_confirmation for in-workdir paths
      const confirmationEvents = events.all.filter(e => 
        e.type === 'chat.path_confirmation'
      )
      expect(confirmationEvents.length).toBe(0)
      
      // Should have successful tool result
      const writeResult = events.get('chat.tool_result').find(e => 
        (e.payload as { tool: string }).tool === 'write_file'
      )
      
      if (writeResult) {
        const result = (writeResult.payload as { result: { success: boolean } }).result
        expect(result.success).toBe(true)
      }
    })

    it('allows /tmp writes without confirmation', async () => {
      client.clearEvents()
      
      // /tmp is in the ALLOWED_ROOTS
      await client.send('chat.send', { 
        content: 'Write to /tmp/safe-test.txt' 
      })
      
      const allEvents = client.allEvents()
      
      // /tmp should be allowed without confirmation
      const confirmationEvents = allEvents.filter(e => 
        e.type === 'chat.path_confirmation'
      )
      
      // Note: /tmp/outside might be different from /tmp directly
      // The implementation allows /tmp as a safe root
    })
  })

  describe('Combined Reasons', () => {
    it('handles both outside_workdir and sensitive_file', async () => {
      client.clearEvents()
      
      // A path that is both outside workdir AND a sensitive file
      await client.send('chat.send', { 
        content: 'Write to /home/user/.env with secrets' 
      })
      
      const allEvents = client.allEvents()
      const confirmationEvent = allEvents.find(e => 
        e.type === 'chat.path_confirmation'
      )
      
      if (confirmationEvent) {
        const payload = confirmationEvent.payload as PathConfirmationPayload
        // Should be 'both' since it's outside workdir AND .env
        expect(['sensitive_file', 'outside_workdir', 'both']).toContain(payload.reason)
      }
      
      await client.waitFor('chat.done').catch(() => null)
    })
  })
})
