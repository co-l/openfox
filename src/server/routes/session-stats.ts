import type { Request, Response } from 'express'
import type { SessionManager } from '../session/index.js'

/**
 * GET /api/sessions/:id/stats — full session stats (headline + per-response
 * and per-call progression + event-derived rollup) for the StatsModal's
 * on-demand detail load. Cheap: extracted from snapshot messages + later
 * message.done events, no message rebuild. The always-on session payload
 * only carries the lean summary; this endpoint is hit once when the user
 * asks to see the full response log.
 *
 * The event-derived rollup (compactions, retries, tool calls, sub-agent
 * activity) is computed server-side from the EventStore stream so the
 * data is correct even when the user opens StatsModal long after the
 * session finished. Cache fields are NEVER inferred from
 * `prefTokenIncrement` — only provider-reported cache numbers are surfaced.
 */
export async function handleGetSessionStats(
  sessionManager: SessionManager,
  req: Request,
  res: Response,
): Promise<void> {
  const { getEventStore, combineEventsWithSnapshot, getLegacyCompactionBaseline } = await import('../events/index.js')
  const { buildSessionStatsMessages } = await import('../events/folding.js')
  const { computeSessionStats } = await import('../../shared/stats.js')
  const { buildSessionStatsEventRollup } = await import('../../shared/stats-rollup.js')

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

  // The headline/stats aggregate uses `MessageStats` payloads (a separate
  // pipeline from raw events). The event-derived rollup (compactions,
  // retries, tool calls, sub-agent activity) is computed independently
  // from the same combined event stream so legacy snapshots whose raw
  // events were pruned still surface the correct counts.
  //
  // Backfill `responseIndex` on retry records from the response
  // progression so plugin consumers can place retries on the timeline.
  const messageIdToResponseIndex = new Map<string, number>()
  for (const dp of stats?.dataPoints ?? []) {
    if (dp.messageId) messageIdToResponseIndex.set(dp.messageId, dp.responseIndex - 1)
  }
  const legacy = getLegacyCompactionBaseline(snapshot)
  const rollup = buildSessionStatsEventRollup(
    events,
    messageIdToResponseIndex.size > 0 ? messageIdToResponseIndex : undefined,
    legacy ?? undefined,
  )
  if (stats) {
    stats.events = rollup
  }

  res.json({ stats })
}
