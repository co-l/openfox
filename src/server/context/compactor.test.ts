import { describe, expect, it } from 'vitest'
import { shouldCompact } from './compactor.js'

describe('context compactor helpers', () => {
  it('decides when compaction should happen', () => {
    expect(shouldCompact(161_000, 200_000, 0.8)).toBe(true)
    expect(shouldCompact(160_000, 200_000, 0.8)).toBe(false)
    expect(shouldCompact(10_000, 200_000, 0.8)).toBe(false)
  })
})
