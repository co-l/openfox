import { describe, expect, it } from 'vitest'
import { shouldCompact } from './compactor.js'

describe('context compactor helpers', () => {
  it('decides when compaction should happen', () => {
    expect(shouldCompact(161_000, 200_000, 0.8)).toBe(true)
    expect(shouldCompact(160_000, 200_000, 0.8)).toBe(false)
    expect(shouldCompact(10_000, 200_000, 0.8)).toBe(false)
  })

  it('disables compaction when threshold is zero', () => {
    expect(shouldCompact(200_000, 200_000, 0)).toBe(false)
  })

  it('guarantees headroom: compacts when fewer than 5K tokens remain', () => {
    // For a 200K model: ceiling = min(195K, 170K) = 170K → 85%
    // At 196K tokens with threshold 0.9: clamped to 0.85 → 196K > 170K → true
    expect(shouldCompact(196_000, 200_000, 0.9)).toBe(true)
    // At 169K tokens with threshold 0.9: clamped to 0.85 → 169K < 170K → false
    expect(shouldCompact(169_000, 200_000, 0.9)).toBe(false)
  })

  it('caps threshold for small models to preserve headroom', () => {
    // 8K model: ceiling = min(3K, 6.8K) = 3K → 37.5%
    // At 3.5K tokens with threshold 0.9: clamped to 0.375 → 3.5K > 3K → true
    expect(shouldCompact(3_500, 8_000, 0.9)).toBe(true)
    // At 2.5K tokens with threshold 0.9: clamped to 0.375 → 2.5K < 3K → false
    expect(shouldCompact(2_500, 8_000, 0.9)).toBe(false)
  })

  it('does not affect normal thresholds below the ceiling', () => {
    // 200K model, threshold 0.5: well below ceiling → normal behavior
    expect(shouldCompact(101_000, 200_000, 0.5)).toBe(true)
    expect(shouldCompact(99_000, 200_000, 0.5)).toBe(false)
  })
})
