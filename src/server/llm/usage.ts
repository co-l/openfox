/**
 * Provider-agnostic token usage extraction.
 *
 * Reads the raw `usage` payload from an OpenAI-compatible chat completion
 * response (non-streaming or streaming chunk) and normalizes it into the
 * shared `TokenUsage` shape used across OpenFox.
 *
 * Recognized cache fields (provider-reported):
 *   - OpenAI: `usage.prompt_tokens_details.cached_tokens`
 *   - Anthropic-style: `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`
 *
 * When no cache field is present, the result has `cacheSource: 'unavailable'`
 * and the cache fields stay undefined — never zero. Callers MUST NOT treat
 * missing values as zero provider cache.
 *
 * Returns null when the payload is missing or unusable so callers can fall
 * back to estimation without crashing.
 */

import type { CacheSource, TokenUsage } from '../../shared/types.js'

interface RawUsageLike {
  prompt_tokens?: unknown
  completion_tokens?: unknown
  total_tokens?: unknown
  prompt_tokens_details?: { cached_tokens?: unknown } | null
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
  // Defensive extra: some providers surface cached counts under other names.
  cached_tokens?: unknown
  cache_read_tokens?: unknown
  cache_creation_tokens?: unknown
  prompt_cache_hit_tokens?: unknown
  prompt_cache_miss_tokens?: unknown
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function readCacheField(usage: RawUsageLike): number | undefined {
  const candidates: Array<unknown> = [
    usage.prompt_tokens_details?.cached_tokens,
    usage.cache_read_input_tokens,
    usage.cache_read_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cached_tokens,
  ]
  for (const candidate of candidates) {
    const num = toFiniteNumber(candidate)
    if (num !== undefined && num > 0) return num
  }
  return undefined
}

function readCacheWriteField(usage: RawUsageLike): number | undefined {
  const candidates: Array<unknown> = [
    usage.cache_creation_input_tokens,
    usage.cache_creation_tokens,
    usage.prompt_cache_miss_tokens,
  ]
  for (const candidate of candidates) {
    const num = toFiniteNumber(candidate)
    if (num !== undefined && num > 0) return num
  }
  return undefined
}

/**
 * Extract a normalized usage object from a raw `usage` payload.
 *
 * Returns null when the payload is missing entirely or does not expose any
 * usable token count. When present but missing cache info, the returned
 * usage still carries the prompt/completion/total numbers with
 * `cacheSource: 'unavailable'`.
 */
export function extractTokenUsage(rawUsage: unknown): TokenUsage | null {
  if (!rawUsage || typeof rawUsage !== 'object') return null

  const usage = rawUsage as RawUsageLike
  const promptTokens = toFiniteNumber(usage.prompt_tokens)
  const completionTokens = toFiniteNumber(usage.completion_tokens)

  if (promptTokens === undefined && completionTokens === undefined) {
    return null
  }

  const totalRaw = toFiniteNumber(usage.total_tokens)
  const totalTokens = totalRaw ?? (promptTokens ?? 0) + (completionTokens ?? 0)

  const cachedPromptTokens = readCacheField(usage)
  const cacheWriteTokens = readCacheWriteField(usage)

  let cacheSource: CacheSource = 'unavailable'
  if (cachedPromptTokens !== undefined || cacheWriteTokens !== undefined) {
    cacheSource = 'provider'
  }

  const base: TokenUsage = {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens,
    cacheSource,
  }

  if (cachedPromptTokens !== undefined) base.cachedPromptTokens = cachedPromptTokens
  if (cacheWriteTokens !== undefined) base.cacheWriteTokens = cacheWriteTokens

  return base
}

/**
 * Streaming chunk variant: identical semantics to `extractTokenUsage`,
 * kept as a separate export so call sites read clearly.
 */
export function extractTokenUsageForChunk(rawUsage: unknown): TokenUsage | null {
  return extractTokenUsage(rawUsage)
}

/**
 * Mark a usage object as OpenFox-estimated (not provider cache).
 * Used when callers synthesize cache metrics from context tracking.
 */
export function markEstimated(usage: TokenUsage): TokenUsage {
  return { ...usage, cacheSource: 'estimated' }
}

/**
 * Mark a usage object as having no cache information available.
 * Defaults to current values; clears cache fields when caller provides zero.
 */
export function markUnavailable(usage: TokenUsage): TokenUsage {
  const result: TokenUsage = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cacheSource: 'unavailable',
  }
  return result
}
