import { describe, expect, it } from 'vitest'
import { getCompactionTokenThreshold, getMinimumCompactionPercent, normalizeCompactionPercent } from './compaction'

describe('compaction slider helpers', () => {
  it('calculates the minimum percentage from global context tokens', () => {
    expect(getMinimumCompactionPercent(100_000, 10_001)).toBe(11)
    expect(getMinimumCompactionPercent(100_000, 0)).toBe(0)
  })

  it('allows zero or values at and above the minimum', () => {
    expect(normalizeCompactionPercent(0, 10)).toBe(0)
    expect(normalizeCompactionPercent(3, 10)).toBe(0)
    expect(normalizeCompactionPercent(7, 10)).toBe(10)
    expect(normalizeCompactionPercent(25, 10)).toBe(25)
  })

  it('converts percentages to token thresholds', () => {
    expect(getCompactionTokenThreshold(200_000, 85)).toBe(170_000)
  })
})
