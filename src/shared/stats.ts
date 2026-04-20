/**
 * Session stats computation - aggregates response-level MessageStats from
 * multiple assistant messages into SessionStats for benchmarking and trends.
 */

import type { CallStatsDataPoint, Message, MessageStats, ModelSessionStats, SessionStats, StatsDataPoint, StatsIdentity } from './types.js'

const roundTo1 = (n: number): number => Math.round(n * 10) / 10

type MessageWithStats = Message & { stats: NonNullable<Message['stats']> }

function getStatsIdentity(stats: MessageStats): StatsIdentity {
  return {
    providerId: stats.providerId,
    providerName: stats.providerName,
    backend: stats.backend,
    model: stats.model,
  }
}

function getModelGroupKey(identity: StatsIdentity): string {
  return `${identity.providerId}::${identity.model}`
}

function getModelGroupLabel(identity: StatsIdentity): string {
  return `${identity.providerName} > ${identity.model}`
}

function buildSessionStats(messagesWithStats: MessageWithStats[]): Omit<SessionStats, 'modelGroups'> {
  let totalTime = 0
  let toolTime = 0
  let prefillTokens = 0
  let generationTokens = 0
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

    const prefillTime = stats.prefillSpeed > 0 ? stats.prefillTokens / stats.prefillSpeed : 0
    const genTime = stats.generationSpeed > 0 ? stats.generationTokens / stats.generationSpeed : 0

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

  const avgPrefillSpeed = totalPrefillTime > 0 ? roundTo1(prefillTokens / totalPrefillTime) : 0
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
 * Weighted average for speeds: totalTokens / totalTime
 * This gives accurate average throughput across varying context sizes.
 */
export function computeSessionStats(messages: Message[]): SessionStats | null {
  const messagesWithStats = messages.filter(
    (msg): msg is MessageWithStats => msg.stats !== undefined && msg.stats !== null
  ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

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
    return {
      ...identity,
      key,
      label: getModelGroupLabel(identity),
      ...groupStats,
    }
  })

  return {
    ...buildSessionStats(messagesWithStats),
    modelGroups,
  }
}
