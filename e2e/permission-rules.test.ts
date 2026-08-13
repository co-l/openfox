/**
 * Permission Rules E2E Tests
 *
 * Tests server-side permission rules (ALLOW/DENY/ASK) through the full
 * server stack: config file → rule loading → tool execution → confirmation.
 *
 * Flows covered:
 * 1. DENY rule blocks a run_command tool call with rule_denied reason
 * 2. ASK rule emits a path_confirmation event that can be approved
 * 3. Approving with alwaysAllow=true promotes to a session ALLOW rule
 *    so a second identical call does not re-prompt
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  setSessionMode,
  answerPathConfirmation,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

interface PathConfirmationPayload {
  callId: string
  tool: string
  paths: string[]
  workdir: string
  reason:
    'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command' | 'git_no_verify' | 'rule_denied' | 'rule_ask'
}

async function writeProjectPermissions(
  workdir: string,
  rules: Array<{ effect: string; tool: string; pattern?: string }>,
): Promise<void> {
  const dir = join(workdir, '.openfox')
  await mkdir(dir, { recursive: true })
  const config = { version: 1, rules }
  await writeFile(join(dir, 'permissions.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

describe('Permission Rules', () => {
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
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  async function setupSession(): Promise<string> {
    const restProject = await createProject(server.url, { name: 'Permission Rules Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await setSessionMode(server.url, restSession.id, 'builder', server.wsUrl)
    return restSession.id
  }

  it('DENY rule on run_command blocks execution with rule_denied reason', async () => {
    await writeProjectPermissions(testDir.path, [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }])
    await setupSession()

    client.clearEvents()
    await client.send('chat.send', {
      content: 'Run rm -rf root to delete everything',
    })

    const response = await client.waitForChatDone()

    // The tool call should have been blocked by the DENY rule
    const runCommandCalls = response.toolCalls.filter((tc) => tc.tool === 'run_command')
    expect(runCommandCalls.length).toBeGreaterThan(0)

    const blockedCall = runCommandCalls[0]!
    expect(blockedCall.result).toBeDefined()
    expect(blockedCall.result!.success).toBe(false)
    expect(blockedCall.result!.error).toContain('blocked by a permission rule')

    // No path_confirmation event should be emitted for DENY (it throws directly)
    const confirmationEvents = client.allEvents().filter((e) => e.type === 'chat.path_confirmation')
    expect(confirmationEvents.length).toBe(0)
  })

  it('ASK rule on run_command emits path_confirmation with rule_ask reason', async () => {
    await writeProjectPermissions(testDir.path, [
      { effect: 'ASK', tool: 'run_command', pattern: 'terragrunt destroy *' },
    ])
    const sessionId = await setupSession()

    client.clearEvents()
    await client.send('chat.send', {
      content: 'Run terragrunt destroy on the test environment',
    })

    // Wait for the path_confirmation event
    const confirmationEvent = await client.waitFor('chat.path_confirmation', undefined, 5000).catch(() => null)

    expect(confirmationEvent).not.toBeNull()
    const payload = confirmationEvent!.payload as PathConfirmationPayload
    expect(payload.reason).toBe('rule_ask')
    expect(payload.tool).toBe('run_command')
    expect(payload.callId).toBeDefined()

    // Deny the confirmation
    await answerPathConfirmation(server.url, sessionId, payload.callId, false)

    await client.waitForChatDone().catch(() => null)

    // The tool result should reflect the denial
    const response = client.allEvents()
    const toolResults = response.filter((e) => e.type === 'chat.tool_result')
    const deniedResult = toolResults.find((e) => {
      const payload = e.payload as { result?: { success?: boolean; error?: string } }
      return payload.result?.success === false && payload.result?.error?.includes('permission rule')
    })
    expect(deniedResult).toBeDefined()
  })

  it('ASK rule → approve with alwaysAllow → second call does not re-prompt', async () => {
    await writeProjectPermissions(testDir.path, [
      { effect: 'ASK', tool: 'run_command', pattern: 'terragrunt destroy *' },
    ])
    const sessionId = await setupSession()

    // --- First call: triggers ASK confirmation ---
    client.clearEvents()
    await client.send('chat.send', {
      content: 'Run terragrunt destroy on the test environment',
    })

    const confirmationEvent1 = await client.waitFor('chat.path_confirmation', undefined, 5000).catch(() => null)
    expect(confirmationEvent1).not.toBeNull()
    const payload1 = confirmationEvent1!.payload as PathConfirmationPayload
    expect(payload1.reason).toBe('rule_ask')

    // Approve with alwaysAllow=true (promotes ASK to session ALLOW)
    await answerPathConfirmation(server.url, sessionId, payload1.callId, true, true)
    await client.waitForChatDone().catch(() => null)

    // --- Second call: should NOT re-prompt (session ALLOW rule active) ---
    client.clearEvents()
    await client.send('chat.send', {
      content: 'Run terragrunt destroy on the test environment again',
    })

    const response2 = await client.waitForChatDone()

    // No path_confirmation event should be emitted on the second call
    const confirmationEvents2 = client.allEvents().filter((e) => e.type === 'chat.path_confirmation')
    expect(confirmationEvents2.length).toBe(0)

    // The tool should have been called (not blocked by ASK/DENY)
    const runCommandCalls2 = response2.toolCalls.filter((tc) => tc.tool === 'run_command')
    expect(runCommandCalls2.length).toBeGreaterThan(0)

    // The tool should NOT have been blocked by a permission rule
    const blockedCall = runCommandCalls2.find(
      (tc) => tc.result?.success === false && tc.result?.error?.includes('permission rule'),
    )
    expect(blockedCall).toBeUndefined()
  })
})
