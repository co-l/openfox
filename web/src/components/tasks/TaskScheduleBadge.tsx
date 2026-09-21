import { useEffect, useState } from 'react'
import { type Translation } from '@shared/i18n/index.js'
import type { TaskSchedule } from '@shared/types.js'
import { useT } from '../../hooks/useT'
import { formatCountdown, weekdayLabel, monthLabel } from '../../lib/schedule-format'
import { ClockIcon } from '../shared/icons'

interface TaskScheduleBadgeProps {
  schedule: TaskSchedule
}

/** Compact human description of a recurring rule, e.g. "every 2 weeks · Mon, Thu". */
function recurrenceLabel(
  schedule: Extract<TaskSchedule, { type: 'recurring' }>,
  t: (tx: Translation, vars?: Record<string, string | number>) => string,
): string {
  const n = schedule.interval
  let cadence: string
  if (schedule.freq === 'day') {
    cadence =
      n === 1
        ? t({ en: 'every day', fr: 'tous les jours' })
        : t({ en: 'every {{count}} days', fr: 'tous les {{count}} jours' }, { count: n })
  } else if (schedule.freq === 'week') {
    cadence =
      n === 1
        ? t({ en: 'every week', fr: 'chaque semaine' })
        : t({ en: 'every {{count}} weeks', fr: 'toutes les {{count}} semaines' }, { count: n })
  } else if (schedule.freq === 'month') {
    cadence =
      n === 1
        ? t({ en: 'every month', fr: 'chaque mois' })
        : t({ en: 'every {{count}} months', fr: 'tous les {{count}} mois' }, { count: n })
  } else {
    cadence =
      n === 1
        ? t({ en: 'every year', fr: 'chaque année' })
        : t({ en: 'every {{count}} years', fr: 'toutes les {{count}} années' }, { count: n })
  }

  const days =
    schedule.freq === 'week' && schedule.weekdays && schedule.weekdays.length > 0
      ? schedule.weekdays
          .slice()
          .sort((a, b) => a - b)
          .map((wd) => weekdayLabel(wd))
          .join(', ')
      : undefined
  if (days) return `${cadence} · ${days}`

  if (schedule.freq === 'month' && schedule.monthDay) {
    return `${cadence} · ${t({ en: 'day {{count}}', fr: 'jour {{count}}' }, { count: schedule.monthDay })}`
  }
  if (schedule.freq === 'year' && schedule.yearMonth && schedule.monthDay) {
    return `${cadence} · ${monthLabel(schedule.yearMonth)} ${schedule.monthDay}`
  }
  return cadence
}

/**
 * Live clock badge for a planned task: clock icon, the recurrence description
 * when applicable, and a countdown to the next trigger (refreshed ~30s).
 */
export function TaskScheduleBadge({ schedule }: TaskScheduleBadgeProps) {
  const t = useT()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const nextRunAt = schedule.type === 'once' ? schedule.runAt : schedule.nextRunAt
  const remainingMs = new Date(nextRunAt).getTime() - Date.now()
  const countdown =
    remainingMs <= 0
      ? t({ en: 'now', fr: 'maintenant' })
      : t({ en: 'in {{countdown}}', fr: 'dans {{countdown}}' }, { countdown: formatCountdown(remainingMs) })
  const recurring = schedule.type === 'recurring' ? recurrenceLabel(schedule, t) : undefined

  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-text-muted"
      title={t({
        en: 'Planned task — triggers automatically',
        fr: 'Tâche planifiée — se déclenche automatiquement',
      })}
    >
      <ClockIcon className="w-3 h-3 text-accent-primary" />
      {recurring && <span>{recurring}</span>}
      <span className="tabular-nums">{countdown}</span>
    </span>
  )
}
