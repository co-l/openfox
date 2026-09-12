/**
 * Session stats computation - aggregates response-level MessageStats from
 * multiple assistant messages into SessionStats for benchmarking and trends.
 */

import type {
  AgentSessionStats,
  CallStatsDataPoint,
  Message,
  MessageStats,
  ModelSessionStats,
  SessionStats,
  StatsDataPoint,
  StatsIdentity,
} from './types.js'

const roundTo1 = (n: number): number => Math.round(n * 10) / 10

type MessageWithStats = Message & { stats: NonNullable<Message['stats']> }

function hasValidStats(stats: NonNullable<Message['stats']>): stats is MessageStats {
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
  if (msg.subAgentType) {
    return { agentId: msg.subAgentType, isSubAgent: true }
  }
  if (msg.subAgentId) {
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

function buildSessionStats(messagesWithStats: MessageWithStats[]): Omit<SessionStats, 'modelGroups' | 'agentGroups'> {
  let totalTime = 0
  let toolTime = 0
  let prefillTokens = 0
  let generationTokens = 0
  let totalPrefillSource = 0
  let totalPrefillTime = 0
  let totalGenTime = 0

  const dataPoints: StatsDataPoint[] = []
  const callDataPoints: CallStatsDataPoint[] = []
  let sessionCallIndex = 0

  for (const [index, msg] of messagesWithStats.entries()) {
    const stats = msg.stats
    const identity = getStatsIdentity(stats)

    totalTime += stats.totalTime
    toolTime += stats.toolTime
    prefillTokens += stats.prefillTokens
    generationTokens += stats.generationTokens

    // prefillSpeed is computed from the non-cached token source
    // (prefTokenIncrement when known, else the full prompt), so aggregate on
    // the same source: source / speed reconstructs real prefill time (ttft).
    const prefillSource = stats.prefTokenIncrement ?? stats.prefillTokens
    const prefillTime = stats.prefillSpeed > 0 ? prefillSource / stats.prefillSpeed : 0
    const genTime = stats.generationSpeed > 0 ? stats.generationTokens / stats.generationSpeed : 0

    totalPrefillSource += prefillSource
    totalPrefillTime += prefillTime
    totalGenTime += genTime

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
        sessionCallIndex,
        callIndex: call.callIndex,
        promptTokens: call.promptTokens,
        completionTokens: call.completionTokens,
        ttft: call.ttft,
        completionTime: call.completionTime,
        prefillSpeed: call.prefillSpeed,
        generationSpeed: call.generationSpeed,
        totalTime: call.totalTime,
        ...(call.temperature !== undefined && { temperature: call.temperature }),
        ...(call.topP !== undefined && { topP: call.topP }),
        ...(call.topK !== undefined && { topK: call.topK }),
        ...(call.maxTokens !== undefined && { maxTokens: call.maxTokens }),
      })
    }
  }

  const avgPrefillSpeed = totalPrefillTime > 0 ? roundTo1(totalPrefillSource / totalPrefillTime) : 0
  const avgGenerationSpeed = totalGenTime > 0 ? roundTo1(generationTokens / totalGenTime) : 0

  return {
    totalTime: roundTo1(totalTime),
    aiTime: roundTo1(totalTime - toolTime),
    toolTime: roundTo1(toolTime),
    prefillTokens,
    generationTokens,
    avgPrefillSpeed,
    avgGenerationSpeed,
    responseCount: messagesWithStats.length,
    llmCallCount: callDataPoints.length,
    dataPoints,
    callDataPoints,
  }
}

/**
 * Compute aggregated session stats from an array of messages.
 *
 * Returns null if no messages have stats.
 *
 * Weighted average for speeds: totalTokens / totalTime, computed on the same
 * token source the per-message speed uses (prefTokenIncrement when available,
 * else the full prompt) so cached prefill work is not counted as processed.
 */
export function computeSessionStats(messages: Message[]): SessionStats | null {
  const messagesWithStats = messages
    .filter((msg): msg is MessageWithStats => msg.stats !== undefined && msg.stats !== null && hasValidStats(msg.stats))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  if (messagesWithStats.length === 0) {
    return null
  }

  const modelBuckets = new Map<string, MessageWithStats[]>()
  for (const message of messagesWithStats) {
    const key = getModelGroupKey(getStatsIdentity(message.stats))
    const existing = modelBuckets.get(key) ?? []
    modelBuckets.set(key, [...existing, message])
  }

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
    modelGroups,
    agentGroups,
  }
}
