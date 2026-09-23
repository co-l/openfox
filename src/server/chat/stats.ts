/**
 * Message stats computation - single source of truth for the formula.
 */

import type { LLMCallStats, MessageStats, StatsIdentity, ToolMode, TokenUsage } from '../../shared/types.js'
import type { StreamTiming } from '../llm/streaming.js'

const roundTo1 = (n: number): number => Math.round(n * 10) / 10

type CacheAwareUsage = Pick<TokenUsage, 'promptTokens' | 'completionTokens'> &
  Partial<Omit<TokenUsage, 'promptTokens' | 'completionTokens'>>

export interface ModelParams {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

function buildCallStats(input: {
  identity: StatsIdentity
  callIndex: number
  timing: StreamTiming
  promptTokens: number
  completionTokens: number
  prefTokenIncrement?: number
  timestamp?: string
  modelParams?: ModelParams
  providerUsage?: CacheAwareUsage
}): LLMCallStats {
  const {
    identity,
    callIndex,
    timing,
    promptTokens,
    completionTokens,
    prefTokenIncrement,
    timestamp,
    modelParams,
    providerUsage,
  } = input
  const prefillSource = prefTokenIncrement ?? promptTokens
  return {
    ...identity,
    callIndex,
    promptTokens,
    completionTokens,
    ...(prefTokenIncrement !== undefined && { prefTokenIncrement }),
    ...(providerUsage?.cachedPromptTokens !== undefined && {
      cachedPromptTokens: providerUsage.cachedPromptTokens,
    }),
    ...(providerUsage?.cacheWriteTokens !== undefined && {
      cacheWriteTokens: providerUsage.cacheWriteTokens,
    }),
    ...(providerUsage?.cacheSource !== undefined && { cacheSource: providerUsage.cacheSource }),
    ttft: timing.ttft,
    completionTime: timing.completionTime,
    prefillSpeed: timing.ttft > 0 ? roundTo1(prefillSource / timing.ttft) : 0,
    generationSpeed: timing.completionTime > 0 ? roundTo1(completionTokens / timing.completionTime) : 0,
    totalTime: roundTo1(timing.ttft + timing.completionTime),
    ...(timestamp ? { timestamp } : {}),
    ...(modelParams?.temperature !== undefined && { temperature: modelParams.temperature }),
    ...(modelParams?.topP !== undefined && { topP: modelParams.topP }),
    ...(modelParams?.topK !== undefined && { topK: modelParams.topK }),
    ...(modelParams?.maxTokens !== undefined && { maxTokens: modelParams.maxTokens }),
  }
}

export interface StatsInput {
  identity: StatsIdentity
  mode: ToolMode
  timing: StreamTiming
  usage: CacheAwareUsage
  /** New (non-cached) tokens that required actual prompt processing */
  prefTokenIncrement?: number
  /** Tool execution time in seconds (default: 0) */
  toolTime?: number
  /** Override totalTime instead of computing from timing + toolTime */
  totalTimeOverride?: number
  timestamp?: string
  modelParams?: ModelParams
}

/**
 * Compute message stats from LLM timing and usage data.
 *
 * For single LLM calls: totalTime = ttft + completionTime + toolTime
 * For multi-call flows: pass totalTimeOverride with wall clock time
 */
export function computeMessageStats(input: StatsInput): MessageStats {
  const {
    identity,
    mode,
    timing,
    usage,
    prefTokenIncrement,
    toolTime = 0,
    totalTimeOverride,
    timestamp,
    modelParams,
  } = input

  const totalTime = totalTimeOverride ?? timing.ttft + timing.completionTime + toolTime
  const prefillSource = prefTokenIncrement ?? usage.promptTokens

  return {
    ...identity,
    mode,
    totalTime,
    toolTime,
    prefillTokens: usage.promptTokens,
    ...(prefTokenIncrement !== undefined && { prefTokenIncrement }),
    prefillSpeed: timing.ttft > 0 ? roundTo1(prefillSource / timing.ttft) : 0,
    generationTokens: usage.completionTokens,
    generationSpeed: timing.completionTime > 0 ? roundTo1(usage.completionTokens / timing.completionTime) : 0,
    ...(usage.cachedPromptTokens !== undefined && { cachedPromptTokens: usage.cachedPromptTokens }),
    ...(usage.cacheWriteTokens !== undefined && { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage.cacheSource !== undefined && { cacheSource: usage.cacheSource }),
    llmCalls: [
      buildCallStats({
        identity,
        callIndex: 1,
        timing,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        ...(prefTokenIncrement !== undefined && { prefTokenIncrement }),
        ...(timestamp ? { timestamp } : {}),
        ...(modelParams && { modelParams }),
        providerUsage: usage,
      }),
    ],
  }
}

/**
 * Compute stats from aggregated multi-call data (e.g., TurnMetrics).
 * Speeds are computed as averages across all calls.
 */
export function computeAggregatedStats(input: {
  identity: StatsIdentity
  mode: ToolMode
  totalPrefillTokens: number
  totalPrefillIncrement?: number // sum of prefTokenIncrement across all calls; used for accurate prefillSpeed
  totalGenTokens: number
  totalPrefillTime: number // sum of ttft across all calls
  totalGenTime: number // sum of completionTime across all calls
  totalToolTime: number // seconds
  totalTime: number // wall clock seconds
  thinkingDuration?: number // seconds
  llmCalls?: LLMCallStats[]
}): MessageStats {
  const {
    identity,
    mode,
    totalPrefillTokens,
    totalPrefillIncrement,
    totalGenTokens,
    totalPrefillTime,
    totalGenTime,
    totalToolTime,
    totalTime,
    thinkingDuration,
    llmCalls,
  } = input

  const prefillSource = totalPrefillIncrement ?? totalPrefillTokens

  // Response-level cache totals are only exposed when every persisted call has
  // explicit provider attribution. A mixed/partial response must not turn
  // missing provider cache data into an apparent zero.
  const completeProviderCache =
    Boolean(llmCalls?.length) &&
    llmCalls!.every((call) => call.cacheSource === 'provider' && call.cachedPromptTokens !== undefined)
  const cachedPromptTokens = completeProviderCache
    ? llmCalls!.reduce((sum, call) => sum + (call.cachedPromptTokens ?? 0), 0)
    : undefined
  const completeCacheWrite = completeProviderCache && llmCalls!.every((call) => call.cacheWriteTokens !== undefined)
  const cacheWriteTokens = completeCacheWrite
    ? llmCalls!.reduce((sum, call) => sum + (call.cacheWriteTokens ?? 0), 0)
    : undefined

  return {
    ...identity,
    mode,
    totalTime,
    toolTime: totalToolTime,
    ...(thinkingDuration !== undefined && { thinkingDuration }),
    prefillTokens: totalPrefillTokens,
    ...(totalPrefillIncrement !== undefined && { prefTokenIncrement: totalPrefillIncrement }),
    prefillSpeed: totalPrefillTime > 0 ? roundTo1(prefillSource / totalPrefillTime) : 0,
    generationTokens: totalGenTokens,
    generationSpeed: totalGenTime > 0 ? roundTo1(totalGenTokens / totalGenTime) : 0,
    ...(cachedPromptTokens !== undefined && { cachedPromptTokens }),
    ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
    ...(completeProviderCache ? { cacheSource: 'provider' as const } : {}),
    ...(llmCalls ? { llmCalls } : {}),
  }
}
