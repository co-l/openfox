import type { BackgroundProcess, LogLine } from './types.js'

const MAX_PER_SESSION = 5

const processesBySession = new Map<string, Map<string, BackgroundProcess>>()
const logsByProcess = new Map<string, LogLine[]>()

export function getMaxPerSession(): number {
  return MAX_PER_SESSION
}

export function getProcess(processId: string, sessionId: string): BackgroundProcess | undefined {
  return processesBySession.get(sessionId)?.get(processId)
}

export function getSessionProcesses(sessionId: string): BackgroundProcess[] {
  const sessionProcesses = processesBySession.get(sessionId)
  if (!sessionProcesses) return []
  return Array.from(sessionProcesses.values())
}

export function getSessionProcessCount(sessionId: string): number {
  return getSessionProcesses(sessionId).filter((p) => p.status !== 'exited').length
}

export function createProcess(sessionId: string, name: string, command: string, cwd: string): BackgroundProcess | null {
  const count = getSessionProcessCount(sessionId)
  if (count >= MAX_PER_SESSION) {
    return null
  }

  const process: BackgroundProcess = {
    id: crypto.randomUUID(),
    sessionId,
    name,
    command,
    cwd,
    pid: null,
    status: 'pending',
    exitCode: null,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
  }

  if (!processesBySession.has(sessionId)) {
    processesBySession.set(sessionId, new Map())
  }
  processesBySession.get(sessionId)!.set(process.id, process)
  logsByProcess.set(process.id, [])

  return process
}

export function startProcess(processId: string, sessionId: string, pid: number): BackgroundProcess | undefined {
  const process = getProcess(processId, sessionId)
  if (!process) return undefined

  process.pid = pid
  process.status = 'running'
  process.startedAt = Date.now()
  return process
}

export function updateStatus(
  processId: string,
  sessionId: string,
  status: BackgroundProcess['status'],
  exitCode?: number | null,
): BackgroundProcess | undefined {
  const process = getProcess(processId, sessionId)
  if (!process) return undefined

  process.status = status
  if (exitCode !== undefined) {
    process.exitCode = exitCode
  }
  if (status === 'exited' || status === 'stopping') {
    process.endedAt = Date.now()
  }
  return process
}

export function removeProcess(processId: string, sessionId: string): boolean {
  const sessionProcesses = processesBySession.get(sessionId)
  if (!sessionProcesses) return false

  const deleted = sessionProcesses.delete(processId)
  logsByProcess.delete(processId)
  return deleted
}

export function appendLog(processId: string, content: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  const logs = logsByProcess.get(processId)
  if (!logs) return

  const offset = logs.length
  logs.push({
    offset,
    content,
    timestamp: Date.now(),
    stream,
  })
}

export function getLogs(processId: string, offset = 0, limit?: number): LogLine[] {
  const logs = logsByProcess.get(processId) ?? []
  const start = Math.min(offset, logs.length)
  const end = limit !== undefined ? Math.min(start + limit, logs.length) : logs.length
  return logs.slice(start, end)
}

export interface PaginatedLogs {
  lines: LogLine[]
  totalLines: number
  nextOffset: number
  hasMore: boolean
}

export function getLogsPaginated(processId: string, since = 0, maxLines = 500): PaginatedLogs {
  const logs = logsByProcess.get(processId) ?? []
  const totalLines = logs.length

  const filteredLogs = logs.filter((_, index) => index >= since)
  const slicedLogs = filteredLogs.slice(0, maxLines)

  const lastLine = slicedLogs[slicedLogs.length - 1]
  const nextOffset = lastLine ? lastLine.offset + 1 : totalLines
  const hasMore = slicedLogs.length < filteredLogs.length

  return {
    lines: slicedLogs,
    totalLines,
    nextOffset,
    hasMore,
  }
}

export function clearLogs(processId: string): void {
  logsByProcess.delete(processId)
  logsByProcess.set(processId, [])
}

export function getProcessById(processId: string): BackgroundProcess | undefined {
  for (const sessionProcesses of processesBySession.values()) {
    const proc = sessionProcesses.get(processId)
    if (proc) return proc
  }
  return undefined
}

export function cleanupAllProcesses(): void {
  for (const sessionProcesses of processesBySession.values()) {
    for (const proc of sessionProcesses.values()) {
      if (proc.status === 'running' && proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGTERM')
        } catch {
          try {
            process.kill(proc.pid, 'SIGTERM')
          } catch (_) {
            // Process already dead
          }
        }
      }
    }
  }
  processesBySession.clear()
  logsByProcess.clear()
}
