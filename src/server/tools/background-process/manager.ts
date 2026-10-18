import type { ServerMessage, BackgroundProcess } from '../../../shared/protocol.js'
import * as store from './store.js'
import { spawnShell } from '../../utils/shell.js'
import { killProcessTree } from '../../utils/process-tree.js'
import { createUtf8StreamDecoder } from '../../utils/utf8.js'

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

export function createProcess(
  sessionId: string,
  name: string,
  command: string,
  cwd: string,
  timeout?: number,
): BackgroundProcess | null {
  const process = store.createProcess(sessionId, name, command, cwd)
  if (!process) return null

  if (timeout && timeout > 0) {
    setTimeout(() => {
      const p = store.getProcess(process.id, sessionId)
      if (p && p.status === 'running') {
        stopProcess(process.id, sessionId)
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
    store.updateStatus(processId, sessionId, 'exited', code ?? (signal ? 1 : null))
    emitProcessEvent(processId, {
      type: 'backgroundProcess.exited',
      payload: { processId, exitCode: code ?? (signal ? 1 : null) },
      sessionId,
    })
  })

  child.on('error', (err) => {
    store.appendLog(processId, `Error: ${err.message}\n`, 'stderr')
    store.updateStatus(processId, sessionId, 'exited', 1)
    emitProcessEvent(processId, {
      type: 'backgroundProcess.exited',
      payload: { processId, exitCode: 1 },
      sessionId,
    })
  })

  return child.pid ?? null
}

export async function stopProcess(processId: string, sessionId: string): Promise<void> {
  const proc = store.getProcess(processId, sessionId)

  if (!proc || proc.status !== 'running' || !proc.pid) {
    return
  }

  store.updateStatus(processId, sessionId, 'stopping')

  await killProcessTree(proc.pid!)

  store.updateStatus(processId, sessionId, 'exited', null)
  emitProcessEvent(processId, {
    type: 'backgroundProcess.removed',
    payload: { processId },
    sessionId,
  })
  store.removeProcess(processId, sessionId)
}

export async function stopSessionProcesses(sessionId: string): Promise<void> {
  const running = store
    .getSessionProcesses(sessionId)
    .filter((p) => p.status === 'running' && p.pid !== null)
    .map((p) => p.pid!)
  store.removeSession(sessionId)
  await Promise.all(running.map((pid) => killProcessTree(pid)))
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
