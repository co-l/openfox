/**
 * Message stats computation - single source of truth for the formula.
 */

import type { LLMCallStats, MessageStats, ToolMode } from '../../shared/types.js'
import type { StreamTiming } from '../llm/streaming.js'

const roundTo1 = (n: number): number => Math.round(n * 10) / 10

function buildCallStats(input: {
  callIndex: number
  timing: StreamTiming
  promptTokens: number
  completionTokens: number
  timestamp?: string
}): LLMCallStats {
  const { callIndex, timing, promptTokens, completionTokens, timestamp } = input
  return {
    callIndex,
    promptTokens,
    completionTokens,
    ttft: timing.ttft,
    completionTime: timing.completionTime,
    prefillSpeed: timing.ttft > 0 ? roundTo1(promptTokens / timing.ttft) : 0,
    generationSpeed: timing.completionTime > 0 ? roundTo1(completionTokens / timing.completionTime) : 0,
    totalTime: roundTo1(timing.ttft + timing.completionTime),
    ...(timestamp ? { timestamp } : {}),
  }
}

export interface StatsInput {
  model: string
  mode: ToolMode
  timing: StreamTiming
  usage: { promptTokens: number; completionTokens: number }
  /** Tool execution time in seconds (default: 0) */
  toolTime?: number
  /** Override totalTime instead of computing from timing + toolTime */
  totalTimeOverride?: number
  timestamp?: string
}

/**
 * Compute message stats from LLM timing and usage data.
 * 
 * For single LLM calls: totalTime = ttft + completionTime + toolTime
 * For multi-call flows: pass totalTimeOverride with wall clock time
 */
export function computeMessageStats(input: StatsInput): MessageStats {
  const { model, mode, timing, usage, toolTime = 0, totalTimeOverride, timestamp } = input
  
  const totalTime = totalTimeOverride ?? (timing.ttft + timing.completionTime + toolTime)
  
  return {
    model,
    mode,
    totalTime,
    toolTime,
    prefillTokens: usage.promptTokens,
    prefillSpeed: timing.ttft > 0 ? roundTo1(usage.promptTokens / timing.ttft) : 0,
    generationTokens: usage.completionTokens,
    generationSpeed: timing.completionTime > 0 ? roundTo1(usage.completionTokens / timing.completionTime) : 0,
    llmCalls: [buildCallStats({
      callIndex: 1,
      timing,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      ...(timestamp ? { timestamp } : {}),
    })],
  }
}

/**
 * Compute stats from aggregated multi-call data (e.g., TurnMetrics).
 * Speeds are computed as averages across all calls.
 */
export function computeAggregatedStats(input: {
  model: string
  mode: ToolMode
  totalPrefillTokens: number
  totalGenTokens: number
  totalPrefillTime: number  // sum of ttft across all calls
  totalGenTime: number      // sum of completionTime across all calls
  totalToolTime: number     // seconds
  totalTime: number         // wall clock seconds
  llmCalls?: LLMCallStats[]
}): MessageStats {
  const { model, mode, totalPrefillTokens, totalGenTokens, totalPrefillTime, totalGenTime, totalToolTime, totalTime, llmCalls } = input
  
  return {
    model,
    mode,
    totalTime,
    toolTime: totalToolTime,
    prefillTokens: totalPrefillTokens,
    prefillSpeed: totalPrefillTime > 0 ? roundTo1(totalPrefillTokens / totalPrefillTime) : 0,
    generationTokens: totalGenTokens,
    generationSpeed: totalGenTime > 0 ? roundTo1(totalGenTokens / totalGenTime) : 0,
    ...(llmCalls ? { llmCalls } : {}),
  }
}
