import type { ServerMessage, BackgroundProcess } from '../../../shared/protocol.js'
import * as store from './store.js'
import { spawnShell } from '../../utils/shell.js'
import { killProcessTree } from '../../utils/process-tree.js'
import { createUtf8StreamDecoder } from '../../utils/utf8.js'
import {
  recordProcessCreated,
  recordProcessExited,
  recordProcessStarted,
  recordProcessStopped,
} from '../../db/background-processes.js'
import type { TerminalOutcome, TerminalReason } from './types.js'

type ProcessEventListener = (processId: string, msg: ServerMessage) => void
const listeners = new Set<ProcessEventListener>()

export function onProcessEvent(callback: ProcessEventListener): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function emitProcessEvent(processId: string, msg: ServerMessage): void {
  for (const listener of listeners) {
    listener(processId, msg)
  }
}

/**
 * Reasons of an in-flight explicit stop, keyed by process id.
 *
 * A stop kills the process tree, so the child reports an 'exit' with a
 * signal before the stop itself finishes. The explicit stop reason must win
 * over that raw signal, otherwise a cancelled process would be reported as
 * 'signalled'.
 */
const pendingStopReasons = new Map<string, TerminalReason>()

/** Terminal outcomes recorded per process.
 *
 * The child emits 'exit' and 'error' independently, and a stop removes the
 * process from the store, so the outcome is memoized here: the first
 * terminal event wins and later ones are ignored, which prevents duplicate
 * resumes.
 */
const terminalOutcomes = new Map<string, TerminalOutcome>()

export function getTerminalOutcome(processId: string): TerminalOutcome | undefined {
  return terminalOutcomes.get(processId)
}

function recordTerminalOutcome(
  processId: string,
  sessionId: string,
  reason: TerminalReason,
  exitCode: number | null,
  signal: string | null,
  detail?: string,
): TerminalOutcome {
  const existing = terminalOutcomes.get(processId)
  if (existing) return existing

  const outcome: TerminalOutcome = {
    sessionId,
    reason,
    exitCode,
    signal,
    endedAt: Date.now(),
    ...(detail ? { detail } : {}),
  }
  terminalOutcomes.set(processId, outcome)
  return outcome
}

/** Drop the memoized outcome — used by tests and by process cleanup. */
export function clearTerminalOutcome(processId: string): void {
  terminalOutcomes.delete(processId)
}

export function createProcess(
  sessionId: string,
  name: string,
  command: string,
  cwd: string,
  timeout?: number,
): BackgroundProcess | null {
  const process = store.createProcess(sessionId, name, command, cwd)
  if (!process) return null

  recordProcessCreated(process.id, sessionId, name, command, cwd)

  if (timeout && timeout > 0) {
    setTimeout(() => {
      const p = store.getProcess(process.id, sessionId)
      if (p && p.status === 'running') {
        void stopProcess(process.id, sessionId, 'runtime_timeout')
      }
    }, timeout)
  }

  return process
}

export function startProcessCommand(processId: string, sessionId: string, command: string, cwd: string): number | null {
  const proc = store.startProcess(processId, sessionId, 0)
  if (!proc) return null

  const child = spawnShell(command, {
    cwd,
    detached: true,
  })

  proc.pid = child.pid ?? null
  store.updateStatus(processId, sessionId, 'running')
  recordProcessStarted(processId, child.pid ?? 0)

  emitProcessEvent(processId, {
    type: 'backgroundProcess.started',
    payload: {
      processId,
      name: proc.name,
      command: proc.command,
      cwd: proc.cwd,
      pid: child.pid ?? null,
      status: 'running',
    },
    sessionId,
  })

  const stdoutDecoder = createUtf8StreamDecoder()
  const stderrDecoder = createUtf8StreamDecoder()

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = stdoutDecoder.write(chunk)
    store.appendLog(processId, text, 'stdout')
    emitProcessEvent(processId, {
      type: 'backgroundProcess.output',
      payload: { processId, stream: 'stdout', content: text },
      sessionId,
    })
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = stderrDecoder.write(chunk)
    store.appendLog(processId, text, 'stderr')
    emitProcessEvent(processId, {
      type: 'backgroundProcess.output',
      payload: { processId, stream: 'stderr', content: text },
      sessionId,
    })
  })

  child.stdout?.on('close', () => {
    const rest = stdoutDecoder.end()
    if (rest) {
      store.appendLog(processId, rest, 'stdout')
      emitProcessEvent(processId, {
        type: 'backgroundProcess.output',
        payload: { processId, stream: 'stdout', content: rest },
        sessionId,
      })
    }
  })

  child.stderr?.on('close', () => {
    const rest = stderrDecoder.end()
    if (rest) {
      store.appendLog(processId, rest, 'stderr')
      emitProcessEvent(processId, {
        type: 'backgroundProcess.output',
        payload: { processId, stream: 'stderr', content: rest },
        sessionId,
      })
    }
  })

  child.on('exit', (code, signal) => {
    // A signal termination must stay distinguishable from a plain non-zero
    // exit: the exit code of a signalled process is not the process' own
    // verdict, so the signal is kept separately.
    const signalName = signal ?? null
    const exitCode = code ?? null
    // An explicit stop kills the tree, so the child exits with a signal. The
    // stop reason is the meaningful outcome in that case.
    const stopReason = pendingStopReasons.get(processId)
    const reason: TerminalReason = stopReason
      ? stopReason
      : signalName
        ? 'signalled'
        : exitCode === 0
          ? 'success'
          : 'failed'

    store.updateStatus(processId, sessionId, 'exited', exitCode)
    recordTerminalOutcome(processId, sessionId, reason, exitCode, signalName)
    recordProcessExited(processId, exitCode, signalName, reason)

    emitProcessEvent(processId, {
      type: 'backgroundProcess.exited',
      payload: { processId, exitCode: exitCode ?? (signalName ? 1 : null) },
      sessionId,
    })
  })

  child.on('error', (err) => {
    store.appendLog(processId, `Error: ${err.message}\n`, 'stderr')
    store.updateStatus(processId, sessionId, 'exited', 1)
    recordTerminalOutcome(processId, sessionId, 'error', 1, null, err.message)
    recordProcessExited(processId, 1, null, 'error', err.message)

    emitProcessEvent(processId, {
      type: 'backgroundProcess.exited',
      payload: { processId, exitCode: 1 },
      sessionId,
    })
  })

  return child.pid ?? null
}

export async function stopProcess(
  processId: string,
  sessionId: string,
  reason: TerminalReason = 'cancelled',
): Promise<void> {
  const proc = store.getProcess(processId, sessionId)

  if (!proc || proc.status !== 'running' || !proc.pid) {
    return
  }

  store.updateStatus(processId, sessionId, 'stopping')
  // Registered before the kill so the child's 'exit' (with a signal) is
  // attributed to this explicit stop.
  pendingStopReasons.set(processId, reason)

  try {
    await killProcessTree(proc.pid!)
  } finally {
    pendingStopReasons.delete(processId)
  }

  store.updateStatus(processId, sessionId, 'exited', null)
  recordTerminalOutcome(processId, sessionId, reason, null, null)
  recordProcessStopped(processId, reason)

  emitProcessEvent(processId, {
    type: 'backgroundProcess.removed',
    payload: { processId },
    sessionId,
  })
  store.removeProcess(processId, sessionId)
}

export function getProcessStatus(processId: string, sessionId: string): BackgroundProcess | undefined {
  return store.getProcess(processId, sessionId)
}

export function getSessionProcesses(sessionId: string): BackgroundProcess[] {
  return store.getSessionProcesses(sessionId)
}

export function getProcessLogs(processId: string, since = 0, maxLines?: number) {
  return store.getLogsPaginated(processId, since, maxLines)
}
