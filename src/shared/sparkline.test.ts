import { describe, expect, it } from 'vitest'
import { buildSparklineChart } from './sparkline.js'

describe('buildSparklineChart', () => {
  it('spreads sparse points across the full chart width', () => {
    const chart = buildSparklineChart([
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 3, y: 30 },
    ], 9)

    expect(chart.blocks).toHaveLength(9)
    expect(chart.blocks[0]).not.toBe(' ')
    expect(chart.blocks[4]).not.toBe(' ')
    expect(chart.blocks[8]).not.toBe(' ')
  })

  it('pads tiny y-ranges so min and max labels stay readable', () => {
    const chart = buildSparklineChart([
      { x: 1, y: 30.9 },
      { x: 2, y: 31.0 },
      { x: 3, y: 31.1 },
    ], 9)

    expect(chart.minY).toBeLessThan(30.9)
    expect(chart.maxY).toBeGreaterThan(31.1)
    expect(chart.blocks.trim().length).toBeGreaterThan(0)
  })
})
