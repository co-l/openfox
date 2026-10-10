import { useEffect, useRef, useState, useCallback } from 'react'
import { Session } from '@shared/types.ts'

export type ScrollbarGestureKind = 'down' | 'move' | 'up'

const WHEEL_REENABLE_PX = 100
export const DRAG_MAGNET_GAP_PX = 6
const FOLLOW_GUARD_MS = 1500

export const scrollbarGestureToEnable = (kind: ScrollbarGestureKind, gapToEndPx: number | null): boolean => {
  if (kind === 'down') return false
  return gapToEndPx !== null && gapToEndPx <= DRAG_MAGNET_GAP_PX
}

export const useAutoScroll = (
  container_ref: { current: unknown },
  session: Session | null,
  getScroller?: () => HTMLElement | null,
) => {
  const is_active = useRef(true)
  const startY = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const lastFollowRef = useRef(0)
  const programmaticRef = useRef(false)
  // Every transition to inactive increments this epoch. Deferred near-bottom
  // re-enable checks capture it when scheduled and abort if it changed by the
  // time they run, so a stale check can never resurrect auto-scroll after the
  // user stopped it (e.g. wheel-up beating a queued wheel-down re-enable).
  const detachEpochRef = useRef(0)
  const [isAutoScrollActive, setIsAutoScrollActive] = useState(true)

  const getEffectiveScroller = useCallback((): HTMLElement | null => {
    if (getScroller) return getScroller()
    const el = container_ref.current
    if (el instanceof HTMLElement) return el
    return null
  }, [getScroller, container_ref])

  const setActive = useCallback((value: boolean) => {
    if (!value) detachEpochRef.current += 1
    is_active.current = value
    setIsAutoScrollActive(value)
  }, [])

  const disableAutoscroll = useCallback(() => {
    setActive(false)
  }, [setActive])

  const scroll_to_bottom = useCallback(() => {
    if (!is_active.current) return
    const scroller = getEffectiveScroller()
    if (scroller) {
      programmaticRef.current = true
      scroller.scrollTop = scroller.scrollHeight
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          programmaticRef.current = false
        })
      })
      lastFollowRef.current = Date.now()
    }
  }, [getEffectiveScroller])

  const handleScrollbarGesture = useCallback(
    (kind: ScrollbarGestureKind, gapToEndPx: number | null) => {
      if (kind === 'down') draggingRef.current = true
      const enabled = scrollbarGestureToEnable(kind, gapToEndPx)
      setActive(enabled)
      if (enabled) lastFollowRef.current = Date.now()
      if (kind === 'up') draggingRef.current = false
    },
    [setActive],
  )

  // A freshly loaded session must anchor to the bottom. Load-time races — a
  // stray scroll event firing at the top before the first bottom-anchor — used
  // to disable autoscroll permanently, stranding the feed at the top. Re-arm on
  // every session change and pin to the bottom once the content settles.
  const sessionAnchorRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!session?.id) return
    if (sessionAnchorRafRef.current !== null) {
      cancelAnimationFrame(sessionAnchorRafRef.current)
      sessionAnchorRafRef.current = null
    }
    setActive(true)
    lastFollowRef.current = Date.now()
    sessionAnchorRafRef.current = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scroll_to_bottom()
        sessionAnchorRafRef.current = null
      })
    })
    return () => {
      if (sessionAnchorRafRef.current !== null) {
        cancelAnimationFrame(sessionAnchorRafRef.current)
        sessionAnchorRafRef.current = null
      }
    }
  }, [session?.id, setActive, scroll_to_bottom])

  useEffect(() => {
    const scroller = getEffectiveScroller()
    if (!scroller) return

    // Re-enable is deferred by two frames so the browser has applied the
    // gesture's scroll before proximity is measured — a single decisive flick
    // from beyond the threshold that lands at the bottom still re-attaches.
    // The scheduled check is tied to the detach epoch: if anything disabled
    // auto-scroll after it was queued (e.g. a wheel-up), the check aborts.
    const reEnableIfNearBottom = () => {
      const epoch = detachEpochRef.current
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (epoch !== detachEpochRef.current) return
          const distance = scroller.scrollHeight - scroller.scrollTop - scroller.offsetHeight
          if (distance < WHEEL_REENABLE_PX) {
            lastFollowRef.current = Date.now()
            setActive(true)
          }
        })
      })
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) {
        reEnableIfNearBottom()
        return
      }
      disableAutoscroll()
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches[0]) startY.current = e.touches[0].clientY
    }
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return
      const touch = e.touches[0]
      if (!touch) return
      const deltaY = touch.clientY - startY.current
      if (deltaY > 0) {
        disableAutoscroll()
        return
      }
      reEnableIfNearBottom()
    }

    const onScroll = () => {
      if (draggingRef.current) return
      if (programmaticRef.current) return
      if (Date.now() - lastFollowRef.current <= FOLLOW_GUARD_MS) return
      setActive(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
        disableAutoscroll()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'End') {
        reEnableIfNearBottom()
      }
    }

    const observer = new MutationObserver(() => {
      if (!is_active.current) return
      requestAnimationFrame(scroll_to_bottom)
    })

    const interval = setInterval(() => {
      if (!is_active.current || document.hidden) return
      scroll_to_bottom()
    }, 1000)

    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: true })
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('keydown', onKeyDown)
    scroller.tabIndex = -1
    observer.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('keydown', onKeyDown)
      observer.disconnect()
      clearInterval(interval)
    }
  }, [session?.id, getEffectiveScroller, scroll_to_bottom, setActive, disableAutoscroll])

  const force_scroll_to_bottom = useCallback(() => {
    setActive(true)
    scroll_to_bottom()
  }, [setActive, scroll_to_bottom])

  const setAutoScroll = useCallback(
    (enabled: boolean) => {
      setActive(enabled)
      if (enabled) scroll_to_bottom()
    },
    [setActive, scroll_to_bottom],
  )

  return {
    force_scroll_to_bottom,
    isAutoScrollActive,
    setAutoScroll,
    handleScrollbarGesture,
  }
}
