// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskScheduleBadge } from './TaskScheduleBadge'
import type { TaskSchedule } from '@shared/types.js'

describe('TaskScheduleBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the countdown for a one-off schedule', () => {
    const schedule: TaskSchedule = { type: 'once', runAt: '2026-09-09T12:30:00' }
    render(<TaskScheduleBadge schedule={schedule} />)
    expect(screen.getByText('in 2h 30m')).toBeTruthy()
  })

  it('shows "now" when the trigger time passed', () => {
    const schedule: TaskSchedule = { type: 'once', runAt: '2026-09-09T09:00:00' }
    render(<TaskScheduleBadge schedule={schedule} />)
    expect(screen.getByText('now')).toBeTruthy()
  })

  it('describes a weekly recurrence with selected weekdays', () => {
    const schedule: TaskSchedule = {
      type: 'recurring',
      freq: 'week',
      interval: 2,
      weekdays: [1, 4],
      startAt: '2026-09-09T09:00:00',
      end: { kind: 'never' },
      occurrencesDone: 0,
      nextRunAt: '2026-09-14T09:00:00',
    }
    render(<TaskScheduleBadge schedule={schedule} />)
    expect(screen.getByText(/every 2 weeks · .*Mon.*Thu/i)).toBeTruthy()
  })

  it('describes a monthly recurrence on a fixed day', () => {
    const schedule: TaskSchedule = {
      type: 'recurring',
      freq: 'month',
      interval: 3,
      monthDay: 15,
      startAt: '2026-09-09T09:00:00',
      end: { kind: 'count', count: 5 },
      occurrencesDone: 0,
      nextRunAt: '2026-12-15T09:00:00',
    }
    render(<TaskScheduleBadge schedule={schedule} />)
    expect(screen.getByText(/every 3 months · day 15/i)).toBeTruthy()
  })
})
