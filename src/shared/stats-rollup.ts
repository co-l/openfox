/**
 * Server-side session event rollup computation.
 *
 * Sourced strictly from the EventStore stream:
 *   - `context.compacted` → compactions
 *   - `pattern.retry`     → retries
 *   - `tool.call`         → tool calls
 *   - `tool.result`       → tool errors
 *   - `message.start`/`message.done` with `subAgentId`/`subAgentType` → sub-agent activity
 *
 * Never inferred from token metrics. The plugin reads this rollup via the
 * `/api/sessions/:id/stats` endpoint or through the live `registerHook`
 * stream (Plugin API v2).
 */

import type { CompactionEventRecord, RetryEventRecord, SessionStatsEventRollup, ToolEventEntry } from './types.js'
import { classifyTool } from './tool-category.js'

export interface MinimalEvent {
  type: string
  data: unknown
  timestamp?: number
}

interface CompactionEventData {
  closedWindowId: string
  newWindowId: string
  beforeTokens: number
  afterTokens: number
  subAgentId?: string
  subAgentType?: string
}

interface PatternRetryEventData {
  pattern: string
  field: string
  attempt: number
  maxAttempts: number
}

interface ToolCallEventData {
  messageId: string
  toolCall: { id: string; name: string }
}

interface ToolResultEventData {
  messageId: string
  toolCallId: string
  result: { success?: boolean }
}

interface MessageStartData {
  messageId: string
  subAgentId?: string
  subAgentType?: string
}

function pickNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function buildCompactions(events: MinimalEvent[]): CompactionEventRecord[] {
  const records: CompactionEventRecord[] = []
  for (const event of events) {
    if (event.type !== 'context.compacted') continue
    const data = event.data as unknown as CompactionEventData
    const before = pickNumber(data.beforeTokens)
    const after = pickNumber(data.afterTokens)
    const reduction = before - after
    records.push({
      timestamp: event.timestamp ?? 0,
      closedWindowId: data.closedWindowId,
      newWindowId: data.newWindowId,
      beforeTokens: before,
      afterTokens: after,
      reduction,
      reductionPercent: before > 0 ? (reduction / before) * 100 : 0,
      ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
      ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
    })
  }
  return records
}

function buildRetries(events: MinimalEvent[]): RetryEventRecord[] {
  const records: RetryEventRecord[] = []
  for (const event of events) {
    if (event.type !== 'pattern.retry') continue
    const data = event.data as unknown as PatternRetryEventData
    const eventData = event.data as { messageId?: string }
    records.push({
      timestamp: event.timestamp ?? 0,
      type: 'pattern',
      reason: data.pattern,
      pattern: data.pattern,
      ...(eventData.messageId ? { messageId: eventData.messageId } : {}),
      attempt: data.attempt,
      maxAttempts: data.maxAttempts,
    })
  }
  return records
}

function buildToolBreakdown(events: MinimalEvent[]): {
  byName: Map<string, { count: number; errors: number }>
  totalCount: number
  totalErrors: number
} {
  const resultIndex = new Map<string, { success: boolean }>()
  for (const event of events) {
    if (event.type !== 'tool.result') continue
    const data = event.data as unknown as ToolResultEventData
    resultIndex.set(data.toolCallId, { success: data.result?.success !== false })
  }
  const byName = new Map<string, { count: number; errors: number }>()
  let totalCount = 0
  let totalErrors = 0
  for (const event of events) {
    if (event.type !== 'tool.call') continue
    const data = event.data as unknown as ToolCallEventData
    const name = data.toolCall?.name ?? 'unknown'
    const result = resultIndex.get(data.toolCall.id)
    const isError = result ? !result.success : false
    const entry = byName.get(name) ?? { count: 0, errors: 0 }
    entry.count += 1
    if (isError) entry.errors += 1
    byName.set(name, entry)
    totalCount += 1
    if (isError) totalErrors += 1
  }
  return { byName, totalCount, totalErrors }
}

function buildToolBreakdownEntries(byName: Map<string, { count: number; errors: number }>): ToolEventEntry[] {
  const entries: ToolEventEntry[] = []
  for (const [toolName, agg] of byName.entries()) {
    entries.push({
      toolName,
      category: classifyTool(toolName),
      count: agg.count,
      errors: agg.errors,
    })
  }
  return entries.sort((a, b) => b.count - a.count)
}

function countSubAgentCalls(events: MinimalEvent[]): number {
  let count = 0
  for (const event of events) {
    if (event.type !== 'message.start') continue
    const data = event.data as unknown as MessageStartData
    if (data.subAgentId || data.subAgentType) count += 1
  }
  return count
}

export interface BuildSessionStatsEventRollupOptions {
  /**
   * Number of historical compactions known to the snapshot via
   * `snapshot.contextState.compactionCount` but whose per-compaction
   * details (`snapshot.contextWindows`) are unavailable (legacy snapshot
   * with the details pruned). The rollup adds this to the
   * `compactionCount` it reports but does NOT synthesize fake per-record
   * entries in `compactions[]`. `compactionsDetailsAvailable` is set to
   * `false` whenever this baseline is non-zero, even if newer detailed
   * compactions exist, because the per-compaction history is only partial.
   */
  legacyCompactionCount?: number
}

/**
 * Build the session-wide event rollup from a list of stored events.
 *
 * `messageIdToResponseIndex` is used to backfill `responseIndex` on retry
 * records. When the caller does not have a response index map, retries are
 * returned without `responseIndex`.
 *
 * `options.legacyCompactionCount` lets the caller carry over a known
 * historical compaction count from a legacy snapshot whose per-compaction
 * details (`contextWindows[]`) were pruned. The count is added to the
 * reported `compactionCount`; `compactions[]` contains only records that really exist (no fabricated
 * details) and `compactionsDetailsAvailable` remains `false` while any
 * legacy count-only baseline is present.
 */
export function buildSessionStatsEventRollup(
  events: MinimalEvent[],
  messageIdToResponseIndex?: Map<string, number>,
  options?: BuildSessionStatsEventRollupOptions,
): SessionStatsEventRollup {
  const compactions = buildCompactions(events)
  const retries = buildRetries(events)
  if (messageIdToResponseIndex) {
    for (const r of retries) {
      const msgId = (r as { messageId?: string }).messageId
      const idx = msgId ? messageIdToResponseIndex.get(msgId) : undefined
      if (idx !== undefined) (r as { responseIndex: number }).responseIndex = idx + 1
    }
  }
  const { byName, totalCount, totalErrors } = buildToolBreakdown(events)
  const subAgentCalls = countSubAgentCalls(events)
  const legacy = options?.legacyCompactionCount ?? 0
  // Details are complete only when no legacy count-only baseline exists.
  // A post-snapshot detailed compaction does not make the missing historical
  // legacy records suddenly complete.
  const detailsAvailable = legacy === 0
  return {
    compactions,
    retries,
    toolCalls: totalCount,
    toolErrors: totalErrors,
    toolBreakdown: buildToolBreakdownEntries(byName),
    subAgentCalls,
    compactionCount: compactions.length + legacy,
    retryCount: retries.length,
    compactionsDetailsAvailable: detailsAvailable,
  }
}

/** Empty session-wide event rollup (no events yet). */
export function emptyEventRollup(): SessionStatsEventRollup {
  return {
    compactions: [],
    retries: [],
    toolCalls: 0,
    toolErrors: 0,
    toolBreakdown: [],
    subAgentCalls: 0,
    compactionCount: 0,
    retryCount: 0,
    compactionsDetailsAvailable: true,
  }
}
