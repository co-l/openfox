import type { Session, SessionPhase } from '../../shared/types.js'

export const SESSION_STATUS_SCHEMA_VERSION = 1 as const

export type SessionStatusState = 'waiting' | 'blocked' | 'completed' | 'running' | null

export interface SessionStatus {
  schemaVersion: typeof SESSION_STATUS_SCHEMA_VERSION
  sessionId: string
  state: SessionStatusState
  phase: SessionPhase
  workflowStep: string | null
  waitingForUser: boolean
  lastActivityAt: string
  links: { ui: string }
}

export interface ProjectSessionStatusInputs {
  session: Session
  pendingQuestionsCount: number
  pendingConfirmationsCount: number
  activeWorkflowStepName: string | null
}

export function projectSessionStatus(inputs: ProjectSessionStatusInputs): SessionStatus {
  const { session, pendingQuestionsCount, pendingConfirmationsCount, activeWorkflowStepName } = inputs

  let state: SessionStatusState = null
  if (session.phase === 'waiting' || pendingQuestionsCount > 0 || pendingConfirmationsCount > 0) {
    state = 'waiting'
  } else if (session.phase === 'blocked') {
    state = 'blocked'
  } else if (session.phase === 'done' && !session.isRunning) {
    state = 'completed'
  } else if (session.isRunning) {
    state = 'running'
  }

  const waitingForUser = pendingQuestionsCount > 0 || pendingConfirmationsCount > 0

  return {
    schemaVersion: SESSION_STATUS_SCHEMA_VERSION,
    sessionId: session.id,
    state,
    phase: session.phase,
    workflowStep: activeWorkflowStepName,
    waitingForUser,
    lastActivityAt: session.updatedAt,
    links: {
      ui: `/?sessionId=${encodeURIComponent(session.id)}`,
    },
  }
}
