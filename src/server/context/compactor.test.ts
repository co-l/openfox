import { describe, expect, it } from 'vitest'
import {
  estimateCompactionFloor,
  estimateMinimumCompactionTokens,
  getEffectiveCompactionThreshold,
  getMinimumCompactionThreshold,
  shouldCompact,
} from './compactor.js'

describe('context compactor helpers', () => {
  it('decides when compaction should happen', () => {
    expect(shouldCompact(161_000, 200_000, 0.8)).toBe(true)
    expect(shouldCompact(160_000, 200_000, 0.8)).toBe(false)
    expect(shouldCompact(10_000, 200_000, 0.8)).toBe(false)
  })

  it('disables automatic compaction when threshold is zero', () => {
    expect(shouldCompact(200_000, 200_000, 0, 50_000)).toBe(false)
  })

  it('does not compact below the non-compressible context floor', () => {
    expect(getMinimumCompactionThreshold(100_000, 10_000)).toBe(0.1)
    expect(getEffectiveCompactionThreshold(0.05, 100_000, 10_000)).toBe(0.1)
    expect(shouldCompact(7_000, 100_000, 0.05, 10_000)).toBe(false)
    expect(shouldCompact(11_000, 100_000, 0.05, 10_000)).toBe(true)
  })

  it('estimates static context from the system prompt and tools', () => {
    expect(estimateMinimumCompactionTokens('12345678', [])).toBe(2)
    expect(estimateMinimumCompactionTokens('', [{ name: 'tool' }])).toBeGreaterThan(0)
  })

  it('breaks the incompressible floor into visual segments', () => {
    const floor = estimateCompactionFloor({
      promptParts: {
        system: 'x'.repeat(400),
        instructions: 'i'.repeat(40),
        skills: 's'.repeat(20),
        subagents: 'a'.repeat(16),
      },
      tools: [
        { type: 'function', function: { name: 'shell', description: 'Run', parameters: {} } },
        { type: 'function', function: { name: 'gate_search', description: 'Search', parameters: {} } },
      ],
      mcpToolNames: new Set(['gate_search']),
    })

    expect(floor.totalTokens).toBeGreaterThan(0)
    expect(floor.segments.map((segment) => segment.key)).toEqual(
      expect.arrayContaining(['system', 'instructions', 'skills', 'tools', 'mcp']),
    )
    expect(floor.totalTokens).toBe(floor.segments.reduce((sum, segment) => sum + segment.tokens, 0))
  })
})
