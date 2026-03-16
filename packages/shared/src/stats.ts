/**
 * Session stats computation - aggregates MessageStats from multiple messages
 * into SessionStats for benchmarking and progression charts.
 */

import type { Message, SessionStats, StatsDataPoint } from './types.js'

const roundTo1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Compute aggregated session stats from an array of messages.
 * 
 * Returns null if no messages have stats.
 * 
 * Weighted average for speeds: totalTokens / totalTime
 * This gives accurate average throughput across varying context sizes.
 */
export function computeSessionStats(messages: Message[]): SessionStats | null {
  // Filter to messages with stats (assistant messages with LLM timing data)
  const messagesWithStats = messages.filter(
    (msg): msg is Message & { stats: NonNullable<Message['stats']> } => 
      msg.stats !== undefined && msg.stats !== null
  )

  if (messagesWithStats.length === 0) {
    return null
  }

  // Aggregate totals
  let totalTime = 0
  let toolTime = 0
  let prefillTokens = 0
  let generationTokens = 0
  let totalPrefillTime = 0  // For weighted average
  let totalGenTime = 0      // For weighted average

  const dataPoints: StatsDataPoint[] = []

  for (const msg of messagesWithStats) {
    const stats = msg.stats

    totalTime += stats.totalTime
    toolTime += stats.toolTime
    prefillTokens += stats.prefillTokens
    generationTokens += stats.generationTokens

    // Compute time from tokens/speed for weighted average
    // time = tokens / speed
    const prefillTime = stats.prefillSpeed > 0 
      ? stats.prefillTokens / stats.prefillSpeed 
      : 0
    const genTime = stats.generationSpeed > 0 
      ? stats.generationTokens / stats.generationSpeed 
      : 0

    totalPrefillTime += prefillTime
    totalGenTime += genTime

    // Create data point for progression charts
    dataPoints.push({
      messageId: msg.id,
      timestamp: msg.timestamp,
      mode: stats.mode,
      contextTokens: stats.prefillTokens,
      prefillSpeed: stats.prefillSpeed,
      generationSpeed: stats.generationSpeed,
      totalTime: stats.totalTime,
      aiTime: stats.totalTime - stats.toolTime,
    })
  }

  // Compute weighted average speeds
  const avgPrefillSpeed = totalPrefillTime > 0 
    ? roundTo1(prefillTokens / totalPrefillTime) 
    : 0
  const avgGenerationSpeed = totalGenTime > 0 
    ? roundTo1(generationTokens / totalGenTime) 
    : 0

  return {
    totalTime: roundTo1(totalTime),
    aiTime: roundTo1(totalTime - toolTime),
    toolTime: roundTo1(toolTime),
    prefillTokens,
    generationTokens,
    avgPrefillSpeed,
    avgGenerationSpeed,
    messageCount: messagesWithStats.length,
    dataPoints,
  }
}
