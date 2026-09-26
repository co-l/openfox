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
 * 4. ALLOW rule lets a matching tool call run without any confirmation
 * 5. Rules on path tools (read_file): DENY blocks, ALLOW exempts the path
 * 6. Precedence: project DENY beats global ASK, global DENY beats project ALLOW
 * 7. Session grants API: listing after alwaysAllow, rule revocation re-prompts,
 *    full revocation, 404 for unknown sessions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
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
  baseUrl: string,
  workdir: string,
  rules: Array<{ effect: string; tool: string; pattern?: string }>,
): Promise<void> {
  const params = new URLSearchParams({ scope: 'project', workdir })
  const response = await fetch(`${baseUrl}/api/permissions?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, rules }),
  })
  if (!response.ok) throw new Error(`Failed to save project permissions: ${await response.text()}`)
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
    await writeProjectPermissions(server.url, testDir.path, [
      { effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' },
    ])
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
    await writeProjectPermissions(server.url, testDir.path, [
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
    await writeProjectPermissions(server.url, testDir.path, [
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

  it('ALLOW rule on run_command lets the call run without any confirmation', async () => {
    await writeProjectPermissions(server.url, testDir.path, [
      { effect: 'ALLOW', tool: 'run_command', pattern: 'terragrunt destroy *' },
    ])
    await setupSession()

    client.clearEvents()
    await client.send('chat.send', {
      content: 'Run terragrunt destroy on the test environment',
    })

    const response = await client.waitForChatDone()

    // No confirmation event: the ALLOW rule covered the whole call.
    const confirmationEvents = client.allEvents().filter((e) => e.type === 'chat.path_confirmation')
    expect(confirmationEvents.length).toBe(0)

    // The command was executed (it may fail for unrelated reasons, e.g. the
    // binary is missing, but it must not be blocked by a permission rule).
    const runCommandCalls = response.toolCalls.filter((tc) => tc.tool === 'run_command')
    expect(runCommandCalls.length).toBeGreaterThan(0)
    const blockedCall = runCommandCalls.find(
      (tc) => tc.result?.success === false && tc.result?.error?.includes('blocked by a permission rule'),
    )
    expect(blockedCall).toBeUndefined()
  })

  it('DENY rule on read_file blocks the path tool call with rule_denied', async () => {
    await writeProjectPermissions(server.url, testDir.path, [
      { effect: 'DENY', tool: 'read_file', pattern: '/home/test/secret*' },
    ])
    await setupSession()

    client.clearEvents()
    await client.send('chat.send', {
      content: 'Read the file /home/test/secret.txt',
    })

    const response = await client.waitForChatDone()

    const readFileCalls = response.toolCalls.filter((tc) => tc.tool === 'read_file')
    expect(readFileCalls.length).toBeGreaterThan(0)

    const blockedCall = readFileCalls[0]!
    expect(blockedCall.result).toBeDefined()
    expect(blockedCall.result!.success).toBe(false)
    expect(blockedCall.result!.error).toContain('blocked by a permission rule')

    // DENY throws before any confirmation dialog.
    const confirmationEvents = client.allEvents().filter((e) => e.type === 'chat.path_confirmation')
    expect(confirmationEvents.length).toBe(0)
  })

  it('ALLOW rule on read_file exempts the path from the outside-workdir confirmation', async () => {
    await writeProjectPermissions(server.url, testDir.path, [
      { effect: 'ALLOW', tool: 'read_file', pattern: '/home/test/secret*' },
    ])
    await setupSession()

    client.clearEvents()
    await client.send('chat.send', {
      content: 'Read the file /home/test/secret.txt',
    })

    const response = await client.waitForChatDone()

    // The read ran (the file does not exist, so it fails with ENOENT) — but
    // without a path confirmation and without a permission-rule block.
    const confirmationEvents = client.allEvents().filter((e) => e.type === 'chat.path_confirmation')
    expect(confirmationEvents.length).toBe(0)

    const readFileCalls = response.toolCalls.filter((tc) => tc.tool === 'read_file')
    expect(readFileCalls.length).toBeGreaterThan(0)
    const blockedCall = readFileCalls.find(
      (tc) => tc.result?.success === false && tc.result?.error?.includes('blocked by a permission rule'),
    )
    expect(blockedCall).toBeUndefined()
  })

  describe('Global vs project precedence', () => {
    // Test-mode servers resolve the global config dir to <cwd>/e2e/.openfox-test.
    const globalPermissionsFile = join(process.cwd(), 'e2e', '.openfox-test', 'permissions.json')

    // Append a global rule for the duration of fn, restoring the file after.
    async function withGlobalRule(
      rule: { effect: string; tool: string; pattern: string },
      fn: () => Promise<void>,
    ): Promise<void> {
      const original = await readFile(globalPermissionsFile, 'utf8')
      const config = JSON.parse(original) as { rules: unknown[] }
      config.rules.push({ ...rule, description: 'e2e precedence test' })
      await writeFile(globalPermissionsFile, JSON.stringify(config, null, 2))
      try {
        await fn()
      } finally {
        await writeFile(globalPermissionsFile, original)
      }
    }

    it('project DENY beats global ASK on the same pattern', async () => {
      await writeProjectPermissions(server.url, testDir.path, [
        { effect: 'DENY', tool: 'run_command', pattern: 'terragrunt destroy *' },
      ])
      await setupSession()

      await withGlobalRule({ effect: 'ASK', tool: 'run_command', pattern: 'terragrunt destroy *' }, async () => {
        client.clearEvents()
        await client.send('chat.send', {
          content: 'Run terragrunt destroy on the test environment',
        })

        const response = await client.waitForChatDone()
        const runCommandCalls = response.toolCalls.filter((tc) => tc.tool === 'run_command')
        expect(runCommandCalls.length).toBeGreaterThan(0)
        const blockedCall = runCommandCalls[0]!
        expect(blockedCall.result!.success).toBe(false)
        expect(blockedCall.result!.error).toContain('blocked by a permission rule')
      })

      // The global ASK never surfaced a dialog because the project DENY won.
      const confirmationEvents = client.allEvents().filter((e) => e.type === 'chat.path_confirmation')
      expect(confirmationEvents.length).toBe(0)
    })

    it('global DENY beats project ALLOW on the same pattern', async () => {
      await writeProjectPermissions(server.url, testDir.path, [
        { effect: 'ALLOW', tool: 'run_command', pattern: 'terragrunt destroy *' },
      ])
      await setupSession()

      await withGlobalRule({ effect: 'DENY', tool: 'run_command', pattern: 'terragrunt destroy *' }, async () => {
        client.clearEvents()
        await client.send('chat.send', {
          content: 'Run terragrunt destroy on the test environment',
        })

        const response = await client.waitForChatDone()
        const runCommandCalls = response.toolCalls.filter((tc) => tc.tool === 'run_command')
        expect(runCommandCalls.length).toBeGreaterThan(0)
        const blockedCall = runCommandCalls[0]!
        expect(blockedCall.result!.success).toBe(false)
        expect(blockedCall.result!.error).toContain('blocked by a permission rule')
      })
    })
  })

  describe('Session grants API', () => {
    const GRANTED_PATTERN = 'terragrunt destroy *'

    it('lists the grant after alwaysAllow, re-prompts after rule revocation, and returns 404 for unknown sessions', async () => {
      await writeProjectPermissions(server.url, testDir.path, [
        { effect: 'ASK', tool: 'run_command', pattern: GRANTED_PATTERN },
      ])
      const sessionId = await setupSession()

      // --- First call: rule_ask confirmation, approved with alwaysAllow ---
      client.clearEvents()
      await client.send('chat.send', {
        content: 'Run terragrunt destroy on the test environment',
      })
      const confirmation1 = await client.waitFor('chat.path_confirmation', undefined, 5000).catch(() => null)
      expect(confirmation1).not.toBeNull()
      const payload1 = confirmation1!.payload as PathConfirmationPayload
      expect(payload1.reason).toBe('rule_ask')
      await answerPathConfirmation(server.url, sessionId, payload1.callId, true, true)
      await client.waitForChatDone().catch(() => null)

      // The grant is listed with tool, pattern and reason.
      const grantsResponse = await fetch(`${server.url}/api/permissions/grants`)
      expect(grantsResponse.ok).toBe(true)
      const grantsBody = (await grantsResponse.json()) as {
        grants: Array<{
          sessionId: string
          rules: Array<{ effect: string; tool: string; pattern?: string; grantedAt: number }>
          paths: Array<{ path: string; reason?: string }>
        }>
      }
      const sessionGrant = grantsBody.grants.find((g) => g.sessionId === sessionId)
      expect(sessionGrant).toBeDefined()
      const ruleGrant = sessionGrant!.rules.find((r) => r.tool === 'run_command' && r.pattern === GRANTED_PATTERN)
      expect(ruleGrant).toBeDefined()
      expect(ruleGrant!.effect).toBe('ALLOW')
      expect(ruleGrant!.grantedAt).toBeGreaterThan(0)

      // --- Second call: no re-prompt while the grant is active ---
      client.clearEvents()
      await client.send('chat.send', {
        content: 'Run terragrunt destroy on the test environment',
      })
      const secondPrompt = await client.waitFor('chat.path_confirmation', undefined, 3000).catch(() => null)
      expect(secondPrompt).toBeNull()
      await client.waitForChatDone().catch(() => null)

      // --- Revoke the rule grant: the next call must prompt again ---
      const revokeRuleResponse = await fetch(
        `${server.url}/api/permissions/grants/${sessionId}/rules?tool=run_command&pattern=${encodeURIComponent(GRANTED_PATTERN)}`,
        { method: 'DELETE' },
      )
      expect(revokeRuleResponse.ok).toBe(true)

      client.clearEvents()
      await client.send('chat.send', {
        content: 'Run terragrunt destroy on the test environment',
      })
      const confirmation3 = await client.waitFor('chat.path_confirmation', undefined, 5000).catch(() => null)
      expect(confirmation3).not.toBeNull()
      const payload3 = confirmation3!.payload as PathConfirmationPayload
      expect(payload3.reason).toBe('rule_ask')
      await answerPathConfirmation(server.url, sessionId, payload3.callId, false)
      await client.waitForChatDone().catch(() => null)

      // --- Revoke the whole session: no grant remains for it ---
      const revokeSessionResponse = await fetch(`${server.url}/api/permissions/grants/${sessionId}`, {
        method: 'DELETE',
      })
      expect(revokeSessionResponse.ok).toBe(true)
      const grantsAfter = (await (await fetch(`${server.url}/api/permissions/grants`)).json()) as {
        grants: Array<{ sessionId: string }>
      }
      expect(grantsAfter.grants.find((g) => g.sessionId === sessionId)).toBeUndefined()

      // --- Unknown sessions: the scoped revocations 404 ---
      const unknownPath = await fetch(
        `${server.url}/api/permissions/grants/does-not-exist/paths?path=/home/test/secret.txt`,
        { method: 'DELETE' },
      )
      expect(unknownPath.status).toBe(404)
      const unknownRule = await fetch(`${server.url}/api/permissions/grants/does-not-exist/rules?tool=run_command`, {
        method: 'DELETE',
      })
      expect(unknownRule.status).toBe(404)
    })
  })
})
