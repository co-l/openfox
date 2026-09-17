/**
 * Observability aggregation.
 *
 * Builds the session-level observability payload from per-message
 * `MessageStats` and the underlying EventStore stream. Pure function —
 * no I/O, no DB access. Tolerates legacy sessions that predate the
 * observability types (optional fields stay undefined).
 */

import type {
  CacheSource,
  Message,
  MessageStats,
  ObservabilityCallRow,
  ObservabilityResponseRow,
  ObservabilityStats,
  ObservabilitySummary,
  RetryRecord,
  ToolActivityEntry,
  ToolActivitySummary,
  ModelObservability,
  CompactionRecord,
} from './types.js'
import { classifyTool, TOOL_CATEGORY_ORDER } from './tool-category.js'
import type { ToolCategory } from './types.js'

// ============================================================================
// Event helpers (small subset, typed for compilation in isolation)
// ============================================================================

interface MinimalEvent {
  type: string
  data: Record<string, unknown>
  timestamp?: number
}

interface CompactionEventData {
  closedWindowId: string
  newWindowId: string
  beforeTokens: number
  afterTokens: number
  summary: string
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
  toolCall: { id: string; name: string; arguments?: Record<string, unknown> }
}

interface ToolResultEventData {
  messageId: string
  toolCallId: string
  result: { success: boolean; durationMs: number; error?: string }
}

interface MessageStartEventData {
  messageId: string
  contextWindowId?: string
  subAgentId?: string
  subAgentType?: string
  isSystemGenerated?: boolean
  messageKind?: string
}

// ============================================================================
// Percentile helpers
// ============================================================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[idx] ?? 0
}

function pickNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function computeCompactionRecords(events: MinimalEvent[]): CompactionRecord[] {
  const records: CompactionRecord[] = []
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

function computeRetryRecords(
  events: MinimalEvent[],
  responseByMessageId: Map<string, { responseIndex: number; mode: string }>,
): RetryRecord[] {
  const records: RetryRecord[] = []
  for (const event of events) {
    if (event.type !== 'pattern.retry') continue
    const data = event.data as unknown as PatternRetryEventData
    // pattern.retry references a messageId of the truncated assistant message.
    // We surface the retry on the next response (responseIndex+1) because the
    // retry triggers a continuation message + new response.
    const meta = responseByMessageId.get((event.data['messageId'] as string) ?? '')
    records.push({
      timestamp: event.timestamp ?? 0,
      type: 'pattern',
      pattern: data.pattern,
      field: data.field,
      attempt: data.attempt,
      maxAttempts: data.maxAttempts,
      responseIndex: meta ? meta.responseIndex + 1 : 0,
      ...(meta?.mode ? { reason: `pattern:${data.pattern}` } : {}),
    })
  }
  // Truncation + continuation retries are captured via MessageStats.retryCount
  // We merge them in a later pass to keep attribution per response.
  return records
}

function buildToolActivity(events: MinimalEvent[]): ToolActivitySummary {
  const byTool = new Map<string, ToolActivityEntry>()
  let totalCount = 0
  let totalErrors = 0
  const byCategory = Object.fromEntries(TOOL_CATEGORY_ORDER.map((c) => [c, 0])) as Record<ToolCategory, number>

  // First pass: index durations from tool.result events.
  const resultIndex = new Map<string, { durationMs: number; success: boolean }>()
  for (const event of events) {
    if (event.type !== 'tool.result') continue
    const data = event.data as unknown as ToolResultEventData
    resultIndex.set(data.toolCallId, {
      durationMs: pickNumber(data.result?.durationMs),
      success: data.result?.success !== false,
    })
  }

  for (const event of events) {
    if (event.type !== 'tool.call') continue
    const data = event.data as unknown as ToolCallEventData
    const name = data.toolCall?.name ?? 'unknown'
    const category = classifyTool(name)
    const result = resultIndex.get(data.toolCall.id)
    const duration = result?.durationMs ?? 0
    const isError = result ? !result.success : false
    const existing = byTool.get(name)
    if (existing) {
      existing.count += 1
      existing.totalDurationMs += duration
      if (isError) existing.errorCount += 1
    } else {
      byTool.set(name, { toolName: name, category, count: 1, totalDurationMs: duration, errorCount: isError ? 1 : 0 })
    }
    byCategory[category] = (byCategory[category] ?? 0) + 1
    totalCount += 1
    if (isError) totalErrors += 1
  }

  const byToolList = Array.from(byTool.values()).sort((a, b) => b.count - a.count)
  return { totalCount, totalErrors, byCategory, byTool: byToolList }
}

function computeFollowingTools(events: MinimalEvent[]): Map<string, string> {
  // For each LLM call (keyed by messageId), find the first tool.call event
  // that appears after the message.done event for that messageId.
  // We return a map from "messageId:callIndex" → toolName. The caller can
  // correlate by messageId + callIndex.
  const followingByMessageCall = new Map<string, string>()
  // We can't determine callIndex from events alone without per-call metadata.
  // As a pragmatic fallback, return the first tool name for each assistant
  // messageId, which is sufficient for the dashboard "following action" column.
  const assistantMessageIds = new Set<string>()
  const assistantDoneIndex = new Map<string, number>()
  const toolCallsByIndex = new Map<number, ToolCallEventData[]>()

  events.forEach((e, idx) => {
    if (e.type === 'message.start') {
      const data = e.data as unknown as MessageStartEventData
      if (data.messageId) assistantMessageIds.add(data.messageId)
    } else if (e.type === 'message.done') {
      const data = e.data as unknown as { messageId: string; stats?: MessageStats }
      if (data.messageId && assistantMessageIds.has(data.messageId)) {
        assistantDoneIndex.set(data.messageId, idx)
      }
    } else if (e.type === 'tool.call') {
      const data = e.data as unknown as ToolCallEventData
      const arr = toolCallsByIndex.get(idx) ?? []
      arr.push(data)
      toolCallsByIndex.set(idx, arr)
    }
  })

  for (const [messageId, doneIdx] of assistantDoneIndex.entries()) {
    let nextToolName: string | undefined
    for (let i = doneIdx + 1; i < events.length; i += 1) {
      const event = events[i]
      if (!event) continue
      if (event.type === 'tool.call') {
        const data = event.data as unknown as ToolCallEventData
        nextToolName = data.toolCall?.name
        break
      }
      // Stop searching once the assistant moves on to a new message
      if (event.type === 'message.start' || event.type === 'message.done') {
        const startData = event.data as unknown as { messageId: string }
        if (startData.messageId !== messageId && event.type === 'message.start') break
      }
    }
    if (nextToolName) followingByMessageCall.set(messageId, nextToolName)
  }

  return followingByMessageCall
}

function buildResponseRows(
  messages: Message[],
  messageIdToResponseIndex: Map<string, number>,
  retriesByResponse: Map<number, RetryRecord[]>,
  compactionsByResponse: Map<number, CompactionRecord[]>,
  toolActivityByResponse: Map<number, ToolActivityEntry[]>,
  toolCountByResponse: Map<number, number>,
  cacheByResponse: Map<
    number,
    { rawPrompt: number; cacheRead: number; cacheWrite: number; newInput: number; cacheSource: CacheSource }
  >,
): ObservabilityResponseRow[] {
  const rows: ObservabilityResponseRow[] = []
  for (const msg of messages) {
    const stats = msg.stats
    if (!stats) continue
    const responseIndex = messageIdToResponseIndex.get(msg.id)
    if (responseIndex === undefined) continue
    const cache = cacheByResponse.get(responseIndex) ?? {
      rawPrompt: stats.prefillTokens,
      cacheRead: stats.cachedPromptTokens ?? 0,
      cacheWrite: stats.cacheWriteTokens ?? 0,
      newInput: stats.prefTokenIncrement ?? stats.prefillTokens,
      cacheSource: stats.cacheSource ?? 'unavailable',
    }
    const cacheHitRatio =
      cache.cacheSource === 'provider' && cache.rawPrompt > 0 ? cache.cacheRead / cache.rawPrompt : undefined
    const contextBefore = 0
    const contextAfter = stats.prefillTokens
    rows.push({
      responseIndex,
      messageId: msg.id,
      timestamp: msg.timestamp,
      durationSeconds: stats.totalTime,
      llmCalls: stats.llmCalls?.length ?? 1,
      retryCount: stats.retryCount ?? retriesByResponse.get(responseIndex)?.length ?? 0,
      contextBefore,
      contextAfter,
      rawPrompt: cache.rawPrompt,
      cacheRead: cache.cacheRead,
      cacheWrite: cache.cacheWrite,
      newInput: cache.newInput,
      ...(cacheHitRatio !== undefined && { cacheHitRatio }),
      cacheSource: cache.cacheSource,
      toolCalls: toolCountByResponse.get(responseIndex) ?? 0,
      toolBreakdown: toolActivityByResponse.get(responseIndex) ?? [],
      retries: retriesByResponse.get(responseIndex) ?? [],
      compactions: compactionsByResponse.get(responseIndex) ?? [],
    })
  }
  return rows.sort((a, b) => a.responseIndex - b.responseIndex)
}

function aggregateCallSource(calls: ObservabilityCallRow[]): CacheSource {
  if (calls.length === 0) return 'unavailable'
  let hasProvider = false
  let hasEstimated = false
  let hasUnavailable = false
  for (const c of calls) {
    if (c.cacheSource === 'provider') hasProvider = true
    else if (c.cacheSource === 'estimated') hasEstimated = true
    else hasUnavailable = true
  }
  if (hasProvider && !hasUnavailable && !hasEstimated) return 'provider'
  if (hasEstimated && !hasProvider && !hasUnavailable) return 'estimated'
  return 'unavailable'
}

function computeSummary(args: {
  calls: ObservabilityCallRow[]
  responses: ObservabilityResponseRow[]
  retries: RetryRecord[]
  compactions: CompactionRecord[]
  toolActivity: ToolActivitySummary
  durationSeconds: number
  cacheSource: CacheSource
}): ObservabilitySummary {
  const { calls, responses, retries, compactions, toolActivity, durationSeconds, cacheSource } = args
  const rawPromptTokens = calls.reduce((sum, c) => sum + c.promptTokens, 0)
  const providerCachedTokens = calls.reduce(
    (sum, c) => sum + (c.cacheSource === 'provider' ? (c.cachedPromptTokens ?? 0) : 0),
    0,
  )
  const cacheWriteTokens = calls.reduce((sum, c) => sum + (c.cacheWriteTokens ?? 0), 0)
  const estimatedNewInputTokens = calls.reduce((sum, c) => sum + (c.cacheSource === 'provider' ? 0 : c.promptTokens), 0)
  const providerDenominator = calls
    .filter((c) => c.cacheSource === 'provider')
    .reduce((sum, c) => sum + c.promptTokens, 0)
  const providerCacheHitRatio =
    cacheSource === 'provider' && providerDenominator > 0 ? providerCachedTokens / providerDenominator : undefined

  const contexts = calls.map((c) => c.contextSize).sort((a, b) => a - b)
  const contextP50 = percentile(contexts, 0.5)
  const contextP95 = percentile(contexts, 0.95)
  const contextMax = contexts.length > 0 ? (contexts[contexts.length - 1] ?? 0) : 0

  const generationTokens = calls.reduce((sum, c) => sum + c.completionTokens, 0)
  const llmCalls = calls.length
  const generatedPerCall = llmCalls > 0 ? generationTokens / llmCalls : 0

  const cafDenominator = calls.reduce(
    (sum, c) => sum + (c.cacheSource === 'provider' ? c.promptTokens - (c.cachedPromptTokens ?? 0) : 0),
    0,
  )
  const contextAmplificationFactor =
    cacheSource === 'provider' && cafDenominator > 0 ? rawPromptTokens / cafDenominator : undefined

  const subAgentCalls = toolActivity.byCategory['sub-agent'] ?? 0
  const toolCalls = toolActivity.totalCount

  return {
    durationSeconds,
    responses: responses.length,
    llmCalls,
    callsPerResponse: responses.length > 0 ? llmCalls / responses.length : 0,
    rawPromptTokens,
    providerCachedTokens,
    cacheWriteTokens,
    estimatedNewInputTokens,
    ...(providerCacheHitRatio !== undefined && { providerCacheHitRatio }),
    contextP50,
    contextP95,
    contextMax,
    ...(contextAmplificationFactor !== undefined && { contextAmplificationFactor, amplificationSource: 'provider' }),
    generationTokens,
    generatedPerCall,
    cacheSource,
    retries: retries.length,
    compactions: compactions.length,
    subAgentCalls,
    toolCalls,
  }
}

/**
 * Compute observability stats from message stats + the raw event stream.
 *
 * The event stream is used to derive:
 *   - compactions from `context.compacted` events
 *   - retries from `pattern.retry` events (truncation/continuation are added
 *     via `MessageStats.retryCount` when available)
 *   - tool activity from `tool.call` / `tool.result` events
 *   - "following tool" lookup per assistant message
 *
 * The function is tolerant of legacy sessions that predate the
 * observability types — missing fields are simply left undefined and
 * ratios are not displayed.
 */
export function computeObservability(
  messages: Message[],
  events: MinimalEvent[],
  options?: { sessionId?: string; sessionTitle?: string; generatedAt?: string },
): ObservabilityStats | null {
  const messagesWithStats = messages.filter((m) => m.stats !== undefined && m.stats !== null)
  if (messagesWithStats.length === 0) return null

  // Build messageId → responseIndex map (1-based, only stats messages).
  const sortedByTime = [...messagesWithStats].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
  const messageIdToResponseIndex = new Map<string, number>()
  sortedByTime.forEach((m, i) => messageIdToResponseIndex.set(m.id, i + 1))

  const compactions = computeCompactionRecords(events)
  const compactionsByResponse = new Map<number, CompactionRecord[]>()
  for (const record of compactions) {
    // Compaction events don't reference a response messageId. Approximate by
    // bucketing into the most recent response (best effort).
    const responseIndex = sortedByTime.findIndex(
      (m) => m.timestamp && record.timestamp && new Date(m.timestamp).getTime() <= record.timestamp,
    )
    const idx = responseIndex >= 0 ? responseIndex + 1 : sortedByTime.length
    const list = compactionsByResponse.get(idx) ?? []
    list.push(record)
    compactionsByResponse.set(idx, list)
  }

  // Build retries by response.
  const retries = computeRetryRecords(
    events,
    new Map(Array.from(messageIdToResponseIndex.entries()).map(([id, idx]) => [id, { responseIndex: idx, mode: '' }])),
  )
  const retriesByResponse = new Map<number, RetryRecord[]>()
  for (const r of retries) {
    if (r.responseIndex <= 0) continue
    const list = retriesByResponse.get(r.responseIndex) ?? []
    list.push(r)
    retriesByResponse.set(r.responseIndex, list)
  }

  // Add truncation + continuation retries from MessageStats.retryCount where present.
  for (const msg of sortedByTime) {
    const idx = messageIdToResponseIndex.get(msg.id)
    const stats = msg.stats
    if (!stats || idx === undefined) continue
    const explicitRetries = stats.retryCount ?? 0
    const list = retriesByResponse.get(idx) ?? []
    // The pattern.retry records already cover the pattern path.
    // The leftover (explicitRetries - pattern matches) is split heuristically
    // between truncation and continuation. Without per-call metadata we
    // attribute it to continuation as the most common fallback in agent-loop.
    const leftover = Math.max(0, explicitRetries - list.length)
    for (let k = 0; k < leftover; k += 1) {
      list.push({ timestamp: new Date(msg.timestamp).getTime() || 0, type: 'continuation', responseIndex: idx })
    }
    retriesByResponse.set(idx, list)
  }
  const allRetries = Array.from(retriesByResponse.values()).flat()

  // Tool activity
  const toolActivity = buildToolActivity(events)
  const toolActivityByResponse = new Map<number, ToolActivityEntry[]>()
  const toolCountByResponse = new Map<number, number>()
  for (const event of events) {
    if (event.type !== 'tool.call') continue
    const data = event.data as unknown as ToolCallEventData
    const msgId = data.messageId
    const responseIndex = messageIdToResponseIndex.get(msgId)
    if (responseIndex === undefined) continue
    const list = toolActivityByResponse.get(responseIndex) ?? []
    const name = data.toolCall.name
    const entry = toolActivity.byTool.find((t) => t.toolName === name)
    if (entry) list.push(entry)
    toolActivityByResponse.set(responseIndex, list)
    toolCountByResponse.set(responseIndex, (toolCountByResponse.get(responseIndex) ?? 0) + 1)
  }

  // Cache per response (sum of LLMCallStats values per response)
  const cacheByResponse = new Map<
    number,
    { rawPrompt: number; cacheRead: number; cacheWrite: number; newInput: number; cacheSource: CacheSource }
  >()
  for (const msg of sortedByTime) {
    const stats = msg.stats
    const idx = messageIdToResponseIndex.get(msg.id)
    if (!stats || idx === undefined) continue
    const calls = stats.llmCalls ?? []
    let raw = 0
    let read = 0
    let write = 0
    let uncached = 0
    let hasProvider = false
    let hasOther = false
    for (const call of calls) {
      raw += call.promptTokens
      if (call.cachedPromptTokens !== undefined) read += call.cachedPromptTokens
      if (call.cacheWriteTokens !== undefined) write += call.cacheWriteTokens
      if (call.cacheSource === 'provider') {
        hasProvider = true
        uncached += call.promptTokens - (call.cachedPromptTokens ?? 0)
      } else {
        hasOther = true
        uncached += call.promptTokens
      }
    }
    cacheByResponse.set(idx, {
      rawPrompt: raw,
      cacheRead: read,
      cacheWrite: write,
      newInput: uncached,
      cacheSource: hasProvider && !hasOther ? 'provider' : 'unavailable',
    })
  }

  // Following tool lookup
  const followingTools = computeFollowingTools(events)

  // Build call rows from MessageStats.llmCalls (per-call) or fall back to response-level.
  const calls: ObservabilityCallRow[] = []
  let sessionCallIndex = 0
  const sortedWithStats = sortedByTime
  for (const msg of sortedWithStats) {
    const stats = msg.stats
    if (!stats) continue
    const responseIndex = messageIdToResponseIndex.get(msg.id) ?? 0
    const responseCalls = stats.llmCalls ?? []
    if (responseCalls.length === 0) continue
    for (const call of responseCalls) {
      sessionCallIndex += 1
      const followingTool = followingTools.get(msg.id)
      calls.push({
        sessionCallIndex,
        responseIndex,
        callIndex: call.callIndex,
        messageId: msg.id,
        timestamp: call.timestamp ?? msg.timestamp,
        providerId: call.providerId,
        providerName: call.providerName,
        backend: call.backend,
        model: call.model,
        mode: stats.mode,
        promptTokens: call.promptTokens,
        ...(call.cachedPromptTokens !== undefined && { cachedPromptTokens: call.cachedPromptTokens }),
        ...(call.cacheWriteTokens !== undefined && { cacheWriteTokens: call.cacheWriteTokens }),
        ...(call.cacheSource && { cacheSource: call.cacheSource }),
        completionTokens: call.completionTokens,
        ttft: call.ttft,
        completionTime: call.completionTime,
        totalTime: call.totalTime,
        prefillSpeed: call.prefillSpeed,
        generationSpeed: call.generationSpeed,
        contextSize: call.contextSize ?? call.promptTokens,
        retries: call.retries ?? 0,
        ...(followingTool && { followingTool }),
      })
    }
  }

  const cacheSource = aggregateCallSource(calls)

  // Duration = from earliest message to latest message timestamp.
  let durationSeconds = 0
  if (sortedByTime.length > 0) {
    const first = sortedByTime[0]?.timestamp
    const last = sortedByTime[sortedByTime.length - 1]?.timestamp
    if (first && last) durationSeconds = (new Date(last).getTime() - new Date(first).getTime()) / 1000
  }

  const responseRows = buildResponseRows(
    sortedByTime,
    messageIdToResponseIndex,
    retriesByResponse,
    compactionsByResponse,
    toolActivityByResponse,
    toolCountByResponse,
    cacheByResponse,
  )

  const summary = computeSummary({
    calls,
    responses: responseRows,
    retries: allRetries,
    compactions,
    toolActivity,
    durationSeconds,
    cacheSource,
  })

  // Model breakdown
  const modelBuckets = new Map<string, ObservabilityCallRow[]>()
  for (const c of calls) {
    const key = `${c.providerId}::${c.model}`
    const list = modelBuckets.get(key) ?? []
    list.push(c)
    modelBuckets.set(key, list)
  }
  const modelBreakdown: ModelObservability[] = Array.from(modelBuckets.entries()).map(([key, modelCalls]) => {
    const sample = modelCalls[0]
    if (!sample) {
      return {
        key,
        label: key,
        providerId: '',
        providerName: '',
        backend: 'unknown',
        model: '',
        summary: { ...summary, llmCalls: 0 },
        calls: [],
      }
    }
    const modelRetries = allRetries.filter((r) => {
      const call = modelCalls.find((c) => c.responseIndex === r.responseIndex)
      return Boolean(call)
    })
    const modelCompactions = compactions.filter(() => true) // compactions are provider-agnostic in this iteration
    const modelToolActivity = buildToolActivity(events)
    const modelSummary = computeSummary({
      calls: modelCalls,
      responses: responseRows.filter((r) => modelCalls.some((c) => c.responseIndex === r.responseIndex)),
      retries: modelRetries,
      compactions: modelCompactions,
      toolActivity: modelToolActivity,
      durationSeconds,
      cacheSource,
    })
    const sampleCall = modelCalls.find((c) => c.providerId === sample.providerId && c.model === sample.model) ?? sample
    return {
      key,
      label: `${sampleCall.providerName} > ${sampleCall.model}`,
      providerId: sampleCall.providerId,
      providerName: sampleCall.providerName,
      backend: sampleCall.backend,
      model: sampleCall.model,
      summary: modelSummary,
      calls: modelCalls,
    }
  })

  return {
    sessionId: options?.sessionId ?? '',
    ...(options?.sessionTitle ? { sessionTitle: options.sessionTitle } : {}),
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    summary,
    responses: responseRows,
    calls,
    compactions,
    retries: allRetries,
    toolActivity,
    modelBreakdown,
    schemaVersion: 'obs.v1',
  }
}
