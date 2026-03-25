import { describe, it, expect } from 'vitest'
import { formatDateHeader, formatTime, extractDateKey, groupSessionsByDate } from './format-date.js'
import type { SessionSummary } from '@shared/types.js'

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
    createdAt: updatedAt,
    updatedAt,
    criteriaCount: 0,
    criteriaCompleted: 0,
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
