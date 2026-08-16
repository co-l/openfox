import type { Session } from '../../shared/types.js'
import {
  SESSION_STATUS_SCHEMA_VERSION,
  type SessionStatus,
  type SessionStatusState,
} from '../../shared/session-status.js'

export { SESSION_STATUS_SCHEMA_VERSION }
export type { SessionStatus, SessionStatusState }

export interface ProjectSessionStatusInputs {
  session: Session
  pendingQuestionsCount: number
  pendingConfirmationsCount: number
  activeWorkflowStepName: string | null
  lastProgressAt: string | null
}

export function projectSessionStatus(inputs: ProjectSessionStatusInputs): SessionStatus {
  const { session, pendingQuestionsCount, pendingConfirmationsCount, activeWorkflowStepName, lastProgressAt } = inputs

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
    lastProgressAt,
    links: {
      ui: `/?sessionId=${encodeURIComponent(session.id)}`,
    },
  }
}
