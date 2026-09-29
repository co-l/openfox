import { useEffect, useState } from 'react'

/** Viewport width below which the layout switches to its mobile regime. */
export const MOBILE_BREAKPOINT = 768

/**
 * Current viewport width, tracked across resizes.
 *
 * Single source of truth for responsive layout: the app shell (sidebar
 * overlays and width pressure) and the split view (tab strip + bottom sheet)
 * both derive their narrow-screen behaviour from here instead of each keeping
 * their own resize listener.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}

/** True while the viewport is narrower than MOBILE_BREAKPOINT. */
export function useIsMobile(): boolean {
  return useViewportWidth() < MOBILE_BREAKPOINT
}
