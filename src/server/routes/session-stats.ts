import type { Request, Response } from 'express'
import type { SessionManager } from '../session/index.js'

/**
 * GET /api/sessions/:id/stats — full session stats (headline + per-response
 * and per-call progression) for the StatsModal's on-demand detail load.
 * Cheap: extracted from the merged `message` nodes on the active path, no
 * message rebuild. The always-on session payload only carries the lean
 * summary; this endpoint is hit once when the user asks to see the full
 * response log.
 */
export async function handleGetSessionStats(
  sessionManager: SessionManager,
  req: Request,
  res: Response,
): Promise<void> {
  const { getEventStore } = await import('../events/index.js')
  const { buildSessionStatsMessages } = await import('../events/folding.js')
  const { computeSessionStats } = await import('../../shared/stats.js')

  const sessionId = req.params['id'] as string
  const session = sessionManager.getSession(sessionId)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)
  const stats = computeSessionStats(buildSessionStatsMessages(events))

  res.json({ stats })
}
