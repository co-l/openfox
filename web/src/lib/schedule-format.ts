import { getLocale } from '@shared/i18n/index.js'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** ISO → local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function fromLocalInput(value: string): string {
  return value ? new Date(value).toISOString() : ''
}

/** Locale-aware short weekday label for a Date.getDay() value. */
export function weekdayLabel(getDay: number): string {
  const anchor = getDay === 0 ? new Date(2024, 0, 7) : new Date(2024, 0, getDay)
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(anchor)
}

/** Locale-aware long month label for a 1-based month. */
export function monthLabel(month: number): string {
  return new Intl.DateTimeFormat(getLocale(), { month: 'long' }).format(new Date(2026, month - 1, 1))
}

/** Human countdown like "2h 5m" / "3d 4h" / "45s" from a remaining duration. */
export function formatCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.floor(ms / 1000))
  if (totalSecs < 60) return `${totalSecs}s`
  if (totalSecs < 3600) return `${Math.floor(totalSecs / 60)}m`
  if (totalSecs < 86_400) return `${Math.floor(totalSecs / 3600)}h ${Math.floor((totalSecs % 3600) / 60)}m`
  return `${Math.floor(totalSecs / 86_400)}d ${Math.floor((totalSecs % 86_400) / 3600)}h`
}
