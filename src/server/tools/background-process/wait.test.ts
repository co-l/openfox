import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as store from './store.js'
import * as manager from './manager.js'
import { waitForProcess, getActiveWaiterCount, getProcessWaiterCount } from './waiter.js'
import type { ToolContext } from '../types.js'
import { backgroundProcessTool } from './index.js'
import { loadConfig } from '../../config.js'
import { closeDatabase, initDatabase } from '../../db/index.js'
import { markInterruptedProcesses } from '../../db/background-processes.js'

const IS_WIN32 = process.platform === 'win32'
const TEST_CWD = process.cwd()

function makeContext(sessionId: string, workdir: string): ToolContext {
  return {
    sessionManager: {} as ToolContext['sessionManager'],
    workdir,
    sessionId,
  }
}

describe('background_process wait', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    store.cleanupAllProcesses()
  })

  afterEach(() => {
    store.cleanupAllProcesses()
    closeDatabase()
  })

  describe('event-backed waiting', () => {
    it('resolves as soon as the process exits, well before the timeout, with the real exit code', async () => {
      const sessionId = 'wait-session-exit-0'
      const proc = manager.createProcess(sessionId, 'quick', 'exit 0', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'exit 0', TEST_CWD)

      const startedAt = Date.now()
      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      expect(result.reason).toBe('success')
      expect(result.exitCode).toBe(0)
      expect(result.status).toBe('exited')
      expect(result.timedOut).toBe(false)
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    })

    it('returns the real non-zero exit code', async () => {
      const sessionId = 'wait-session-exit-3'
      const proc = manager.createProcess(sessionId, 'failing', 'exit 3', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'exit 3', TEST_CWD)

      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      expect(result.reason).toBe('failed')
      expect(result.exitCode).toBe(3)
      expect(result.status).toBe('exited')
    })

    it('resolves immediately when the process already finished before the wait', async () => {
      const sessionId = 'wait-session-already'
      const proc = manager.createProcess(sessionId, 'quick', 'exit 0', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'exit 0', TEST_CWD)

      // Give the child time to exit before waiting.
      await new Promise((resolve) => setTimeout(resolve, 300))

      const startedAt = Date.now()
      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      expect(result.alreadyFinished).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.reason).toBe('success')
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    })

    it('wakes the waiter when the process exits during the wait', async () => {
      const sessionId = 'wait-session-during'
      // Portable delay: `sleep` does not exist in cmd.exe.
      const command = 'node -e "setTimeout(() => process.exit(7), 1000)"'
      const proc = manager.createProcess(sessionId, 'slow', command, TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, command, TEST_CWD)

      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      expect(result.reason).toBe('failed')
      expect(result.exitCode).toBe(7)
      expect(result.alreadyFinished).toBe(false)
    })

    it('distinguishes a signal termination from a plain non-zero exit', async () => {
      if (IS_WIN32) return

      const sessionId = 'wait-session-signal'
      const proc = manager.createProcess(sessionId, 'killed', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      const wait = waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      // Kill the process tree with a signal so the child reports a signal.
      await new Promise((resolve) => setTimeout(resolve, 200))
      const { killProcessTree } = await import('../../utils/process-tree.js')
      await killProcessTree(proc.pid!)

      const result = await wait

      expect(result.reason).toBe('signalled')
      expect(result.signal).toBeTruthy()
      expect(result.exitCode).not.toBe(0)
    })

    it('reports a stopped process as cancelled instead of hanging', async () => {
      if (IS_WIN32) return

      const sessionId = 'wait-session-stopped'
      const proc = manager.createProcess(sessionId, 'stoppable', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      const wait = waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      await new Promise((resolve) => setTimeout(resolve, 200))
      await manager.stopProcess(proc.id, sessionId)

      const result = await wait

      expect(result.reason).toBe('cancelled')
      expect(result.status).toBe('stopped')
    })

    it('reports cancelled, not failed, for a wait that lands while the stop is in flight', async () => {
      if (IS_WIN32) return

      const sessionId = 'wait-session-stopping'
      const proc = manager.createProcess(sessionId, 'stopping', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      await new Promise((resolve) => setTimeout(resolve, 200))

      // stopProcess flips the status to 'stopping' synchronously and only
      // records the 'cancelled' outcome once the kill completed, so a wait
      // started here lands in that window.
      const stop = manager.stopProcess(proc.id, sessionId)
      expect(store.getProcess(proc.id, sessionId)?.status).toBe('stopping')

      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 5_000 })
      await stop

      expect(result.reason).toBe('cancelled')
      expect(result.status).toBe('stopped')
    })

    it('reports a process flagged as stopping as cancelled even without a memoized outcome', async () => {
      const sessionId = 'wait-session-stopping-no-outcome'
      const proc = manager.createProcess(sessionId, 'stopping-only', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      // The exact state stopProcess exposes between the status flip and the
      // terminal outcome: 'stopping', no exit code, nothing memoized.
      store.updateStatus(proc.id, sessionId, 'stopping')

      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 5_000 })

      expect(result.reason).toBe('cancelled')
      expect(result.status).toBe('stopped')
      expect(result.exitCode).toBeNull()

      store.updateStatus(proc.id, sessionId, 'running')
      await manager.stopProcess(proc.id, sessionId)
    })

    it('reports an unknown process id as not found', async () => {
      const result = await waitForProcess({ processId: 'does-not-exist', sessionId: 'wait-session-missing' })

      expect(result.reason).toBe('not_found')
      expect(result.status).toBe('not_found')
    })

    it('times out without killing the process and can be awaited again', async () => {
      if (IS_WIN32) return

      const sessionId = 'wait-session-timeout'
      const proc = manager.createProcess(sessionId, 'long', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 1_000 })

      expect(result.reason).toBe('timeout')
      expect(result.timedOut).toBe(true)

      // The child is still alive and still managed.
      const stillThere = store.getProcess(proc.id, sessionId)
      expect(stillThere?.status).toBe('running')

      await manager.stopProcess(proc.id, sessionId)
    })

    it('detaches the waiter on abort without killing the process', async () => {
      if (IS_WIN32) return

      const sessionId = 'wait-session-abort'
      const proc = manager.createProcess(sessionId, 'long', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      const controller = new AbortController()
      const wait = waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000, signal: controller.signal })

      await new Promise((resolve) => setTimeout(resolve, 200))
      controller.abort()

      const result = await wait

      expect(result.reason).toBe('aborted')
      expect(result.status).toBe('aborted')

      // The child keeps running — aborting a wait never kills it.
      expect(store.getProcess(proc.id, sessionId)?.status).toBe('running')

      await manager.stopProcess(proc.id, sessionId)
    })

    it('never wakes a waiter of another session', async () => {
      const ownerSession = 'wait-session-owner'
      const otherSession = 'wait-session-other'

      // Portable delay: `sleep` does not exist in cmd.exe.
      const command = 'node -e "setTimeout(() => process.exit(0), 1000)"'
      const proc = manager.createProcess(ownerSession, 'owned', command, TEST_CWD)!
      manager.startProcessCommand(proc.id, ownerSession, command, TEST_CWD)

      // The other session cannot even see the process.
      const foreign = await waitForProcess({ processId: proc.id, sessionId: otherSession })
      expect(foreign.reason).toBe('not_found')

      // The owner still gets the outcome.
      const owner = await waitForProcess({ processId: proc.id, sessionId: ownerSession, timeoutMs: 60_000 })
      expect(owner.exitCode).toBe(0)
    })

    it('bounds the number of concurrent waiters for a single process', async () => {
      if (IS_WIN32) return

      const sessionId = 'wait-session-bounded'
      const proc = manager.createProcess(sessionId, 'bounded', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      // Fill the waiter budget: one wait is refused instead of piling up.
      const waits: Array<Promise<{ reason: string }>> = []
      for (let i = 0; i < 8; i++) {
        waits.push(waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 }))
      }

      const refused = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })
      expect(refused.reason).toBe('busy')
      expect(refused.status).toBe('busy')
      expect(getProcessWaiterCount(proc.id)).toBe(8)

      await manager.stopProcess(proc.id, sessionId)
      await Promise.all(waits)
    })

    it('resolves repeated waits on the same process with a consistent outcome', async () => {
      const sessionId = 'wait-session-repeat'
      const proc = manager.createProcess(sessionId, 'once', 'exit 5', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'exit 5', TEST_CWD)

      const first = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })
      const second = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })

      expect(first.exitCode).toBe(5)
      expect(second.exitCode).toBe(5)
      expect(second.reason).toBe('failed')
    })

    it('resolves concurrent waits on the same process exactly once each', async () => {
      const sessionId = 'wait-session-concurrent'
      const proc = manager.createProcess(sessionId, 'shared', 'exit 9', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'exit 9', TEST_CWD)

      const waits = [
        waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 }),
        waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 }),
      ]

      const [a, b] = await Promise.all(waits)

      expect(a?.exitCode).toBe(9)
      expect(b?.exitCode).toBe(9)
      expect(a?.reason).toBe('failed')
      expect(b?.reason).toBe('failed')
    })

    it('cleans up waiters after resolution, timeout and abort', async () => {
      const sessionId = 'wait-session-cleanup'
      const baseline = getActiveWaiterCount()

      const proc = manager.createProcess(sessionId, 'cleanup', 'exit 0', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'exit 0', TEST_CWD)

      await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 60_000 })
      expect(getActiveWaiterCount()).toBe(baseline)
      expect(getProcessWaiterCount(proc.id)).toBe(0)

      if (IS_WIN32) return

      const timeoutProcess = manager.createProcess(sessionId, 'cleanup2', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(timeoutProcess.id, sessionId, 'sleep 30', TEST_CWD)
      await waitForProcess({ processId: timeoutProcess.id, sessionId, timeoutMs: 1_000 })
      expect(getActiveWaiterCount()).toBe(baseline)
      await manager.stopProcess(timeoutProcess.id, sessionId)

      const abortProcess = manager.createProcess(sessionId, 'cleanup3', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(abortProcess.id, sessionId, 'sleep 30', TEST_CWD)
      const controller = new AbortController()
      const wait = waitForProcess({
        processId: abortProcess.id,
        sessionId,
        timeoutMs: 60_000,
        signal: controller.signal,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      controller.abort()
      await wait
      expect(getActiveWaiterCount()).toBe(baseline)
      await manager.stopProcess(abortProcess.id, sessionId)
    })

    it('reports a lost process state after a restart as unknown, never as completed', async () => {
      const sessionId = 'wait-session-restart'
      const proc = manager.createProcess(sessionId, 'lost', 'sleep 30', TEST_CWD)!
      manager.startProcessCommand(proc.id, sessionId, 'sleep 30', TEST_CWD)

      // Simulate a server restart: the in-memory store is wiped, and the
      // startup reconciliation marks the still-running records as interrupted.
      store.cleanupAllProcesses()
      const changed = markInterruptedProcesses()
      expect(changed).toBeGreaterThan(0)

      const result = await waitForProcess({ processId: proc.id, sessionId, timeoutMs: 1_000 })

      expect(result.reason).toBe('unknown')
      expect(result.status).toBe('unknown')
      expect(result.exitCode).toBeNull()
      expect(result.alreadyFinished).toBe(false)
    })
  })

  describe('wait tool action', () => {
    it('returns a structured outcome for a finished process', async () => {
      const sessionId = 'wait-tool-session'
      const context = makeContext(sessionId, TEST_CWD)

      const started = await backgroundProcessTool.execute(
        { action: 'start', command: 'exit 0', name: 'tool-wait' },
        context,
      )
      const processId = JSON.parse(started.output!).processId as string

      await new Promise((resolve) => setTimeout(resolve, 300))

      const waited = await backgroundProcessTool.execute({ action: 'wait', processId, waitTimeout: 30_000 }, context)

      expect(waited.success).toBe(true)
      const payload = JSON.parse(waited.output!)
      expect(payload.reason).toBe('success')
      expect(payload.exitCode).toBe(0)
      expect(payload.timedOut).toBe(false)
      expect(typeof payload.logCursor).toBe('number')
    })

    it('reports a missing process as not found without throwing', async () => {
      const context = makeContext('wait-tool-missing', TEST_CWD)

      const waited = await backgroundProcessTool.execute(
        { action: 'wait', processId: 'nope', waitTimeout: 5_000 },
        context,
      )

      expect(waited.success).toBe(true)
      expect(JSON.parse(waited.output!).reason).toBe('not_found')
    })

    it('start -> wait -> logs returns the output the wait itself observed', async () => {
      if (IS_WIN32) return

      const context = makeContext('wait-tool-logs', TEST_CWD)

      const started = await backgroundProcessTool.execute(
        { action: 'start', command: 'sleep 0.3; echo build-ok', name: 'job-logs' },
        context,
      )
      const processId = JSON.parse(started.output!).processId as string

      const waited = await backgroundProcessTool.execute({ action: 'wait', processId, waitTimeout: 30_000 }, context)
      const waitPayload = JSON.parse(waited.output!)
      expect(waitPayload.reason).toBe('success')
      expect(waitPayload.logCursor).toBeGreaterThan(0)

      // The documented first read after a wait: `logs` with no `since`.
      const fullLogs = await backgroundProcessTool.execute({ action: 'logs', processId }, context)
      const contents = (JSON.parse(fullLogs.output!).lines as Array<{ content: string }>)
        .map((line) => line.content)
        .join('')
      expect(contents).toContain('build-ok')

      // `logCursor` is the offset of the next line: reading from it returns
      // only what is produced after the wait, i.e. nothing for a finished job.
      const incremental = await backgroundProcessTool.execute(
        { action: 'logs', processId, since: waitPayload.logCursor },
        context,
      )
      expect(JSON.parse(incremental.output!).lines).toHaveLength(0)
    })

    it('documents reading the output without `since` after a wait', () => {
      const description = backgroundProcessTool.definition.function.description ?? ''

      // The log cursor is the offset of the *next* line, so it can never be
      // the offset of the first read: the description must not tell the model
      // to pass it to `logs` to see the output the wait just observed.
      expect(description).not.toMatch(/call ["']logs["'] with the returned logCursor/i)
      expect(description).toMatch(/logs/i)
      expect(description).toMatch(/without ["']?since|default (?:offset )?0/i)
    })
  })
})
