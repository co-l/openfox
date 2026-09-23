/**
 * Session stats computation - aggregates response-level MessageStats
 * across multiple assistant messages into SessionStats for benchmarking and trends.
 */

import { emptyEventRollup } from './stats-rollup.js'

import type {
  AgentSessionStats,
  CallStatsDataPoint,
  MessageStats,
  ModelSessionStats,
  ModelStatsSummary,
  SessionStats,
  SessionStatsSummary,
  StatsDataPoint,
  StatsIdentity,
  StatsSource,
} from './types.js'

const roundTo1 = (n: number): number => Math.round(n * 10) / 10

type MessageWithStats = StatsSource & { stats: MessageStats }

function hasValidStats(stats: NonNullable<StatsSource['stats']>): stats is MessageStats {
  return typeof stats.totalTime === 'number' && !Number.isNaN(stats.totalTime)
}

function getStatsIdentity(stats: MessageStats): StatsIdentity {
  return {
    providerId: stats.providerId,
    providerName: stats.providerName,
    backend: stats.backend,
    model: stats.model,
    ...(stats.reasoningEffort ? { reasoningEffort: stats.reasoningEffort } : {}),
  }
}

function getModelGroupKey(identity: StatsIdentity): string {
  const effortSuffix = identity.reasoningEffort ? `::${identity.reasoningEffort}` : ''
  return `${identity.providerId}::${identity.model}${effortSuffix}`
}

function getModelGroupLabel(identity: StatsIdentity): string {
  const effortSuffix = identity.reasoningEffort ? `:${identity.reasoningEffort}` : ''
  return `${identity.providerName} > ${identity.model}${effortSuffix}`
}

function getAgentId(msg: MessageWithStats): { agentId: string; isSubAgent: boolean } {
  const source = msg as { subAgentType?: string; subAgentId?: string }
  if (source.subAgentType) {
    return { agentId: source.subAgentType, isSubAgent: true }
  }
  if (source.subAgentId) {
    return { agentId: msg.stats.mode, isSubAgent: true }
  }
  return { agentId: msg.stats.mode, isSubAgent: false }
}

function buildAgentSessionStats(messagesWithStats: MessageWithStats[]): AgentSessionStats[] {
  const agentBuckets = new Map<string, { isSubAgent: boolean; messages: MessageWithStats[] }>()
  for (const msg of messagesWithStats) {
    const { agentId, isSubAgent } = getAgentId(msg)
    const existing = agentBuckets.get(agentId)
    if (existing) {
      existing.messages.push(msg)
      if (isSubAgent) existing.isSubAgent = true
    } else {
      agentBuckets.set(agentId, { isSubAgent, messages: [msg] })
    }
  }

  return Array.from(agentBuckets.entries()).map(([agentId, bucket]) => {
    const groupStats = buildSessionStats(bucket.messages)
    return {
      agentId,
      isSubAgent: bucket.isSubAgent,
      ...groupStats,
    }
  })
}

interface Aggregation {
  totalTime: number
  toolTime: number
  prefillTokens: number
  generationTokens: number
  totalPrefillSource: number
  totalPrefillTime: number
  totalGenTime: number
  responseCount: number
  llmCallCount: number
}

/**
 * Sum per-response MessageStats, tracking the same accumulators weighted
 * averages use. `totalPrefillSource` aggregates prefTokenIncrement (or
 * full prompt) — the same token source per-message prefill speed uses —
 * so cached prefill work is not counted as processed.
 */
function aggregateMessages(messagesWithStats: MessageWithStats[]): Aggregation {
  let totalTime = 0
  let toolTime = 0
  let prefillTokens = 0
  let generationTokens = 0
  let totalPrefillSource = 0
  let totalPrefillTime = 0
  let totalGenTime = 0
  let llmCallCount = 0

  for (const msg of messagesWithStats) {
    const stats = msg.stats
    totalTime += stats.totalTime
    toolTime += stats.toolTime
    prefillTokens += stats.prefillTokens
    generationTokens += stats.generationTokens

    // prefillSpeed is computed from the non-cached token source
    // (prefTokenIncrement when known, else full prompt), so aggregate on
    // that same source: source / speed reconstructs the real prefill time (ttft).
    const prefillSource = stats.prefTokenIncrement ?? stats.prefillTokens
    const prefillTime = stats.prefillSpeed > 0 ? prefillSource / stats.prefillSpeed : 0
    const genTime = stats.generationSpeed > 0 ? stats.generationTokens / stats.generationSpeed : 0

    totalPrefillSource += prefillSource
    totalPrefillTime += prefillTime
    totalGenTime += genTime
    llmCallCount += stats.llmCalls?.length ?? 0
  }

  return {
    totalTime,
    toolTime,
    prefillTokens,
    generationTokens,
    totalPrefillSource,
    totalPrefillTime,
    totalGenTime,
    responseCount: messagesWithStats.length,
    llmCallCount,
  }
}

function summaryFields(agg: Aggregation): Omit<SessionStatsSummary, 'modelGroups'> {
  return {
    totalTime: roundTo1(agg.totalTime),
    aiTime: roundTo1(agg.totalTime - agg.toolTime),
    toolTime: roundTo1(agg.toolTime),
    prefillTokens: agg.prefillTokens,
    generationTokens: agg.generationTokens,
    avgPrefillSpeed: agg.totalPrefillTime > 0 ? roundTo1(agg.totalPrefillSource / agg.totalPrefillTime) : 0,
    avgGenerationSpeed: agg.totalGenTime > 0 ? roundTo1(agg.generationTokens / agg.totalGenTime) : 0,
    responseCount: agg.responseCount,
    llmCallCount: agg.llmCallCount,
    totalPrefillSource: agg.totalPrefillSource,
    totalPrefillTime: agg.totalPrefillTime,
    totalGenTime: agg.totalGenTime,
  }
}

function buildModelSummary(identity: StatsIdentity, groupMessages: MessageWithStats[]): ModelStatsSummary {
  return {
    ...identity,
    key: getModelGroupKey(identity),
    label: getModelGroupLabel(identity),
    ...summaryFields(aggregateMessages(groupMessages)),
  }
}

function filterWithStats(messages: StatsSource[]): MessageWithStats[] {
  return messages
    .filter((msg): msg is MessageWithStats => msg.stats !== undefined && msg.stats !== null && hasValidStats(msg.stats))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

function buildSessionStats(
  messagesWithStats: MessageWithStats[],
): Omit<SessionStats, 'modelGroups' | 'agentGroups' | 'events'> {
  const agg = aggregateMessages(messagesWithStats)
  const dataPoints: StatsDataPoint[] = []
  const callDataPoints: CallStatsDataPoint[] = []
  let sessionCallIndex = 0

  for (const [index, msg] of messagesWithStats.entries()) {
    const stats = msg.stats
    const identity = getStatsIdentity(stats)

    dataPoints.push({
      messageId: msg.id,
      timestamp: msg.timestamp,
      ...identity,
      mode: stats.mode,
      responseIndex: index + 1,
      prefillTokens: stats.prefillTokens,
      generationTokens: stats.generationTokens,
      prefillSpeed: stats.prefillSpeed,
      generationSpeed: stats.generationSpeed,
      totalTime: stats.totalTime,
      aiTime: stats.totalTime - stats.toolTime,
      toolTime: stats.toolTime,
      ...(stats.cachedPromptTokens !== undefined ? { cachedPromptTokens: stats.cachedPromptTokens } : {}),
      ...(stats.cacheWriteTokens !== undefined ? { cacheWriteTokens: stats.cacheWriteTokens } : {}),
      ...(stats.cacheSource !== undefined ? { cacheSource: stats.cacheSource } : {}),
      ...(stats.retryCount !== undefined ? { retryCount: stats.retryCount } : {}),
      ...(stats.compactionCount !== undefined ? { compactionCount: stats.compactionCount } : {}),
    })

    const llmCalls = stats.llmCalls ?? []
    for (const call of llmCalls) {
      sessionCallIndex += 1
      callDataPoints.push({
        messageId: msg.id,
        timestamp: call.timestamp ?? msg.timestamp,
        providerId: call.providerId,
        providerName: call.providerName,
        backend: call.backend,
        model: call.model,
        mode: stats.mode,
        responseIndex: index + 1,
        callIndex: call.callIndex,
        sessionCallIndex,
        promptTokens: call.promptTokens,
        completionTokens: call.completionTokens,
        ttft: call.ttft,
        completionTime: call.completionTime,
        prefillSpeed: call.prefillSpeed,
        generationSpeed: call.generationSpeed,
        totalTime: call.totalTime,
        ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
        ...(call.topP !== undefined ? { topP: call.topP } : {}),
        ...(call.topK !== undefined ? { topK: call.topK } : {}),
        ...(call.maxTokens !== undefined ? { maxTokens: call.maxTokens } : {}),
        ...(call.cachedPromptTokens !== undefined ? { cachedPromptTokens: call.cachedPromptTokens } : {}),
        ...(call.cacheWriteTokens !== undefined ? { cacheWriteTokens: call.cacheWriteTokens } : {}),
        ...(call.cacheSource !== undefined ? { cacheSource: call.cacheSource } : {}),
        ...(call.contextSize !== undefined ? { contextSize: call.contextSize } : {}),
        ...(call.retries !== undefined ? { retries: call.retries } : {}),
      })
    }
  }

  return {
    ...summaryFields(agg),
    dataPoints,
    callDataPoints,
  }
}

function groupMessagesByModel(messagesWithStats: MessageWithStats[]): Map<string, MessageWithStats[]> {
  const modelBuckets = new Map<string, MessageWithStats[]>()
  for (const message of messagesWithStats) {
    const key = getModelGroupKey(getStatsIdentity(message.stats))
    const existing = modelBuckets.get(key)
    if (existing) {
      existing.push(message)
    } else {
      modelBuckets.set(key, [message])
    }
  }
  return modelBuckets
}

/**
 * Compute full aggregated session stats (headline + per-response and
 * per-call progression data) from an array of messages.
 *
 * Returns null if no messages have stats.
 */
export function computeSessionStats(messages: StatsSource[]): SessionStats | null {
  const messagesWithStats = filterWithStats(messages)
  if (messagesWithStats.length === 0) {
    return null
  }

  const modelBuckets = groupMessagesByModel(messagesWithStats)
  const modelGroups: ModelSessionStats[] = Array.from(modelBuckets.entries()).map(([key, groupMessages]) => {
    const identity = getStatsIdentity(groupMessages[0]!.stats)
    const groupStats = buildSessionStats(groupMessages)
    const agentGroups = buildAgentSessionStats(groupMessages)
    return {
      ...identity,
      key,
      label: getModelGroupLabel(identity),
      ...groupStats,
      agentGroups,
    }
  })

  const agentGroups = buildAgentSessionStats(messagesWithStats)

  return {
    ...buildSessionStats(messagesWithStats),
    // Session-wide event rollup; the route replaces this with the real
    // EventStore-derived rollup when serving `/api/sessions/:id/stats`.
    events: emptyEventRollup(),
    modelGroups,
    agentGroups,
  }
}

/**
 * Compute lean session stats summary (headline aggregates only) from an
 * array of messages. Exact across every context window when fed the full
 * history, yet small enough to ship on every session load.
 *
 * Returns null if no messages have stats.
 */
export function computeSessionStatsSummary(messages: StatsSource[]): SessionStatsSummary | null {
  const messagesWithStats = filterWithStats(messages)
  if (messagesWithStats.length === 0) {
    return null
  }

  const modelGroups: ModelStatsSummary[] = Array.from(groupMessagesByModel(messagesWithStats).entries()).map(
    ([, groupMessages]) => {
      const identity = getStatsIdentity(groupMessages[0]!.stats)
      return buildModelSummary(identity, groupMessages)
    },
  )

  return {
    ...summaryFields(aggregateMessages(messagesWithStats)),
    modelGroups,
  }
}

/**
 * Merge an in-flight turn's cumulative stats into a server-computed summary
 * so the UI grows live and lands on final numbers as the turn ends (the
 * live channel is cleared in the same frame the finished response lands in
 * the next summary). `base` may be null when no response has completed yet —
 * the summary is then built from the live response alone.
 */
export function mergeLiveStats(base: SessionStatsSummary | null, live: MessageStats): SessionStatsSummary {
  const prefillSource = live.prefTokenIncrement ?? live.prefillTokens
  const prefillTime = live.prefillSpeed > 0 ? prefillSource / live.prefillSpeed : 0
  const genTime = live.generationSpeed > 0 ? live.generationTokens / live.generationSpeed : 0
  const liveCalls = live.llmCalls?.length ?? 0
  const identity = getStatsIdentity(live)
  const key = getModelGroupKey(identity)

  const mergedAgg: Aggregation = {
    totalTime: (base?.totalTime ?? 0) + live.totalTime,
    toolTime: (base?.toolTime ?? 0) + live.toolTime,
    prefillTokens: (base?.prefillTokens ?? 0) + live.prefillTokens,
    generationTokens: (base?.generationTokens ?? 0) + live.generationTokens,
    totalPrefillSource: (base?.totalPrefillSource ?? 0) + prefillSource,
    totalPrefillTime: (base?.totalPrefillTime ?? 0) + prefillTime,
    totalGenTime: (base?.totalGenTime ?? 0) + genTime,
    responseCount: (base?.responseCount ?? 0) + 1,
    llmCallCount: (base?.llmCallCount ?? 0) + liveCalls,
  }

  const modelGroups: ModelStatsSummary[] = (base?.modelGroups ?? []).map((group) => {
    if (group.key !== key) return group
    const groupAgg: Aggregation = {
      totalTime: group.totalTime + live.totalTime,
      toolTime: group.toolTime + live.toolTime,
      prefillTokens: group.prefillTokens + live.prefillTokens,
      generationTokens: group.generationTokens + live.generationTokens,
      totalPrefillSource: group.totalPrefillSource + prefillSource,
      totalPrefillTime: group.totalPrefillTime + prefillTime,
      totalGenTime: group.totalGenTime + genTime,
      responseCount: group.responseCount + 1,
      llmCallCount: group.llmCallCount + liveCalls,
    }
    return {
      ...group,
      ...summaryFields(groupAgg),
    }
  })

  if (!modelGroups.some((group) => group.key === key)) {
    modelGroups.push(buildModelSummary(identity, [{ id: 'live', timestamp: new Date().toISOString(), stats: live }]))
  }

  return {
    ...summaryFields(mergedAgg),
    modelGroups,
  }
}
