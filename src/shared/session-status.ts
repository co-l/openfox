import type { SessionPhase } from './types.js'

export const SESSION_STATUS_SCHEMA_VERSION = 2 as const

export type SessionStatusState = 'waiting' | 'blocked' | 'completed' | 'running' | null

export interface SessionStatus {
  schemaVersion: typeof SESSION_STATUS_SCHEMA_VERSION
  sessionId: string
  state: SessionStatusState
  phase: SessionPhase
  workflowStep: string | null
  waitingForUser: boolean
  lastActivityAt: string
  lastProgressAt: string | null
  links: { ui: string }
}
