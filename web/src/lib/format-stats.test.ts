import { describe, it, expect } from 'vitest'
import { formatTime, formatTokens, formatSpeed } from './format-stats.js'

describe('formatTime', () => {
  it('formats sub-10-second values with one decimal', () => {
    expect(formatTime(0)).toBe('0.0s')
    expect(formatTime(7.8)).toBe('7.8s')
    expect(formatTime(9.9)).toBe('9.9s')
    expect(formatTime(0.123)).toBe('0.1s')
  })

  it('formats 10-59 second values as integers', () => {
    expect(formatTime(10)).toBe('10s')
    expect(formatTime(41)).toBe('41s')
    expect(formatTime(59)).toBe('59s')
  })

  it('formats 60-3599 seconds as minutes and seconds', () => {
    expect(formatTime(60)).toBe('1m 0s')
    expect(formatTime(61)).toBe('1m 1s')
    expect(formatTime(90)).toBe('1m 30s')
    expect(formatTime(1901)).toBe('31m 41s')
    expect(formatTime(3540)).toBe('59m 0s')
    expect(formatTime(3599)).toBe('59m 59s')
  })

  it('formats 3600+ seconds as hours, minutes and seconds', () => {
    expect(formatTime(3600)).toBe('1h 0m 0s')
    expect(formatTime(3661)).toBe('1h 1m 1s')
    expect(formatTime(5742)).toBe('1h 35m 42s')
    expect(formatTime(7200)).toBe('2h 0m 0s')
    expect(formatTime(7325)).toBe('2h 2m 5s')
  })

  it('handles edge cases', () => {
    expect(formatTime(NaN)).toBe('0s')
    expect(formatTime(Infinity)).toBe('0s')
    expect(formatTime(-Infinity)).toBe('0s')
  })

  it('rounds seconds correctly at minute boundaries', () => {
    expect(formatTime(59.5)).toBe('1m 0s')
    expect(formatTime(119.5)).toBe('2m 0s')
    expect(formatTime(3599.5)).toBe('1h 0m 0s')
  })

  it('rounds seconds correctly at hour boundaries', () => {
    expect(formatTime(3599.9)).toBe('1h 0m 0s')
  })
})

describe('formatTokens', () => {
  it('formats tokens with space as thousand separator', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1000)).toBe('1 000')
    expect(formatTokens(125000)).toBe('125 000')
    expect(formatTokens(1000000)).toBe('1 000 000')
  })
})

describe('formatSpeed', () => {
  it('formats speed with k suffix for large values', () => {
    expect(formatSpeed(0)).toBe('0.0')
    expect(formatSpeed(10)).toBe('10.0')
    expect(formatSpeed(999)).toBe('999.0')
    expect(formatSpeed(1000)).toBe('1.0k')
    expect(formatSpeed(1500)).toBe('1.5k')
    expect(formatSpeed(1234567)).toBe('1234.6k')
  })

  it('handles non-finite values', () => {
    expect(formatSpeed(NaN)).toBe('0')
    expect(formatSpeed(Infinity)).toBe('0')
    expect(formatSpeed(-Infinity)).toBe('0')
  })
})
