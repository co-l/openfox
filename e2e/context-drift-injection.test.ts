/**
 * Context Drift Injection at the Point of Contention (E2E)
 *
 * Tool/system-prompt <system-reminder>s are injected immediately when the
 * change happens (ADBC), not deferred to the next turn start (ABCD).
 *
 * Scenario under test: an MCP server is added via the UI path while the
 * session is idle. The tool-change reminder must appear in the conversation
 * right away — before any new user message — and exactly once.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface SessionMessage {
  isSystemGenerated?: boolean
  content?: string
  messageKind?: string
}

describe('Context drift injection at the point of contention', () => {
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
    const restProject = await createProject(server.url, { name: 'Drift Injection', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
    try {
      const servers = await fetchMcpServers()
      for (const s of servers) {
        await removeMcpServer(s.name)
      }
    } catch {
      /* ignore */
    }
  })

  async function fetchMcpServers() {
    const res = await fetch(`${server.url}/api/mcp/servers`)
    const data = (await res.json()) as { servers: Array<{ name: string }> }
    return data.servers
  }

  async function addMcpServer(name: string, command: string, args?: string[]) {
    const res = await fetch(`${server.url}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command, args }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string }
      throw new Error(err.error ?? `Failed to add MCP server: ${res.status}`)
    }
    return res.json()
  }

  async function removeMcpServer(name: string) {
    await fetch(`${server.url}/api/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  async function fetchSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}`)
    const data = (await res.json()) as { messages: SessionMessage[] }
    return data.messages
  }

  function toolChangeReminders(messages: SessionMessage[]): SessionMessage[] {
    return messages.filter(
      (m) =>
        m.isSystemGenerated === true &&
        (m.content?.includes('The available tools have changed') ||
          m.content?.includes('You now have access to new tools')),
    )
  }

  it('injects a tool-change reminder immediately when an MCP server is added (before the next user message)', async () => {
    const sessionId = client.getSession()!.id

    // Establish a baseline turn so a cached prompt exists
    await client.send('chat.send', { content: 'hi' })
    await client.waitForChatDone()

    // Add an MCP server via the UI path — the point of contention. No user
    // message is sent afterwards: the reminder must already be in the
    // conversation by now.
    const mockServerPath = join(__dirname, 'mock-mcp-server.ts')
    await addMcpServer('test-server', 'npx', ['tsx', mockServerPath])
    await sleep(1500)

    const messages = await fetchSessionMessages(sessionId)
    const reminders = toolChangeReminders(messages)

    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.content).toContain('test-server')
  })

  it('does not re-announce the same tool change on the next turn (exactly-once)', async () => {
    const sessionId = client.getSession()!.id

    await client.send('chat.send', { content: 'hi' })
    await client.waitForChatDone()

    const mockServerPath = join(__dirname, 'mock-mcp-server.ts')
    await addMcpServer('test-server', 'npx', ['tsx', mockServerPath])
    await sleep(1500)

    // A subsequent turn must not re-announce the already-injected change
    await client.send('chat.send', { content: 'hi again' })
    await client.waitForChatDone()

    const messages = await fetchSessionMessages(sessionId)
    expect(toolChangeReminders(messages)).toHaveLength(1)
  })
})
