import { afterEach, describe, expect, it, vi } from 'vitest'
import { getThinkingEnd, getThinkingStart, latchThinkingEnd, latchThinkingStart } from './thinking-timing'

describe('thinking-timing end latch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('getThinkingEnd is undefined until the end is latched', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    expect(getThinkingEnd('m-no-end')).toBeUndefined()
    latchThinkingStart('m-no-end')
    expect(getThinkingEnd('m-no-end')).toBeUndefined()

    vi.setSystemTime(1_060_000)
    expect(latchThinkingEnd('m-no-end')).toBe(60)
    expect(getThinkingEnd('m-no-end')).toBe(1_060_000)
  })

  it('getThinkingEnd keeps the first latched end across re-reads', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    latchThinkingStart('m-stable')

    vi.setSystemTime(1_050_000)
    latchThinkingEnd('m-stable')
    expect(getThinkingEnd('m-stable')).toBe(1_050_000)

    vi.setSystemTime(1_090_000)
    latchThinkingEnd('m-stable')
    expect(getThinkingEnd('m-stable')).toBe(1_050_000)
  })

  it('getThinkingEnd is undefined for a message that never thought', () => {
    expect(getThinkingEnd('m-never')).toBeUndefined()
  })

  it('evicts the oldest start entry once the map cap is reached', () => {
    const MAX = 500
    for (let i = 0; i < MAX + 1; i++) {
      latchThinkingStart(`cap-${i}`)
    }
    expect(getThinkingStart(`cap-0`)).toBeUndefined()
    expect(getThinkingStart(`cap-${MAX}`)).toBeTypeOf('number')
  })
})
