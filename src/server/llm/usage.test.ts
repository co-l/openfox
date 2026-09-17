import { describe, it, expect } from 'vitest'
import { extractTokenUsage, extractTokenUsageForChunk, markEstimated, markUnavailable } from './usage.js'

describe('extractTokenUsage', () => {
  it('returns null for missing payload', () => {
    expect(extractTokenUsage(undefined)).toBeNull()
    expect(extractTokenUsage(null)).toBeNull()
    expect(extractTokenUsage('not-an-object')).toBeNull()
  })

  it('returns null when no token counts are present', () => {
    expect(extractTokenUsage({})).toBeNull()
    expect(extractTokenUsage({ unrelated: 1 })).toBeNull()
  })

  it('parses basic OpenAI usage', () => {
    const result = extractTokenUsage({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 })
    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheSource: 'unavailable',
    })
    expect(result?.cachedPromptTokens).toBeUndefined()
    expect(result?.cacheWriteTokens).toBeUndefined()
  })

  it('parses OpenAI prompt_tokens_details.cached_tokens', () => {
    const result = extractTokenUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_tokens_details: { cached_tokens: 800 },
    })
    expect(result).not.toBeNull()
    expect(result?.cachedPromptTokens).toBe(800)
    expect(result?.cacheWriteTokens).toBeUndefined()
    expect(result?.cacheSource).toBe('provider')
  })

  it('parses Anthropic-style cache_read_input_tokens', () => {
    const result = extractTokenUsage({
      prompt_tokens: 2000,
      completion_tokens: 200,
      total_tokens: 2200,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 500,
    })
    expect(result).not.toBeNull()
    expect(result?.cachedPromptTokens).toBe(1500)
    expect(result?.cacheWriteTokens).toBe(500)
    expect(result?.cacheSource).toBe('provider')
  })

  it('parses MiniMax-style payload with cached_tokens', () => {
    const result = extractTokenUsage({
      prompt_tokens: 5000,
      completion_tokens: 200,
      total_tokens: 5200,
      cached_tokens: 4500,
    })
    expect(result).not.toBeNull()
    expect(result?.cachedPromptTokens).toBe(4500)
    expect(result?.cacheSource).toBe('provider')
  })

  it('parses prompt_cache_hit_tokens and prompt_cache_miss_tokens', () => {
    const result = extractTokenUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_cache_hit_tokens: 700,
      prompt_cache_miss_tokens: 300,
    })
    expect(result).not.toBeNull()
    expect(result?.cachedPromptTokens).toBe(700)
    expect(result?.cacheWriteTokens).toBe(300)
    expect(result?.cacheSource).toBe('provider')
  })

  it('keeps cacheSource=unavailable when cached_tokens=0', () => {
    const result = extractTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 0 },
    })
    expect(result).not.toBeNull()
    expect(result?.cachedPromptTokens).toBeUndefined()
    expect(result?.cacheSource).toBe('unavailable')
  })

  it('parses vLLM/ollama payload with no cache fields', () => {
    const result = extractTokenUsage({
      prompt_tokens: 4096,
      completion_tokens: 256,
      total_tokens: 4352,
    })
    expect(result).not.toBeNull()
    expect(result?.cacheSource).toBe('unavailable')
    expect(result?.cachedPromptTokens).toBeUndefined()
  })

  it('derives total_tokens when missing from payload', () => {
    const result = extractTokenUsage({ prompt_tokens: 100, completion_tokens: 50 })
    expect(result).not.toBeNull()
    expect(result?.totalTokens).toBe(150)
  })

  it('accepts string numbers defensively', () => {
    const result = extractTokenUsage({
      prompt_tokens: '100',
      completion_tokens: '50',
      total_tokens: '150',
      cache_read_input_tokens: '80',
    })
    expect(result).not.toBeNull()
    expect(result?.promptTokens).toBe(100)
    expect(result?.cachedPromptTokens).toBe(80)
  })

  it('ignores non-finite cached values', () => {
    const result = extractTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: NaN },
    })
    expect(result).not.toBeNull()
    expect(result?.cachedPromptTokens).toBeUndefined()
    expect(result?.cacheSource).toBe('unavailable')
  })
})

describe('extractTokenUsageForChunk', () => {
  it('matches extractTokenUsage semantics on streaming chunk', () => {
    const payload = {
      prompt_tokens: 200,
      completion_tokens: 20,
      total_tokens: 220,
      prompt_tokens_details: { cached_tokens: 180 },
    }
    const direct = extractTokenUsage(payload)
    const chunk = extractTokenUsageForChunk(payload)
    expect(chunk).toEqual(direct)
  })
})

describe('markEstimated / markUnavailable', () => {
  it('markEstimated sets cacheSource to estimated without losing numbers', () => {
    const usage = {
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedPromptTokens: 50,
      cacheSource: 'provider' as const,
    }
    const marked = markEstimated(usage)
    expect(marked.cacheSource).toBe('estimated')
    expect(marked.cachedPromptTokens).toBe(50)
    expect(marked.promptTokens).toBe(100)
  })

  it('markUnavailable clears cacheSource to unavailable', () => {
    const usage = {
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedPromptTokens: 50,
      cacheSource: 'provider' as const,
    }
    const marked = markUnavailable(usage)
    expect(marked.cacheSource).toBe('unavailable')
    expect(marked.cachedPromptTokens).toBeUndefined()
    expect(marked.cacheWriteTokens).toBeUndefined()
  })
})
