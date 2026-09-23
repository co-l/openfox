/**
 * Provider-agnostic token-usage extractor.
 *
 * Reads the raw `usage` payload from an LLM response and normalizes it
 * into the shared `TokenUsage` shape. Provider cache fields are NEVER
 * derived from `prefTokenIncrement` — only fields reported by the provider
 * itself are surfaced.
 *
 * Returns a `TokenUsage` with `cacheSource = 'unavailable'` when no cache
 * fields are present (e.g. mock LLM). The default `cacheSource` is
 * `'unavailable'` — not zero — so the dashboard never substitutes absence
 * for zero cache.
 */

import type { CacheSource, TokenUsage } from '../../shared/types.js'

interface RawUsageLike {
  prompt_tokens?: unknown
  completion_tokens?: unknown
  total_tokens?: unknown
  prompt_tokens_details?: { cached_tokens?: unknown } | null
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cached_tokens?: unknown
  cache_read_tokens?: unknown
  cache_write_tokens?: unknown
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

function readCacheField(usage: RawUsageLike): { value: number; present: true } | undefined {
  const candidates: Array<unknown> = [
    usage.prompt_tokens_details?.cached_tokens,
    usage.cache_read_input_tokens,
    usage.cache_read_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cached_tokens,
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const num = toFiniteNumber(candidate)
    if (num !== undefined) return { value: num, present: true }
  }
  return undefined
}

function readCacheWriteField(usage: RawUsageLike): { value: number; present: true } | undefined {
  const candidates: Array<unknown> = [
    usage.cache_creation_input_tokens,
    usage.cache_write_tokens,
    usage.prompt_cache_miss_tokens,
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const num = toFiniteNumber(candidate)
    if (num !== undefined) return { value: num, present: true }
  }
  return undefined
}

/**
 * Extract a normalized `TokenUsage` from a raw provider usage payload.
 * Returns null when the payload is missing entirely or does not expose
 * any usable token count.
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

  const cachedPrompt = readCacheField(usage)
  const cacheWrite = readCacheWriteField(usage)

  let cacheSource: CacheSource = 'unavailable'
  if (cachedPrompt !== undefined || cacheWrite !== undefined) {
    cacheSource = 'provider'
  }

  const base: TokenUsage = {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens,
    cacheSource,
  }
  // Presence of the field — even with value 0 — is a provider measurement
  // (a provider can legitimately report zero cached tokens, e.g. fresh
  // conversation). Only treat the value as missing when no field exists.
  if (cachedPrompt !== undefined) base.cachedPromptTokens = cachedPrompt.value
  if (cacheWrite !== undefined) base.cacheWriteTokens = cacheWrite.value

  return base
}

/**
 * Streaming-chunk variant of `extractTokenUsage`. Identical semantics;
 * kept as a separate export so streaming call sites read clearly.
 */
export function extractTokenUsageForChunk(rawUsage: unknown): TokenUsage | null {
  return extractTokenUsage(rawUsage)
}
