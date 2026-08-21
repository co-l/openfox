import type { SessionManager } from '../session/index.js'
import { getEventStore, combineEventsWithSnapshot } from '../events/index.js'
import { foldLastProgressAt, foldPendingConfirmations } from '../events/folding.js'
import { getPendingQuestionsForSession } from '../tools/index.js'
import { projectSessionStatus, type SessionStatus } from './session-status.js'

export function getSessionStatus(sessionManager: SessionManager, sessionId: string): SessionStatus | null {
  const session = sessionManager.getSession(sessionId)
  if (!session) return null

  const activeWorkflowExecution = sessionManager.getActiveWorkflowExecution(sessionId)
  const { snapshot, events: eventsSinceSnapshot } = getEventStore().getEventsSinceSnapshot(sessionId)
  const events = combineEventsWithSnapshot(sessionId, snapshot, eventsSinceSnapshot)

  return projectSessionStatus({
    session,
    pendingQuestionsCount: getPendingQuestionsForSession(sessionId).length,
    pendingConfirmationsCount: foldPendingConfirmations(events).length,
    activeWorkflowStepName: activeWorkflowExecution?.currentStepName ?? null,
    lastProgressAt: foldLastProgressAt(events),
  })
}

export function getSessionStatuses(
  sessionManager: SessionManager,
  sessionIds: string[],
): Record<string, SessionStatus> {
  const statuses: Record<string, SessionStatus> = {}
  for (const sessionId of sessionIds) {
    const status = getSessionStatus(sessionManager, sessionId)
    if (status) statuses[sessionId] = status
  }
  return statuses
}
