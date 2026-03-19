import { describe, expect, it } from 'vitest'
import { getCompactionTarget, shouldCompact } from './compactor.js'

describe('context compactor helpers', () => {
  it('decides when compaction should happen', () => {
    expect(shouldCompact(161_000, 200_000, 0.8)).toBe(true)
    expect(shouldCompact(160_000, 200_000, 0.8)).toBe(false)
    expect(shouldCompact(10_000, 200_000, 0.8)).toBe(false)
  })

  it('calculates the compaction target from the max token ratio', () => {
    expect(getCompactionTarget(200_000, 0.5)).toBe(100_000)
    expect(getCompactionTarget(199_999, 0.33)).toBe(Math.floor(199_999 * 0.33))
  })
})
