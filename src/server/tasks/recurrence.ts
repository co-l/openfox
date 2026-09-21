/**
 * Recurrence engine for scheduled tasks.
 *
 * Pure, deterministic computation of the next occurrence of a recurrence rule
 * (a RRULE-lite: FREQ × INTERVAL, a repeat-on selector, and an end condition).
 * Shared by the scheduler (server) — the web client only formats rules, it
 * never computes occurrences. All occurrences keep the local time-of-day of
 * the rule's `startAt`.
 */

export type RecurrenceFreq = 'day' | 'week' | 'month' | 'year'

export type RecurrenceEnd = { kind: 'never' } | { kind: 'until'; until: string } | { kind: 'count'; count: number }

export interface RecurrenceRule {
  freq: RecurrenceFreq
  /** Repeat every X days/weeks/months/years. */
  interval: number
  /** Week freq only: selected weekdays, 0 = Sunday … 6 = Saturday. */
  weekdays?: number[]
  /** Month/year freq: day of month (1..31), clamped to the last day when needed. */
  monthDay?: number
  /** Year freq only: month, 1..12. */
  yearMonth?: number
  /** First occurrence (date + local time-of-day) — the anchor of the rule. */
  startAt: string
  end: RecurrenceEnd
  /** How many occurrences have already been triggered (drives `count`). */
  occurrencesDone: number
}

const MS_DAY = 86_400_000

/** Whole calendar days from `a` to `b` (UTC-based so DST never drifts). */
function dayDiff(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / MS_DAY)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Monday of the week containing `date` (ISO week start). */
function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7))
}

/** Last day of month `m0` (0-based) in year `y`. */
function lastDayOfMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate()
}

/**
 * Next occurrence strictly after `after`, or null when the recurrence ended
 * (count exhausted or next occurrence past `until`).
 */
export function nextOccurrence(after: Date, rule: RecurrenceRule): Date | null {
  const start = new Date(rule.startAt)
  if (Number.isNaN(start.getTime()) || !Number.isFinite(after.getTime())) return null
  if (rule.end.kind === 'count' && rule.occurrencesDone >= rule.end.count) return null

  const hour = start.getHours()
  const minute = start.getMinutes()
  const second = start.getSeconds()
  const ms = start.getMilliseconds()
  const atTime = (y: number, m0: number, d: number): Date => new Date(y, m0, d, hour, minute, second, ms)

  let candidate: Date | null = null

  if (after.getTime() < start.getTime()) {
    candidate = new Date(start)
  } else if (rule.freq === 'day') {
    const k = Math.floor(dayDiff(start, after) / rule.interval)
    let c = addDays(start, k * rule.interval)
    if (c.getTime() <= after.getTime()) c = addDays(c, rule.interval)
    candidate = atTime(c.getFullYear(), c.getMonth(), c.getDate())
  } else if (rule.freq === 'week') {
    const weekdays = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [start.getDay()]
    const baseMonday = mondayOf(start)
    // Worst case: scan until the first selected weekday in an aligned week.
    const maxDays = (rule.interval + 1) * 7 + 7
    for (let i = 1; i <= maxDays; i++) {
      const c = addDays(after, i)
      if (!weekdays.includes(c.getDay())) continue
      const weekIndex = Math.floor(dayDiff(baseMonday, mondayOf(c)) / 7)
      if (weekIndex >= 0 && weekIndex % rule.interval === 0) {
        candidate = atTime(c.getFullYear(), c.getMonth(), c.getDate())
        break
      }
    }
  } else if (rule.freq === 'month') {
    const baseAbs = start.getFullYear() * 12 + start.getMonth()
    const day = rule.monthDay ?? start.getDate()
    const startAbs = after.getFullYear() * 12 + after.getMonth()
    const rem = (((startAbs - baseAbs) % rule.interval) + rule.interval) % rule.interval
    let mAbs = startAbs + (rem === 0 ? 0 : rule.interval - rem)
    for (let i = 0; i <= rule.interval + 1; i++) {
      const y = Math.floor(mAbs / 12)
      const m0 = mAbs % 12
      const c = atTime(y, m0, Math.min(day, lastDayOfMonth(y, m0)))
      if (c.getTime() > after.getTime()) {
        candidate = c
        break
      }
      mAbs += rule.interval
    }
  } else {
    // year
    const baseY = start.getFullYear()
    const m = (rule.yearMonth ?? start.getMonth() + 1) - 1
    const day = rule.monthDay ?? start.getDate()
    const rem = (((after.getFullYear() - baseY) % rule.interval) + rule.interval) % rule.interval
    let y = after.getFullYear() + (rem === 0 ? 0 : rule.interval - rem)
    for (let i = 0; i <= rule.interval + 1; i++) {
      const c = atTime(y, m, Math.min(day, lastDayOfMonth(y, m)))
      if (c.getTime() > after.getTime()) {
        candidate = c
        break
      }
      y += rule.interval
    }
  }

  if (!candidate) return null
  if (rule.end.kind === 'until') {
    const until = new Date(rule.end.until)
    if (Number.isNaN(until.getTime()) || candidate.getTime() > until.getTime()) return null
  }
  return candidate
}
