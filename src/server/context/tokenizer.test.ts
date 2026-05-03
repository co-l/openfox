import { describe, expect, it } from 'vitest'
import {
  DANGER_ZONE_THRESHOLD,
  MANUAL_COMPACT_TARGET,
  MIN_COMPACT_THRESHOLD_RATIO,
  canCompact,
  estimateTokens,
  estimateContextSize,
  isInDangerZone,
} from './tokenizer.js'

describe('tokenizer helpers', () => {
  it('estimates text token count for pre-flight checks', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('1234')).toBe(1)
    expect(estimateTokens('12345')).toBe(2)
    expect(estimateTokens('hello world')).toBe(3) // 11 chars / 4 = 2.75 -> 3
  })

  it('identifies danger zone and compaction thresholds', () => {
    expect(DANGER_ZONE_THRESHOLD).toBe(20000)
    expect(MIN_COMPACT_THRESHOLD_RATIO).toBe(0.2)
    expect(MANUAL_COMPACT_TARGET).toBe(20000)
    expect(isInDangerZone(181000, 200000)).toBe(true)
    expect(isInDangerZone(180000, 200000)).toBe(false)
    expect(canCompact(50000, 200000)).toBe(true)
    expect(canCompact(40000, 200000)).toBe(false)
  })

  it('estimates context size for pre-flight checks', () => {
    const systemPrompt = 'x'.repeat(4000) // ~1000 tokens
    const messages = [
      { role: 'user', content: 'x'.repeat(4000) }, // ~1000 tokens + 4 overhead
      { role: 'assistant', content: 'x'.repeat(8000) }, // ~2000 tokens + 4 overhead
    ]

    // With maxTokens = 10000, expect ~4008 tokens = 40%
    const result = estimateContextSize(systemPrompt, messages, 10000)
    expect(result.estimatedTokens).toBeGreaterThan(4000)
    expect(result.estimatedTokens).toBeLessThan(4100)
    expect(result.percentUsed).toBe(40) // ~40%
    expect(result.isNearLimit).toBe(false)
    expect(result.isOverLimit).toBe(false)

    // With maxTokens = 5000, expect ~4008 tokens = 80%
    const nearLimit = estimateContextSize(systemPrompt, messages, 5000)
    expect(nearLimit.percentUsed).toBe(80)
    expect(nearLimit.isNearLimit).toBe(false) // 80% is not > 80%

    // With maxTokens = 4800, expect > 80%
    const overThreshold = estimateContextSize(systemPrompt, messages, 4800)
    expect(overThreshold.isNearLimit).toBe(true)
    expect(overThreshold.isOverLimit).toBe(false)

    // With maxTokens = 3000, expect > 100%
    const overLimit = estimateContextSize(systemPrompt, messages, 3000)
    expect(overLimit.isOverLimit).toBe(true)
  })
})
