import { describe, expect, it, vi } from 'vitest'
import { appendCompactionPrompt, shouldCompact } from './compactor.js'
import type { TurnEvent } from '../events/types.js'

vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn().mockReturnValue({ getEvents: vi.fn().mockReturnValue([]) }),
}))

describe('appendCompactionPrompt', () => {
  it('tags the prompt with the sub-agent when compacting a sub-agent context', () => {
    const events: TurnEvent[] = []
    appendCompactionPrompt('session-1', (e) => events.push(e), {
      subAgentId: 'sub-1',
      subAgentType: 'explorer',
    })

    const start = events.find((e) => e.type === 'message.start')
    expect(start?.data).toMatchObject({ subAgentId: 'sub-1', subAgentType: 'explorer' })
  })

  it('omits the sub-agent tag for top-level compaction', () => {
    const events: TurnEvent[] = []
    appendCompactionPrompt('session-1', (e) => events.push(e))

    const start = events.find((e) => e.type === 'message.start')
    expect(start?.data).not.toHaveProperty('subAgentId')
  })
})

describe('context compactor helpers', () => {
  it('decides when compaction should happen', () => {
    expect(shouldCompact(161_000, 200_000, 0.8)).toBe(true)
    expect(shouldCompact(160_000, 200_000, 0.8)).toBe(false)
    expect(shouldCompact(10_000, 200_000, 0.8)).toBe(false)
  })

  it('disables compaction when threshold is zero', () => {
    expect(shouldCompact(200_000, 200_000, 0)).toBe(false)
  })

  it('honors configured threshold up to the 0.95 cap', () => {
    // 200K model, threshold 0.9: below cap and headroom ceiling → fires at 180K
    expect(shouldCompact(181_000, 200_000, 0.9)).toBe(true)
    expect(shouldCompact(179_000, 200_000, 0.9)).toBe(false)
  })

  it('caps threshold at 0.95 for large models', () => {
    // 500K model, threshold 0.96: clamped to 0.95 → fires at 475K, not 480K
    expect(shouldCompact(476_000, 500_000, 0.96)).toBe(true)
    expect(shouldCompact(474_000, 500_000, 0.96)).toBe(false)
  })

  it('respects configured threshold above the old 0.85 default', () => {
    // 500K model, threshold 0.92: honored as-is → fires at 460K, not 425K
    expect(shouldCompact(461_000, 500_000, 0.92)).toBe(true)
    expect(shouldCompact(459_000, 500_000, 0.92)).toBe(false)
  })

  it('caps threshold for small models to preserve headroom', () => {
    // 8K model: headroom is capped at 30% of the window (2.4K), not the full
    // 15K fixed headroom — otherwise the fixed headroom alone would exceed
    // the whole window. ceiling = (8K - 2.4K) / 8K = 70%
    // At 5.7K tokens with threshold 0.9: clamped to 0.7 → 5.7K > 5.6K → true
    expect(shouldCompact(5_700, 8_000, 0.9)).toBe(true)
    // At 5.5K tokens with threshold 0.9: clamped to 0.7 → 5.5K < 5.6K → false
    expect(shouldCompact(5_500, 8_000, 0.9)).toBe(false)
  })

  it('does not affect normal thresholds below the ceiling', () => {
    // 200K model, threshold 0.5: well below ceiling → normal behavior
    expect(shouldCompact(101_000, 200_000, 0.5)).toBe(true)
    expect(shouldCompact(99_000, 200_000, 0.5)).toBe(false)
  })

  it('pulls the trigger point earlier than the default threshold for a ~80K window', () => {
    // 80128-token window (llama.cpp ctx-size 80000 config), default threshold 0.85:
    // headroom = min(15K, 80128*0.3=24K) = 15K → ceiling = (80128-15000)/80128 ≈ 0.8128
    // effective threshold = min(0.85, 0.8128, 0.95) = 0.8128, below the configured 0.85 —
    // this is what guarantees real output budget for the compaction call itself
    // (see the comment on COMPACTION_HEADROOM_TOKENS).
    expect(shouldCompact(65_200, 80_128, 0.85)).toBe(true)
    expect(shouldCompact(65_000, 80_128, 0.85)).toBe(false)
  })
})
