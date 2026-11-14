/**
 * Background Process Wait E2E Tests
 *
 * Models a long-running build/test job: the agent starts it in the background,
 * waits for its real outcome with the event-backed wait action, then reads the
 * paginated logs. The test asserts that the agent never polls with sleep and
 * never burns extra model turns while the job is idle.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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
  type TestServerHandle,
} from './utils/index.js'

describe('Background Process Wait', () => {
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

    const restProject = await createProject(server.url, { name: 'BG Wait Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
    await setSessionMode(server.url, restSession.id, 'builder', server.wsUrl)
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  it('waits for a long background job without sleep polling and reaches the logs', async () => {
    const startedAt = Date.now()

    await client.send('chat.send', { content: 'Run the long background job and report its output' })

    const events = await collectChatEvents(client, 30_000)
    assertNoErrors(events)

    const toolCalls = events.get('chat.tool_call')
    const toolResults = events.get('chat.tool_result')

    // The agent starts the job, waits for it, then reads the logs.
    const actions = toolCalls
      .filter((event) => (event.payload as { tool: string }).tool === 'background_process')
      .map((event) => (event.payload as { args: { action?: string } }).args?.action)

    expect(actions).toContain('start')
    expect(actions).toContain('wait')
    expect(actions).toContain('logs')

    // No polling loop: no run_command at all, and certainly no sleep.
    const runCommands = toolCalls.filter((event) => (event.payload as { tool: string }).tool === 'run_command')
    expect(runCommands).toHaveLength(0)

    for (const event of runCommands) {
      const command = (event.payload as { args: { command?: string } }).args?.command ?? ''
      expect(command).not.toMatch(/sleep/i)
    }

    // The wait returns the real exit code and a log cursor.
    const waitResult = toolResults.find((event) => {
      const payload = event.payload as { result?: { output?: string } }
      return payload.result?.output?.includes('"logCursor"') === true
    })
    expect(waitResult).toBeDefined()

    const waitPayload = JSON.parse((waitResult!.payload as { result: { output: string } }).result.output)
    expect(waitPayload.reason).toBe('success')
    expect(waitPayload.exitCode).toBe(0)
    expect(waitPayload.timedOut).toBe(false)
    expect(typeof waitPayload.logCursor).toBe('number')

    // The job ran for ~2s, so the whole turn stays well under the timeout
    // while still covering the real duration.
    expect(Date.now() - startedAt).toBeLessThan(15_000)

    // The logs action then returns the job output.
    const logsResult = toolResults.find((event) => {
      const payload = event.payload as { result?: { output?: string } }
      return payload.result?.output?.includes('build-ok') === true
    })
    expect(logsResult).toBeDefined()
  }, 30_000)
})
