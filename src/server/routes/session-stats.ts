import type { Request, Response } from 'express'
import type { SessionManager } from '../session/index.js'

/**
 * GET /api/sessions/:id/stats — full session stats (headline + per-response
 * and per-call progression) for the StatsModal's on-demand detail load.
 * Cheap: extracted from snapshot messages + later message.done events, no
 * message rebuild. The always-on session payload only carries the lean
 * summary; this endpoint is hit once when the user asks to see the full
 * response log.
 */
export async function handleGetSessionStats(
  sessionManager: SessionManager,
  req: Request,
  res: Response,
): Promise<void> {
  const { getEventStore, combineEventsWithSnapshot } = await import('../events/index.js')
  const { buildSessionStatsMessages } = await import('../events/folding.js')
  const { computeSessionStats } = await import('../../shared/stats.js')

  const sessionId = req.params['id'] as string
  const session = sessionManager.getSession(sessionId)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const eventStore = getEventStore()
  const { snapshot, events: eventsSinceSnapshot } = eventStore.getEventsSinceSnapshot(sessionId)
  const events = combineEventsWithSnapshot(sessionId, snapshot, eventsSinceSnapshot)
  const stats = computeSessionStats(buildSessionStatsMessages(events))

  res.json({ stats })
}
