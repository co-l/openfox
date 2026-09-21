import { describe, expect, it } from 'vitest'
import { nextOccurrence, type RecurrenceRule } from './recurrence.js'

/** Local-time constructor so tests are timezone-consistent within one process. */
const at = (y: number, mo: number, d: number, h = 9, min = 30) => new Date(y, mo - 1, d, h, min, 0, 0)

function rule(partial: Partial<RecurrenceRule> & { freq: RecurrenceRule['freq']; startAt: string }): RecurrenceRule {
  return {
    interval: 1,
    end: { kind: 'never' },
    occurrencesDone: 0,
    ...partial,
  }
}

const iso = (d: Date) => d.toISOString()

describe('nextOccurrence', () => {
  describe('daily', () => {
    const start = '2026-09-09T14:30:00' // Wednesday

    it('returns the day after a past `after`', () => {
      const next = nextOccurrence(at(2026, 9, 10), rule({ freq: 'day', startAt: start }))!
      expect(iso(next)).toBe(at(2026, 9, 11, 14, 30).toISOString())
    })

    it('is strictly after `after` even when `after` is the occurrence time', () => {
      const next = nextOccurrence(at(2026, 9, 9, 14, 30), rule({ freq: 'day', startAt: start }))!
      expect(iso(next)).toBe(at(2026, 9, 10, 14, 30).toISOString())
    })

    it('steps by the interval', () => {
      const r = rule({ freq: 'day', interval: 2, startAt: start })
      expect(iso(nextOccurrence(at(2026, 9, 10), r)!)).toBe(at(2026, 9, 11, 14, 30).toISOString())
      expect(iso(nextOccurrence(at(2026, 9, 13), r)!)).toBe(at(2026, 9, 15, 14, 30).toISOString())
    })

    it('returns the start when `after` precedes it', () => {
      const next = nextOccurrence(at(2026, 9, 1), rule({ freq: 'day', startAt: start }))!
      expect(iso(next)).toBe(at(2026, 9, 9, 14, 30).toISOString())
    })
  })

  describe('weekly', () => {
    // Thursday 2026-09-10 09:30, repeat on Monday (1) + Thursday (4)
    const start = '2026-09-10T09:30:00'
    const r = () => rule({ freq: 'week', startAt: start, weekdays: [1, 4] })

    it('moves to the next selected weekday', () => {
      expect(iso(nextOccurrence(at(2026, 9, 10, 9, 30), r())!)).toBe(at(2026, 9, 14, 9, 30).toISOString())
      expect(iso(nextOccurrence(at(2026, 9, 14), r())!)).toBe(at(2026, 9, 17, 9, 30).toISOString())
    })

    it('skips whole weeks outside the interval (anchored to the start week)', () => {
      const biweekly = rule({ freq: 'week', interval: 2, startAt: '2026-09-07T09:30:00', weekdays: [1] })
      // 09-07 is Monday week 0 → next is 09-21 (week 2), NOT 09-14 (week 1)
      expect(iso(nextOccurrence(at(2026, 9, 8), biweekly)!)).toBe(at(2026, 9, 21, 9, 30).toISOString())
      expect(iso(nextOccurrence(at(2026, 9, 21), biweekly)!)).toBe(at(2026, 10, 5, 9, 30).toISOString())
    })
  })

  describe('monthly', () => {
    it('clamps day 31 to the last day of short months', () => {
      const r = rule({ freq: 'month', startAt: '2026-01-31T10:00:00', monthDay: 31 })
      expect(iso(nextOccurrence(at(2026, 1, 31, 10, 0), r)!)).toBe(at(2026, 2, 28, 10, 0).toISOString())
      expect(iso(nextOccurrence(at(2026, 2, 28, 10, 0), r)!)).toBe(at(2026, 3, 31, 10, 0).toISOString())
    })

    it('advances by interval months', () => {
      const r = rule({ freq: 'month', interval: 3, startAt: '2026-01-15T10:00:00', monthDay: 15 })
      expect(iso(nextOccurrence(at(2026, 1, 15, 10, 0), r)!)).toBe(at(2026, 4, 15, 10, 0).toISOString())
      expect(iso(nextOccurrence(at(2026, 5, 1, 10, 0), r)!)).toBe(at(2026, 7, 15, 10, 0).toISOString())
    })
  })

  describe('yearly', () => {
    it('clamps Feb 29 to Feb 28 on non-leap years', () => {
      const r = rule({ freq: 'year', startAt: '2024-02-29T08:00:00', yearMonth: 2, monthDay: 29 })
      expect(iso(nextOccurrence(at(2024, 2, 29), r)!)).toBe(at(2025, 2, 28, 8, 0).toISOString())
      expect(iso(nextOccurrence(at(2025, 2, 28), r)!)).toBe(at(2026, 2, 28, 8, 0).toISOString())
    })

    it('advances by interval years on the selected month and day', () => {
      const r = rule({ freq: 'year', interval: 2, startAt: '2026-09-09T09:30:00', yearMonth: 9, monthDay: 9 })
      expect(iso(nextOccurrence(at(2026, 9, 9), r)!)).toBe(at(2028, 9, 9, 9, 30).toISOString())
    })
  })

  describe('end conditions', () => {
    it('returns null once the count of occurrences is exhausted', () => {
      const r = rule({
        freq: 'day',
        startAt: '2026-09-09T09:00:00',
        end: { kind: 'count', count: 3 },
        occurrencesDone: 2,
      })
      expect(nextOccurrence(at(2026, 9, 9), r)).not.toBeNull()
      const exhausted = rule({
        freq: 'day',
        startAt: '2026-09-09T09:00:00',
        end: { kind: 'count', count: 3 },
        occurrencesDone: 3,
      })
      expect(nextOccurrence(at(2026, 9, 9), exhausted)).toBeNull()
    })

    it('returns null past the until date', () => {
      const r = rule({
        freq: 'day',
        startAt: '2026-09-09T09:00:00',
        end: { kind: 'until', until: '2026-09-20T09:00:00' },
      })
      expect(iso(nextOccurrence(at(2026, 9, 19), r)!)).toBe(at(2026, 9, 20, 9, 0).toISOString())
      expect(nextOccurrence(at(2026, 9, 20), r)).toBeNull()
    })
  })
})
