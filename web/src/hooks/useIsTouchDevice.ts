import { useState, useEffect } from 'react'

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(TOUCH_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(TOUCH_QUERY)
    if (typeof mql.addEventListener !== 'function') return
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isTouch
}
