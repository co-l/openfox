import type { BackgroundProcess, LogLine } from '../../../shared/protocol.js'
export type { BackgroundProcess, LogLine }
export type ProcessStatus = 'pending' | 'starting' | 'running' | 'stopping' | 'exited'

export interface ProcessListResult {
  processes: BackgroundProcess[]
  maxPerSession: number
  currentCount: number
}

export interface ProcessStatusResult {
  process: BackgroundProcess
  uptime: number | null
}

export interface ProcessLogsResult {
  processId: string
  lines: LogLine[]
  totalLines: number
  nextOffset: number
  hasMore: boolean
  truncated: boolean
}

export interface ProcessStartResult {
  processId: string
  name: string
  pid: number
  status: ProcessStatus
  maxReached: boolean
}

/**
 * Why a background process reached its terminal state.
 * 'success' | 'failed' come from the exit code, 'signalled' from a signal,
 * 'error' from a spawn failure, 'cancelled' from an explicit stop,
 * 'runtime_timeout' from the process runtime timeout.
 */
export type TerminalReason = 'success' | 'failed' | 'signalled' | 'error' | 'cancelled' | 'runtime_timeout'

export interface TerminalOutcome {
  sessionId: string
  reason: TerminalReason
  exitCode: number | null
  signal: string | null
  detail?: string
  endedAt: number
}

/**
 * Why a wait call returned.
 * The terminal reasons above are reused when the process ended while waiting;
 * the wait-specific ones describe the wait itself.
 */
export type WaitReason = TerminalReason | 'timeout' | 'already_finished' | 'not_found' | 'unknown' | 'aborted' | 'busy'

export interface WaitResult {
  processId: string
  status: 'exited' | 'stopped' | 'error' | 'timeout' | 'aborted' | 'not_found' | 'unknown' | 'busy'
  reason: WaitReason
  terminalReason?: TerminalReason
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  alreadyFinished: boolean
  durationMs: number
  /**
   * Offset of the next log line at wait-resolution time. It is the `since` to
   * pass to an incremental `logs` call; the first read uses the default 0 so
   * the output written before the wait resolved stays visible.
   */
  logCursor: number
  detail?: string
}
