// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  formatDateHeader,
  formatTime,
  formatTimeSince,
  formatDateTime,
  formatRelativeDate,
  extractDateKey,
  groupSessionsByDate,
} from './format-date.js'
import { setLocale } from '@shared/i18n/index.js'
import type { SessionSummary } from '@shared/types.js'

beforeEach(() => {
  setLocale('en')
})

describe('formatDateHeader', () => {
  it('formats date to "Dayname YYYY/MM/DD" format', () => {
    const result = formatDateHeader('2024-01-15T14:30:00Z')
    expect(result).toBe('Monday 2024/01/15')
  })

  it('handles all days of the week', () => {
    expect(formatDateHeader('2024-01-14T00:00:00Z')).toBe('Sunday 2024/01/14')
    expect(formatDateHeader('2024-01-15T00:00:00Z')).toBe('Monday 2024/01/15')
    expect(formatDateHeader('2024-01-16T00:00:00Z')).toBe('Tuesday 2024/01/16')
    expect(formatDateHeader('2024-01-17T00:00:00Z')).toBe('Wednesday 2024/01/17')
    expect(formatDateHeader('2024-01-18T00:00:00Z')).toBe('Thursday 2024/01/18')
    expect(formatDateHeader('2024-01-19T00:00:00Z')).toBe('Friday 2024/01/19')
    expect(formatDateHeader('2024-01-20T00:00:00Z')).toBe('Saturday 2024/01/20')
  })

  it('pads month and day with leading zeros', () => {
    expect(formatDateHeader('2024-01-05T00:00:00Z')).toBe('Friday 2024/01/05')
    expect(formatDateHeader('2024-05-01T00:00:00Z')).toBe('Wednesday 2024/05/01')
  })

  it('uses French weekday names in fr locale', () => {
    setLocale('fr')
    expect(formatDateHeader('2024-01-15T14:30:00Z')).toBe('lundi 2024/01/15')
    expect(formatDateHeader('2024-01-14T00:00:00Z')).toBe('dimanche 2024/01/14')
  })
})

describe('formatTime', () => {
  it('formats time to "HH:MM" 24-hour format', () => {
    // Use local time timestamps (without Z suffix)
    expect(formatTime('2024-01-15T14:30:00')).toBe('14:30')
    expect(formatTime('2024-01-15T09:15:00')).toBe('09:15')
    expect(formatTime('2024-01-15T00:05:00')).toBe('00:05')
    expect(formatTime('2024-01-15T23:59:00')).toBe('23:59')
  })

  it('pads hours and minutes with leading zeros', () => {
    expect(formatTime('2024-01-15T01:02:00')).toBe('01:02')
    expect(formatTime('2024-01-15T00:00:00')).toBe('00:00')
  })
})

describe('formatTimeSince', () => {
  const NOW = new Date('2024-01-15T12:00:00').getTime()

  it('formats the elapsed time since the given ISO timestamp', () => {
    expect(formatTimeSince('2024-01-15T11:59:57', NOW)).toBe('3s')
    expect(formatTimeSince('2024-01-15T11:59:15', NOW)).toBe('45s')
    expect(formatTimeSince('2024-01-15T11:58:00', NOW)).toBe('2m 0s')
    expect(formatTimeSince('2024-01-15T10:48:00', NOW)).toBe('1h 12m 0s')
  })

  it('returns an empty string for invalid timestamps', () => {
    expect(formatTimeSince('not-a-date', NOW)).toBe('')
  })

  it('never goes negative for timestamps in the future', () => {
    expect(formatTimeSince('2024-01-15T12:05:00', NOW)).toBe('0s')
  })
})

describe('formatDateTime', () => {
  it('formats to "YYYY/MM/DD HH:MM" 24-hour format', () => {
    // Use local time timestamps (without Z suffix)
    expect(formatDateTime('2026-08-16T14:44:00')).toBe('2026/08/16 14:44')
    expect(formatDateTime('2026-01-05T09:05:00')).toBe('2026/01/05 09:05')
    expect(formatDateTime('2026-12-31T23:59:00')).toBe('2026/12/31 23:59')
  })

  it('pads month, day, hours and minutes with leading zeros', () => {
    expect(formatDateTime('2026-01-05T00:00:00')).toBe('2026/01/05 00:00')
    expect(formatDateTime('2026-05-01T01:02:00')).toBe('2026/05/01 01:02')
  })

  it('never uses 12-hour AM/PM formatting', () => {
    expect(formatDateTime('2026-08-16T14:44:00')).not.toMatch(/(AM|PM|am|pm)/)
    expect(formatDateTime('2026-08-16T00:30:00')).not.toMatch(/(AM|PM|am|pm)/)
  })
})

describe('formatRelativeDate', () => {
  const NOW = new Date('2024-01-15T12:00:00').getTime()

  const at = (daysOffset: number, hour = 10) =>
    new Date(new Date(NOW).setDate(new Date(NOW).getDate() + daysOffset)).toISOString().slice(0, 11) +
    `${String(hour).padStart(2, '0')}:00:00`

  it('renders today with the time in en', () => {
    expect(formatRelativeDate(at(0), NOW)).toBe('today 10:00')
  })

  it('renders yesterday with the time in en', () => {
    expect(formatRelativeDate(at(-1), NOW)).toBe('yesterday 10:00')
  })

  it('renders days ago in en', () => {
    expect(formatRelativeDate(at(-3), NOW)).toBe('3 days ago 10:00')
  })

  it('renders older dates as YYYY/MM/DD HH:MM in en', () => {
    expect(formatRelativeDate('2023-01-01T10:00:00', NOW)).toBe('2023/01/01 10:00')
  })

  it('renders relative labels in fr', () => {
    setLocale('fr')
    expect(formatRelativeDate(at(0), NOW)).toBe("aujourd'hui 10:00")
    expect(formatRelativeDate(at(-1), NOW)).toBe('hier 10:00')
    expect(formatRelativeDate(at(-3), NOW)).toBe('il y a 3 jours à 10:00')
  })
})

describe('extractDateKey', () => {
  it('extracts YYYY-MM-DD from ISO timestamp', () => {
    expect(extractDateKey('2024-01-15T14:30:00')).toBe('2024-01-15')
    expect(extractDateKey('2024-01-15T00:00:00')).toBe('2024-01-15')
    expect(extractDateKey('2024-12-31T23:59:59')).toBe('2024-12-31')
  })

  it('pads month and day with leading zeros', () => {
    expect(extractDateKey('2024-01-05T00:00:00')).toBe('2024-01-05')
    expect(extractDateKey('2024-05-01T00:00:00')).toBe('2024-05-01')
  })
})

describe('groupSessionsByDate', () => {
  const createSession = (id: string, updatedAt: string): SessionSummary => ({
    id,
    projectId: 'proj-1',
    workdir: '/home/user/project',
    mode: 'planner',
    phase: 'done',
    isRunning: false,
    isFavorite: false,
    createdAt: updatedAt,
    updatedAt,
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  })

  it('groups sessions by date', () => {
    const sessions = [
      createSession('1', '2024-01-15T14:30:00Z'),
      createSession('2', '2024-01-15T09:15:00Z'),
      createSession('3', '2024-01-16T16:45:00Z'),
    ]

    const groups = groupSessionsByDate(sessions)

    expect(groups.size).toBe(2)
    expect(groups.has('2024-01-15')).toBe(true)
    expect(groups.has('2024-01-16')).toBe(true)
  })

  it('sorts date groups newest first', () => {
    const sessions = [
      createSession('1', '2024-01-15T14:30:00Z'),
      createSession('2', '2024-01-16T16:45:00Z'),
      createSession('3', '2024-01-14T10:00:00Z'),
    ]

    const groups = groupSessionsByDate(sessions)
    const keys = Array.from(groups.keys())

    expect(keys).toEqual(['2024-01-16', '2024-01-15', '2024-01-14'])
  })

  it('sorts sessions within each group latest to earliest', () => {
    const sessions = [
      createSession('1', '2024-01-15T14:30:00Z'),
      createSession('2', '2024-01-15T09:15:00Z'),
      createSession('3', '2024-01-15T18:00:00Z'),
    ]

    const groups = groupSessionsByDate(sessions)
    const daySessions = groups.get('2024-01-15')!

    expect(daySessions[0]?.id).toBe('3') // 18:00 (latest)
    expect(daySessions[1]?.id).toBe('1') // 14:30
    expect(daySessions[2]?.id).toBe('2') // 09:15 (earliest)
  })

  it('handles empty session list', () => {
    const groups = groupSessionsByDate([])
    expect(groups.size).toBe(0)
  })

  it('handles single session', () => {
    const sessions = [createSession('1', '2024-01-15T14:30:00Z')]
    const groups = groupSessionsByDate(sessions)

    expect(groups.size).toBe(1)
    expect(groups.has('2024-01-15')).toBe(true)
    expect(groups.get('2024-01-15')?.length).toBe(1)
  })
})
