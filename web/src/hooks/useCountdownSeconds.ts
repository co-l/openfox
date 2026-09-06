import { useEffect, useState } from 'react'

/** Whole seconds remaining before `deadline` (epoch ms), ticking every 250ms. */
export function useCountdownSeconds(deadline: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
