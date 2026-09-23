/**
 * Tests for `extractTokenUsage` (server-side provider-agnostic cache
 * extraction). The parser recognises OpenAI / Anthropic / MiniMax-style
 * fields and never substitutes absence of cache info for zero cache.
 */

import { describe, it, expect } from 'vitest'
import { extractTokenUsage, extractTokenUsageForChunk } from './usage.js'

describe('extractTokenUsage', () => {
  it('parses basic OpenAI usage (prompt/completion/total only)', () => {
    const result = extractTokenUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
    })
    expect(result).toEqual({
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cacheSource: 'unavailable',
    })
  })

  it('parses OpenAI prompt_tokens_details.cached_tokens', () => {
    const result = extractTokenUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_tokens_details: { cached_tokens: 900 },
    })
    expect(result).toEqual({
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
      cachedPromptTokens: 900,
      cacheSource: 'provider',
    })
  })

  it('parses Anthropic-style cache_read/cache_creation', () => {
    const result = extractTokenUsage({
      prompt_tokens: 2000,
      completion_tokens: 200,
      total_tokens: 2200,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 500,
    })
    expect(result).toEqual({
      promptTokens: 2000,
      completionTokens: 200,
      totalTokens: 2200,
      cachedPromptTokens: 1500,
      cacheWriteTokens: 500,
      cacheSource: 'provider',
    })
  })

  it('parses MiniMax-style cached_tokens', () => {
    const result = extractTokenUsage({
      prompt_tokens: 5000,
      completion_tokens: 200,
      total_tokens: 5200,
      cached_tokens: 4500,
    })
    expect(result).toEqual({
      promptTokens: 5000,
      completionTokens: 200,
      totalTokens: 5200,
      cachedPromptTokens: 4500,
      cacheSource: 'provider',
    })
  })

  it('treats cached_tokens=0 as a valid provider measurement (cacheSource=provider, value=0)', () => {
    const result = extractTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cached_tokens: 0,
    })
    expect(result!.cachedPromptTokens).toBe(0)
    expect(result!.cacheSource).toBe('provider')
  })

  it('returns cacheSource=unavailable when no cache field is present', () => {
    const result = extractTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    })
    expect(result!.cacheSource).toBe('unavailable')
    expect(result!.cachedPromptTokens).toBeUndefined()
    expect(result!.cacheWriteTokens).toBeUndefined()
  })

  it('returns null when the payload is missing token counts', () => {
    expect(extractTokenUsage(undefined)).toBeNull()
    expect(extractTokenUsage(null)).toBeNull()
    expect(extractTokenUsage({})).toBeNull()
  })

  it('derives totalTokens when missing from prompt+completion', () => {
    const result = extractTokenUsage({ prompt_tokens: 100, completion_tokens: 50 })
    expect(result!.totalTokens).toBe(150)
  })

  it('extractTokenUsageForChunk matches extractTokenUsage semantics', () => {
    const payload = {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      cached_tokens: 50,
    }
    expect(extractTokenUsageForChunk(payload)).toEqual(extractTokenUsage(payload))
  })

  it('parses string numbers defensively', () => {
    const result = extractTokenUsage({
      prompt_tokens: '100',
      completion_tokens: '50',
      total_tokens: '150',
    })
    expect(result).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheSource: 'unavailable',
    })
  })
})
