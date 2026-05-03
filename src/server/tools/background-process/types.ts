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
