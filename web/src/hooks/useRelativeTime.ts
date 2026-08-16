import { useEffect, useState } from 'react'

const RELATIVE_TIME_REFRESH_MS = 60_000

export function formatRelativeTime(timestamp: string, now: number = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000))
  if (elapsedSeconds < 60) return 'just now'
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function useRelativeTimeNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), RELATIVE_TIME_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [enabled])

  return now
}
