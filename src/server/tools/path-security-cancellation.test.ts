import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, closeDatabase, getDatabase } from '../db/index.js'
import { initEventStore, getEventStore } from '../events/index.js'
import { foldPendingConfirmations } from '../events/folding.js'
import { SessionManager } from '../session/manager.js'
import { createProject } from '../db/projects.js'
import type { Config } from '../../shared/types.js'
import {
  requestPathAccess,
  registerPathConfirmation,
  providePathConfirmation,
  cancelPathConfirmation,
  cancelPathConfirmationsForSession,
  hasPendingPathConfirmation,
} from './path-security.js'

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

function respondedEvents(sessionId: string) {
  return getEventStore()
    .getEvents(sessionId)
    .filter((e) => e.type === 'path.confirmation_responded')
}

/**
 * Cancellation lifecycle for path confirmations.
 *
 * Pending confirmations are event-sourced: every session.state broadcast and
 * session load re-derives them from the event log (foldPendingConfirmations).
 * Cancelling a confirmation (e.g. when the user stops the query) therefore
 * must close the event out with path.confirmation_responded, otherwise the
 * cancelled confirmation resurrects on every re-broadcast and on reload —
 * keeping "Waiting for input" and the Allow/Deny buttons stuck in the UI.
 */
describe('path confirmation cancellation lifecycle (event store)', () => {
  let testDir: string
  let workdir: string
  let sessionManager: SessionManager
  let sessionId: string
  let otherSessionId: string

  beforeEach(async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    closeDatabase()
    initDatabase(createTestConfig())
    initEventStore(getDatabase())

    testDir = join(tmpdir(), `openfox-cancellation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
    workdir = testDir

    sessionManager = new SessionManager(mockProviderManager as any)
    const project = createProject('cancellation-test', testDir)
    sessionId = sessionManager.createSession(project.id).id
    otherSessionId = sessionManager.createSession(project.id).id
  })

  afterEach(async () => {
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
    closeDatabase()
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('cancelPathConfirmation', () => {
    it('writes a path.confirmation_responded event (approved:false) and the fold forgets the confirmation', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(['/etc/passwd'], workdir, sessionId, 'call-cancel', 'read_file', onEvent)
      await waitForPending('call-cancel')

      expect(cancelPathConfirmation('call-cancel', 'Session stopped by user')).toBe(true)
      const rejected = expect(promise).rejects.toThrow('Session stopped by user')

      const responded = respondedEvents(sessionId)
      expect(responded).toHaveLength(1)
      expect(responded[0]!.data).toEqual({ callId: 'call-cancel', approved: false, alwaysAllow: false })

      // The event-sourced fold must no longer resurrect the confirmation.
      expect(foldPendingConfirmations(getEventStore().getEvents(sessionId))).toEqual([])

      await rejected
    })
  })

  describe('cancelPathConfirmationsForSession', () => {
    it('writes one responded event per cancelled confirmation and leaves other sessions untouched', async () => {
      const pendingA = registerPathConfirmation(
        'call-a',
        ['/etc/a'],
        sessionId,
        'read_file',
        workdir,
        'outside_workdir',
      )
      const pendingB = registerPathConfirmation(
        'call-b',
        ['/etc/b'],
        sessionId,
        'write_file',
        workdir,
        'sensitive_file',
      )
      const pendingOther = registerPathConfirmation(
        'call-other',
        ['/etc/c'],
        otherSessionId,
        'read_file',
        workdir,
        'outside_workdir',
      )
      const rejectedA = expect(pendingA).rejects.toThrow('Session stopped by user')
      const rejectedB = expect(pendingB).rejects.toThrow('Session stopped by user')
      const rejectedOther = expect(pendingOther).rejects.toThrow('cleanup')

      // Mirror what requestPathAccess persists for each pending confirmation.
      getEventStore().append(sessionId, {
        type: 'path.confirmation_pending',
        data: { callId: 'call-a', tool: 'read_file', paths: ['/etc/a'], workdir, reason: 'outside_workdir' },
      })
      getEventStore().append(sessionId, {
        type: 'path.confirmation_pending',
        data: { callId: 'call-b', tool: 'write_file', paths: ['/etc/b'], workdir, reason: 'sensitive_file' },
      })
      getEventStore().append(otherSessionId, {
        type: 'path.confirmation_pending',
        data: { callId: 'call-other', tool: 'read_file', paths: ['/etc/c'], workdir, reason: 'outside_workdir' },
      })

      expect(cancelPathConfirmationsForSession(sessionId, 'Session stopped by user')).toBe(2)
      expect(hasPendingPathConfirmation('call-a')).toBe(false)
      expect(hasPendingPathConfirmation('call-b')).toBe(false)
      expect(hasPendingPathConfirmation('call-other')).toBe(true)

      const responded = respondedEvents(sessionId)
      expect(responded.map((e) => (e.data as { callId: string }).callId).sort()).toEqual(['call-a', 'call-b'])
      for (const e of responded) {
        expect(e.data).toMatchObject({ approved: false, alwaysAllow: false })
      }

      // This session's fold is clean; the other session's confirmation stays.
      expect(foldPendingConfirmations(getEventStore().getEvents(sessionId))).toEqual([])
      expect(foldPendingConfirmations(getEventStore().getEvents(otherSessionId))).toHaveLength(1)

      cancelPathConfirmation('call-other', 'cleanup')
      await Promise.all([rejectedA, rejectedB, rejectedOther])
    })
  })

  describe('stop-while-waiting (the reported bug)', () => {
    it('a confirmation pending during requestPathAccess is closed out when the session stops', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        ['/etc/passwd'],
        workdir,
        sessionId,
        'call-stop',
        'run_command',
        onEvent,
        'normal',
        'cat /etc/passwd',
      )
      await waitForPending('call-stop')

      // Before the fix, the pending event stayed unmatched in the log, so the
      // fold (and therefore session.state / GET /api/sessions/:id) kept
      // resurrecting the confirmation forever.
      expect(foldPendingConfirmations(getEventStore().getEvents(sessionId))).toHaveLength(1)

      const cancelled = cancelPathConfirmationsForSession(sessionId, 'Session stopped by user')
      const rejected = expect(promise).rejects.toThrow('Session stopped by user')
      expect(cancelled).toBe(1)
      expect(foldPendingConfirmations(getEventStore().getEvents(sessionId))).toEqual([])

      await rejected
    })
  })

  describe('providePathConfirmation (refactor regression)', () => {
    it('still writes the responded event with the approval flags from the response', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(['/etc/passwd'], workdir, sessionId, 'call-provide', 'read_file', onEvent)
      await waitForPending('call-provide')

      expect(providePathConfirmation('call-provide', true, true)).toEqual({
        found: true,
        sessionId,
        approved: true,
      })

      const responded = respondedEvents(sessionId)
      expect(responded).toHaveLength(1)
      expect(responded[0]!.data).toEqual({ callId: 'call-provide', approved: true, alwaysAllow: true })
      expect(foldPendingConfirmations(getEventStore().getEvents(sessionId))).toEqual([])

      await expect(promise).resolves.toBeUndefined()
    })
  })
})
