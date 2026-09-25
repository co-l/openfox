import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase, getDatabase } from '../db/index.js'
import { initEventStore, getEventStore } from '../events/index.js'
import { foldPendingConfirmations, foldIsRunning } from '../events/folding.js'
import { SessionManager, type SessionEvent } from './manager.js'
import { createProject } from '../db/projects.js'
import { projectSessionStatus } from '../routes/session-status.js'
import {
  AskUserInterrupt,
  askUserTool,
  cancelQuestionsForSession,
  getPendingQuestionsForSession,
} from '../tools/ask.js'
import { hasPendingPathConfirmation, requestPathAccess } from '../tools/path-security.js'
import type { ToolContext } from '../tools/types.js'
import type { Config } from '../../shared/types.js'
import { cancelSessionInteractions } from './chat-handler.js'

// Default to a Unix shell so the path-extraction assumptions hold on any host.
vi.mock('../utils/platform.js', () => ({
  getPlatformShell: vi.fn(() => ({ command: '/bin/sh', args: ['-c'] })),
}))

const REAL_PLATFORM = process.platform

const mockProviderManager = {
  getCurrentModelContext: () => 200000,
}

function createTestConfig(): Config {
  return {
    llm: { baseUrl: 'http://localhost:8000/v1', model: 'test', timeout: 1000, idleTimeout: 30000, backend: 'vllm' },
    context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 1000 },
    server: { port: 3000, host: 'localhost' },
    database: { path: ':memory:' },
    workdir: process.cwd(),
  }
}

async function waitForPending(callId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (hasPendingPathConfirmation(callId)) return
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Confirmation ${callId} never went pending`)
}

/**
 * cancelSessionInteractions — the shared stop-tail used by the /stop endpoint,
 * the MCP stopSession tool, and session deletion.
 *
 * Stopping a query while it waits on user interaction (Allow/Deny path
 * confirmation or ask_user) must leave the session in a clean, converging
 * state: no pending questions, no pending confirmations (closed out in the
 * event log so they cannot resurrect on the next session.state broadcast or
 * reload), a terminal running.changed, and a final session_updated emission so
 * live clients re-derive the clean state.
 */
describe('cancelSessionInteractions', () => {
  let testDir: string
  let workdir: string
  let sessionManager: SessionManager
  let sessionId: string
  let emitted: SessionEvent[]
  let unsubscribe: () => void

  beforeEach(async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    closeDatabase()
    initDatabase(createTestConfig())
    initEventStore(getDatabase())

    testDir = join(tmpdir(), `openfox-stop-tail-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
    workdir = testDir

    sessionManager = new SessionManager(mockProviderManager as any)
    const project = createProject('stop-tail-test', testDir)
    sessionId = sessionManager.createSession(project.id).id

    emitted = []
    unsubscribe = sessionManager.subscribe((event) => emitted.push(event))
  })

  afterEach(async () => {
    unsubscribe()
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
    closeDatabase()
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
  })

  it('cancels questions and path confirmations, records the terminal state, and forces a final session_updated', async () => {
    // One pending path confirmation (with its persisted pending event).
    const onEvent = vi.fn()
    const confirmationPromise = requestPathAccess(
      ['/etc/passwd'],
      workdir,
      sessionId,
      'call-stop-1',
      'run_command',
      onEvent,
      'normal',
      'cat /etc/passwd',
    )
    await waitForPending('call-stop-1')
    const rejectedConfirmation = expect(confirmationPromise).rejects.toThrow('Session stopped by user')

    // One pending ask_user question.
    const context: ToolContext = {
      workdir,
      sessionId,
      sessionManager,
      toolCallId: 'ask-stop-1',
    }
    let interrupt: unknown = null
    try {
      await askUserTool.execute({ question: 'What should I do?' }, context)
    } catch (err) {
      interrupt = err
    }
    expect(interrupt).toBeInstanceOf(AskUserInterrupt)
    expect(getPendingQuestionsForSession(sessionId)).toHaveLength(1)

    const cancelledCallIds = await cancelSessionInteractions(sessionId, sessionManager, 'Session stopped by user')

    // The cancelled path confirmation is reported back so the caller can
    // broadcast a session.confirmation_resolved for it.
    expect(cancelledCallIds).toEqual(['call-stop-1'])

    // In-memory interaction gates are cleared.
    expect(getPendingQuestionsForSession(sessionId)).toEqual([])
    expect(hasPendingPathConfirmation('call-stop-1')).toBe(false)
    await rejectedConfirmation

    // Event log: the confirmation is closed out (no resurrection on fold),
    // and the terminal running state is recorded.
    const events = getEventStore().getEvents(sessionId)
    expect(foldPendingConfirmations(events)).toEqual([])
    expect(foldIsRunning(events)).toBe(false)
    const runningChanged = events.filter((e) => e.type === 'running.changed')
    expect(runningChanged.length).toBeGreaterThan(0)
    expect(runningChanged[runningChanged.length - 1]!.data).toEqual({ isRunning: false })

    // The final emission is a session_updated so the WS layer re-broadcasts
    // session.state with the clean fold (the last broadcast converges).
    const last = emitted[emitted.length - 1]
    expect(last?.type).toBe('session_updated')
    if (last?.type === 'session_updated') {
      expect(last.session.id).toBe(sessionId)
    }

    // The status projection (drives the "Waiting for input" tooltip) no
    // longer reports waiting for user input.
    const status = projectSessionStatus({
      session: sessionManager.getSession(sessionId)!,
      pendingQuestionsCount: getPendingQuestionsForSession(sessionId).length,
      pendingConfirmationsCount: foldPendingConfirmations(events).length,
      activeWorkflowStepName: null,
    })
    expect(status.state).not.toBe('waiting')
    expect(status.waitingForUser).toBe(false)
  })

  it('is a no-op for a session with nothing pending and never throws', async () => {
    expect(await cancelSessionInteractions(sessionId, sessionManager, 'Session stopped by user')).toEqual([])

    const events = getEventStore().getEvents(sessionId)
    expect(foldIsRunning(events)).toBe(false)
    const runningChanged = events.filter((e) => e.type === 'running.changed')
    expect(runningChanged[runningChanged.length - 1]!.data).toEqual({ isRunning: false })
    expect(getPendingQuestionsForSession(sessionId)).toEqual([])
    expect(cancelQuestionsForSession(sessionId, 'noop')).toBe(0)
    expect(emitted.some((e) => e.type === 'session_updated')).toBe(true)
  })
})
