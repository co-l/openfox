import { spawn } from 'node:child_process'
import type { ServerMessage, BackgroundProcess } from '../../../shared/protocol.js'
import * as store from './store.js'

const STOP_SIGNAL_TIMEOUT = 5000

type ProcessEventListener = (processId: string, msg: ServerMessage) => void
const listeners = new Set<ProcessEventListener>()

export function onProcessEvent(callback: ProcessEventListener): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
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

export function startProcessCommand(
  processId: string,
  sessionId: string,
  command: string,
  cwd: string,
): number | null {
  const proc = store.startProcess(processId, sessionId, 0)
  if (!proc) return null

  const child = spawn('sh', ['-c', command], {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  proc.pid = child.pid ?? null
  store.updateStatus(processId, sessionId, 'running')

  emitProcessEvent(processId, {
    type: 'backgroundProcess.started',
    payload: { processId, name: proc.name, pid: child.pid ?? null, status: 'running' },
    sessionId,
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    store.appendLog(processId, text, 'stdout')
    emitProcessEvent(processId, {
      type: 'backgroundProcess.output',
      payload: { processId, stream: 'stdout', content: text },
      sessionId,
    })
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    store.appendLog(processId, text, 'stderr')
    emitProcessEvent(processId, {
      type: 'backgroundProcess.output',
      payload: { processId, stream: 'stderr', content: text },
      sessionId,
    })
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

export async function stopProcess(
  processId: string,
  sessionId: string,
): Promise<void> {
  const proc = store.getProcess(processId, sessionId)
  
  if (!proc || proc.status !== 'running' || !proc.pid) {
    return
  }

  store.updateStatus(processId, sessionId, 'stopping')

  const pid = proc.pid!
  try {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      process.kill(pid, 'SIGTERM')
    }

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          try {
            process.kill(pid, 'SIGKILL')
          } catch (_) {
            // Process already dead
          }
        }
        resolve()
      }, STOP_SIGNAL_TIMEOUT)
    })

    store.updateStatus(processId, sessionId, 'exited', null)
    emitProcessEvent(processId, {
      type: 'backgroundProcess.removed',
      payload: { processId },
      sessionId,
    })
    store.removeProcess(processId, sessionId)
  } catch (_) {
    store.updateStatus(processId, sessionId, 'exited', 1)
    emitProcessEvent(processId, {
      type: 'backgroundProcess.removed',
      payload: { processId },
      sessionId,
    })
    store.removeProcess(processId, sessionId)
  }
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