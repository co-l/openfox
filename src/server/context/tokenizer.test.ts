import { describe, expect, it } from 'vitest'
import {
  DANGER_ZONE_THRESHOLD,
  MANUAL_COMPACT_TARGET,
  MIN_COMPACT_THRESHOLD_RATIO,
  calculateContextTokens,
  canCompact,
  estimateMessagesTokens,
  estimateTokens,
  isInDangerZone,
} from './tokenizer.js'

describe('tokenizer helpers', () => {
  it('estimates text and message token counts', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('1234')).toBe(1)
    expect(estimateTokens('12345')).toBe(2)

    expect(estimateMessagesTokens([
      { content: '1234' },
      { content: '12345678' },
    ])).toBe(11)
  })

  it('calculates context tokens including thinking, tool calls, and tool output', () => {
    expect(calculateContextTokens([
      {
        id: 'm1',
        role: 'assistant',
        content: 'hello',
        thinkingContent: 'plan',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
        toolResult: { success: true, output: 'file contents', durationMs: 1, truncated: false },
        timestamp: '2024-01-01T00:00:00.000Z',
        tokenCount: 0,
      },
      {
        id: 'm2',
        role: 'user',
        content: 'follow up',
        timestamp: '2024-01-01T00:00:01.000Z',
        tokenCount: 0,
      },
    ])).toBeGreaterThan(20)
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
})
