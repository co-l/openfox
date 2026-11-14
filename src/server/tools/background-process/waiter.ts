import * as store from './store.js'
import * as manager from './manager.js'
import { getProcessRecord } from '../../db/background-processes.js'
import type { TerminalOutcome, TerminalReason, WaitResult } from './types.js'

/**
 * Event-backed waiting for a background process.
 *
 * The wait never polls and never sleeps: it subscribes to the process event
 * emitter already used by the UI (onProcessEvent) and reconciles with the
 * process snapshot, so a completion that happens before, during or right
 * after the subscription still wakes the caller exactly once.
 */

export const DEFAULT_WAIT_TIMEOUT_MS = 120_000
export const MIN_WAIT_TIMEOUT_MS = 1_000
export const MAX_WAIT_TIMEOUT_MS = 600_000

/** Upper bound on concurrent waiters for a single process. */
const MAX_WAITERS_PER_PROCESS = 8

interface Waiter {
  sessionId: string
  settle: (outcome: WaitResult) => void
}

const waitersByProcess = new Map<string, Set<Waiter>>()

/** Number of waiters currently registered across all processes. */
export function getActiveWaiterCount(): number {
  let total = 0
  for (const waiters of waitersByProcess.values()) {
    total += waiters.size
  }
  return total
}

/** Number of waiters currently registered for one process. */
export function getProcessWaiterCount(processId: string): number {
  return waitersByProcess.get(processId)?.size ?? 0
}

export function clampWaitTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_WAIT_TIMEOUT_MS
  }
  return Math.min(Math.max(Math.trunc(timeoutMs), MIN_WAIT_TIMEOUT_MS), MAX_WAIT_TIMEOUT_MS)
}

function statusForReason(reason: TerminalReason): WaitResult['status'] {
  switch (reason) {
    case 'success':
    case 'failed':
    case 'signalled':
      return 'exited'
    case 'error':
      return 'error'
    case 'cancelled':
    case 'runtime_timeout':
      return 'stopped'
  }
}

function logCursor(processId: string): number {
  return store.getLogCount(processId)
}

function baseResult(processId: string, startedAt: number): WaitResult {
  return {
    processId,
    status: 'unknown',
    reason: 'unknown',
    exitCode: null,
    signal: null,
    timedOut: false,
    alreadyFinished: false,
    durationMs: Date.now() - startedAt,
    logCursor: 0,
  }
}

function resultFromOutcome(
  processId: string,
  outcome: TerminalOutcome,
  startedAt: number,
  alreadyFinished: boolean,
): WaitResult {
  return {
    processId,
    status: statusForReason(outcome.reason),
    reason: outcome.reason,
    terminalReason: outcome.reason,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: false,
    alreadyFinished,
    durationMs: Date.now() - startedAt,
    logCursor: logCursor(processId),
    ...(outcome.detail ? { detail: outcome.detail } : {}),
  }
}

/**
 * Resolve without waiting when the outcome is already known.
 * Returns undefined when the process is still running.
 */
function resolveImmediate(processId: string, sessionId: string, startedAt: number): WaitResult | undefined {
  const proc = store.getProcess(processId, sessionId)

  if (proc) {
    if (proc.status === 'stopping') {
      const outcome = manager.getTerminalOutcome(processId)
      if (outcome) {
        return resultFromOutcome(processId, outcome, startedAt, true)
      }
      // stopProcess flips the status to 'stopping' and only records the
      // 'cancelled' outcome once the kill completed, so a wait landing in
      // that window must not guess a reason from a missing exit code: an
      // explicit stop is always a cancellation, never a failure.
      return {
        ...baseResult(processId, startedAt),
        status: 'stopped',
        reason: 'cancelled',
        terminalReason: 'cancelled',
        exitCode: null,
        alreadyFinished: false,
        logCursor: logCursor(processId),
      }
    }

    if (proc.status === 'exited') {
      const outcome = manager.getTerminalOutcome(processId)
      if (outcome) {
        return resultFromOutcome(processId, outcome, startedAt, true)
      }
      // The process finished but no terminal outcome was recorded (for
      // example the record predates this server run). Fall back to the
      // snapshot so the caller still gets a real exit code.
      return {
        ...baseResult(processId, startedAt),
        status: 'exited',
        reason: proc.exitCode === 0 ? 'success' : 'failed',
        terminalReason: proc.exitCode === 0 ? 'success' : 'failed',
        exitCode: proc.exitCode,
        alreadyFinished: true,
        logCursor: logCursor(processId),
      }
    }
    return undefined
  }

  const record = getProcessRecord(processId)
  if (!record || record.sessionId !== sessionId) {
    return {
      ...baseResult(processId, startedAt),
      status: 'not_found',
      reason: 'not_found',
      detail: `Process not found: ${processId}`,
    }
  }

  if (record.status === 'exited' || record.status === 'stopped') {
    const fallback: TerminalReason =
      record.status === 'stopped' ? 'cancelled' : record.exitCode === 0 ? 'success' : 'failed'
    const reason = (record.reason as TerminalReason | null) ?? fallback
    return {
      ...baseResult(processId, startedAt),
      status: statusForReason(reason),
      reason,
      terminalReason: reason,
      exitCode: record.exitCode,
      signal: record.signal,
      alreadyFinished: true,
      ...(record.detail ? { detail: record.detail } : {}),
    }
  }

  // The durable record says the process was still alive, but the in-memory
  // store is empty: the server restarted and the process state was lost.
  // Report it explicitly instead of pretending the process completed.
  return {
    ...baseResult(processId, startedAt),
    status: 'unknown',
    reason: 'unknown',
    detail:
      record.status === 'interrupted'
        ? 'Process was interrupted by a server restart; its state was lost.'
        : 'Process state was lost (server restarted); completion is unknown.',
  }
}

export interface WaitForProcessOptions {
  processId: string
  sessionId: string
  timeoutMs?: number | undefined
  signal?: AbortSignal | undefined
}

/**
 * Wait for a background process owned by `sessionId` to reach a terminal state.
 *
 * The wait resolves as soon as the process exits, errors, is stopped or the
 * bounded timeout expires. It never kills the process, never polls and never
 * sleeps.
 */
export async function waitForProcess(options: WaitForProcessOptions): Promise<WaitResult> {
  const { processId, sessionId, signal } = options
  const startedAt = Date.now()
  const timeoutMs = clampWaitTimeout(options.timeoutMs)

  const immediate = resolveImmediate(processId, sessionId, startedAt)
  if (immediate) {
    return immediate
  }

  const currentWaiters = waitersByProcess.get(processId)
  if (currentWaiters && currentWaiters.size >= MAX_WAITERS_PER_PROCESS) {
    return {
      ...baseResult(processId, startedAt),
      status: 'busy',
      reason: 'busy',
      detail: `Too many concurrent waiters for process ${processId} (limit ${MAX_WAITERS_PER_PROCESS}).`,
    }
  }

  return new Promise<WaitResult>((resolve) => {
    let settled = false
    // Cleanup handles registered by the subscription and the timeout timer.
    // They are collected in a list so `finish` can release all of them in one
    // place, whatever the resolution order is.
    const cleanups: Array<() => void> = []

    function removeWaiter(): void {
      const waiters = waitersByProcess.get(processId)
      if (!waiters) return
      waiters.delete(waiter)
      if (waiters.size === 0) {
        waitersByProcess.delete(processId)
      }
    }

    function finish(outcome: WaitResult): void {
      if (settled) return
      settled = true
      for (const cleanup of cleanups) {
        cleanup()
      }
      removeWaiter()
      resolve(outcome)
    }

    const waiter: Waiter = {
      sessionId,
      settle: (outcome) => finish(outcome),
    }

    const waiters = currentWaiters ?? new Set<Waiter>()
    waiters.add(waiter)
    waitersByProcess.set(processId, waiters)

    const unsubscribe = manager.onProcessEvent((eventProcessId, msg) => {
      if (eventProcessId !== processId) return
      // Session isolation: a process owned by another session never wakes
      // this waiter, even if the ids collide in another session's store.
      if (msg.sessionId !== sessionId) return
      if (msg.type !== 'backgroundProcess.exited' && msg.type !== 'backgroundProcess.removed') return

      const outcome = manager.getTerminalOutcome(processId)
      if (!outcome) return
      finish(resultFromOutcome(processId, outcome, startedAt, false))
    })
    cleanups.push(unsubscribe)

    // Reconcile after subscribing: the process may have exited between the
    // first snapshot and the subscription (no lost wakeup).
    const afterSubscribe = resolveImmediate(processId, sessionId, startedAt)
    if (afterSubscribe) {
      finish(afterSubscribe)
      return
    }

    if (signal?.aborted) {
      finish({
        ...baseResult(processId, startedAt),
        status: 'aborted',
        reason: 'aborted',
        detail: 'Wait was aborted; the background process was left running.',
      })
      return
    }

    if (signal) {
      const onAbort = () => {
        finish({
          ...baseResult(processId, startedAt),
          status: 'aborted',
          reason: 'aborted',
          detail: 'Wait was aborted; the background process was left running.',
        })
      }
      signal.addEventListener('abort', onAbort)
      cleanups.push(() => signal.removeEventListener('abort', onAbort))
    }

    const timeoutTimer = setTimeout(() => {
      // A wait timeout never terminates the underlying process.
      finish({
        ...baseResult(processId, startedAt),
        status: 'timeout',
        reason: 'timeout',
        timedOut: true,
        detail: `Wait timed out after ${timeoutMs}ms; the background process is still running.`,
      })
    }, timeoutMs)
    cleanups.push(() => clearTimeout(timeoutTimer))
  })
}
