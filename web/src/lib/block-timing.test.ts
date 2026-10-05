import { describe, expect, it } from 'vitest'
import { getMessageEnd, getToolCallEnd, latchMessageEnd, latchToolCallEnd } from './block-timing'

describe('block-timing latches', () => {
  it('latches the message end once; later latches do not move it', () => {
    expect(getMessageEnd('m-1')).toBeUndefined()
    latchMessageEnd('m-1')
    const first = getMessageEnd('m-1')
    expect(first).toBeTypeOf('number')
    latchMessageEnd('m-1')
    expect(getMessageEnd('m-1')).toBe(first)
  })

  it('returns undefined for messages that never ended in this page session', () => {
    expect(getMessageEnd('m-absent')).toBeUndefined()
  })

  it('latches the tool call end by call id', () => {
    expect(getToolCallEnd('tc-1')).toBeUndefined()
    latchToolCallEnd('tc-1')
    expect(getToolCallEnd('tc-1')).toBeTypeOf('number')
    latchToolCallEnd('tc-1')
    expect(getToolCallEnd('tc-1')).toBeTypeOf('number')
  })

  it('evicts the oldest entry once the map cap is reached', () => {
    const MAX = 500
    for (let i = 0; i < MAX + 1; i++) {
      latchMessageEnd(`cap-${i}`)
    }
    expect(getMessageEnd('cap-0')).toBeUndefined()
    expect(getMessageEnd(`cap-${MAX}`)).toBeTypeOf('number')
  })
})
