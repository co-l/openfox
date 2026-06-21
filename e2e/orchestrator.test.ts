/**
 * Runner/Orchestrator E2E Tests
 *
 * Tests the build → verify → done/blocked cycle.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  collectUntilPhase,
  assertNoErrors,
  createProject,
  createSession,
  setSessionMode,
  stopSessionChat,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

describe.skip('Runner/Orchestrator', () => {
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

    const restProject = await createProject(server.url, { name: 'Orchestrator Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('runner.launch', () => {
    it('only works in builder mode', async () => {
      // In planner mode, should fail
      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('INVALID_MODE')
    })

    it('requires pending criteria', async () => {
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NO_WORK')
    })

    it('starts runner with pending criteria', async () => {
      // Use chat.send with session_metadata tool (works reliably)
      await client.send('chat.send', {
        content: 'Add criterion ID "func-exists": "Function add exists in src/math.ts". Use session_metadata tool.',
      })
      await client.waitForChatDone()

      // Verify criterion was added
      const session = client.getSession()!
      expect(session.metadataEntries?.['criteria']?.length ?? 0).toBeGreaterThan(0)

      // Switch to builder
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Launch runner - should acknowledge since we have pending criteria
      const response = await client.send('runner.launch', {})
      expect(response.type).toBe('ack')

      // Wait for runner to start (isRunning becomes true)
      await client.waitFor('session.running', (payload: { isRunning: boolean }) => payload.isRunning === true, 1_500)

      // Stop quickly - this test only verifies launch
      await stopSessionChat(server.url, sessionId)
      await client.waitFor('session.running', (payload: { isRunning: boolean }) => payload.isRunning === false, 1_500)
    })
  })

  describe('Build → Verify Cycle', () => {
    it.skip('runs builder then verifier', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use session_metadata.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      const events = await collectUntilPhase(client, 'done', 15_000)
      assertNoErrors(events)

      const phases = client
        .allEvents()
        .filter((e) => e.type === 'phase.changed')
        .map((e) => (e.payload as { phase: string }).phase)

      expect(phases).toContain('build')
      expect(phases).toContain('verification')
      expect(phases).toContain('done')
    })
  })

  describe('Done State', () => {
    it.skip('reaches done when all criteria pass', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use session_metadata.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      await collectUntilPhase(client, 'done', 1_500)

      const session = client.getSession()!
      expect(session.phase).toBe('done')
      expect(session.isRunning).toBe(false)
      const criteria = session.metadataEntries?.['criteria'] ?? []
      const c0 = criteria[0] as { status: string } | undefined
      expect(c0?.status).toBe('passed')
    })
  })

  describe('Blocked State', () => {
    it.skip('reaches blocked after repeated failures', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "verify-fail": "Verifier should fail this criterion". Use session_metadata.',
      })
      await client.waitForChatDone()

      await client.send('mode.accept', {})

      await collectUntilPhase(client, 'blocked', 5_000)

      const session = client.getSession()!
      expect(session.phase).toBe('blocked')
    })
  })

  describe('Abort Runner', () => {
    it('aborts runner on chat.stop', async () => {
      const sessionId = client.getSession()!.id

      // Add criterion
      await client.send('chat.send', {
        content: 'Add criterion: "Something happens". Use session_metadata.',
      })
      await client.waitForChatDone()

      // Switch to builder and launch
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      // Wait a bit then stop
      await new Promise((resolve) => setTimeout(resolve, 200))
      await stopSessionChat(server.url, sessionId)

      // Should have stopped
      await client.waitFor('chat.done')

      // Session should not be running
      // (may need a moment to update)
      await new Promise((resolve) => setTimeout(resolve, 500))
      const session = client.getSession()!
      expect(session.isRunning).toBe(false)
    })

    it('stops session when aborted with queued message', async () => {
      const sessionId = client.getSession()!.id

      // Clear events so we start fresh
      client.clearEvents()

      // Send a message to start a session turn (goes through QueueProcessor)
      await fetch(`${server.url}/api/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Run a command: execute shell to list files.' }),
      })

      // Wait for session to be running
      await client.waitFor('session.running', (payload: { isRunning: boolean }) => payload.isRunning === true, 3_000)

      // Queue a second message while session is running
      const distinctiveContent = 'SECOND_MESSAGE_' + Date.now()
      const queueRes = await fetch(`${server.url}/api/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: distinctiveContent }),
      })
      const queueData = (await queueRes.json()) as { success: boolean; queueState: Array<{ content: string }> }
      expect(queueData.success).toBe(true)
      expect(queueData.queueState.length).toBe(1)
      expect(queueData.queueState[0]!.content).toBe(distinctiveContent)

      // Abort and capture response
      const stopResult = await stopSessionChat(server.url, sessionId)

      // Abort response should include the queued message (not silently discarded)
      expect(stopResult.queuedMessages).toBeDefined()
      expect(stopResult.queuedMessages!.length).toBe(1)
      expect(stopResult.queuedMessages![0]!.content).toBe(distinctiveContent)

      // Wait for session to report not running
      await client.waitFor('session.running', (payload: { isRunning: boolean }) => payload.isRunning === false, 3_000)

      // Give it a moment to settle
      await new Promise((resolve) => setTimeout(resolve, 1_000))

      // Session should NOT be running
      const session = client.getSession()!
      expect(session.isRunning).toBe(false)

      // Fetch messages from REST API to verify the queued message was NOT processed
      const res = await fetch(`${server.url}/api/sessions/${sessionId}`)
      const data = (await res.json()) as { messages: Array<{ content: string }> }
      const processed = data.messages.some((m) => m.content === distinctiveContent)
      expect(processed).toBe(false)
    })
  })

  describe('Nudge Messages', () => {
    it.skip('injects nudge messages between iterations', async () => {
      await client.send('criteria.edit', {
        criteria: [
          {
            id: 'nudge-docs',
            description: 'src/math.ts has documentation comments',
            status: { type: 'pending' },
            attempts: [],
          },
        ],
      })
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)
      await client.send('runner.launch', {})

      await client.waitFor(
        'chat.message',
        (payload: unknown) => {
          const message = (payload as { message: { content: string; isSystemGenerated?: boolean } }).message
          return (
            message.isSystemGenerated === true &&
            message.content.includes('Continue working on the acceptance criteria')
          )
        },
        1_500,
      )

      // Check for system-generated messages (nudges)
      const events = client.allEvents()
      const messages = events.filter((e) => e.type === 'chat.message')
      const systemMessages = messages.filter((e) => {
        const payload = e.payload as { message: { isSystemGenerated?: boolean } }
        return payload.message.isSystemGenerated === true
      })

      // Should have at least the kickoff message
      expect(
        systemMessages.some((e) => {
          const payload = e.payload as { message: { content: string } }
          return payload.message.content.includes('Continue working on the acceptance criteria')
        }),
      ).toBe(true)
    })
  })

  describe('Reset Blocked', () => {
    it.skip('resets from blocked state on user intervention', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "verify-fail": "Verifier should fail this criterion". Use session_metadata.',
      })
      await client.waitForChatDone()
      await client.send('mode.accept', {})

      await collectUntilPhase(client, 'blocked', 5_000)

      // Send user message to reset
      await client.send('chat.send', {
        content: 'Let me help you. Just mark the criterion as complete.',
      })

      // Should receive phase change back to build
      const phaseEvent = await client
        .waitFor(
          'phase.changed',
          (payload: unknown) => {
            return (payload as { phase: string }).phase === 'build'
          },
          8_000,
        )
        .catch(() => null)

      expect((phaseEvent?.payload as { phase: string } | undefined)?.phase).toBe('build')
    })
  })

  describe('Stats and Notifications', () => {
    it('emits chat.done with complete at end of runner execution', async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "trivial-pass": "Trivial pass criterion". Use session_metadata.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Clear events before runner starts
      client.clearEvents()

      await client.send('runner.launch', {})

      // Wait for completion
      await collectUntilPhase(client, 'done', 1_500)

      // Count chat.done events with 'complete' reason
      const events = client.allEvents()
      const completeDones = events.filter(
        (e) => e.type === 'chat.done' && (e.payload as { reason: string }).reason === 'complete',
      )

      // Should have at least ONE chat.done with 'complete' at the end
      expect(completeDones.length).toBeGreaterThanOrEqual(1)

      // That event should have aggregated stats
      const stats = (completeDones[0]!.payload as { stats?: object }).stats
      expect(stats).toBeDefined()
    })

    it.skip('emits chat.done with complete at end of multi-iteration run', { timeout: 10_000 }, async () => {
      await client.send('chat.send', {
        content: 'Add criterion ID "file-created": "A new file utils.ts exists". Use session_metadata.',
      })
      await client.waitForChatDone()
      const sessionId = client.getSession()!.id
      await setSessionMode(server.url, sessionId, 'builder', server.wsUrl)

      // Clear events
      client.clearEvents()

      await client.send('runner.launch', {})

      // Wait for completion
      await collectUntilPhase(client, 'done', 5_000)

      const events = client.allEvents()

      // Count tool calls to verify we had multiple iterations
      const toolCalls = events.filter((e) => e.type === 'chat.tool_call')

      // If there were tool calls (multiple LLM turns), there should be at least 1 chat.done
      if (toolCalls.length > 0) {
        const completeDones = events.filter(
          (e) => e.type === 'chat.done' && (e.payload as { reason: string }).reason === 'complete',
        )
        expect(completeDones.length).toBeGreaterThanOrEqual(1)
      }
    })
  })
})
