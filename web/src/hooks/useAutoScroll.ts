import { RefObject, useEffect, useRef, useState } from "react"
import { Session } from "@shared/types.ts"

export const useAutoScroll = (
  container_ref: RefObject<HTMLDivElement | null>,
  session: Session | null,
) => {
  const is_active = useRef(true)
  const startY = useRef<number | null>(null)
  const [isAutoScrollActive, setIsAutoScrollActive] = useState(true)

  const scroll_to_bottom = () => {
    const scroller = container_ref.current
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }

  useEffect(() => {
    const scroller = container_ref.current
    if (!scroller) return

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const distance = scroller.scrollHeight - scroller.scrollTop - scroller.offsetHeight
          if (distance < 100) {
            is_active.current = true
            setIsAutoScrollActive(true)
          }
        }))
        return
      }
      is_active.current = false
      setIsAutoScrollActive(false)
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
        is_active.current = false
        setIsAutoScrollActive(false)
        return
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const distance = scroller.scrollHeight - scroller.scrollTop - scroller.offsetHeight
        if (distance < 100) {
          is_active.current = true
          setIsAutoScrollActive(true)
        }
      }))
    }

    const observer = new MutationObserver(() => {
      if (!is_active.current) return
      requestAnimationFrame(scroll_to_bottom)
    })

    const interval = setInterval(() => {
      if (!is_active.current) return
      scroll_to_bottom()
    }, 1000)

    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: true })
    observer.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      observer.disconnect()
      clearInterval(interval)
    }
  }, [session?.id])

  return {
    force_scroll_to_bottom: () => {
      is_active.current = true
      setIsAutoScrollActive(true)
      scroll_to_bottom()
    },
    isAutoScrollActive,
    setAutoScroll: (enabled: boolean) => {
      is_active.current = enabled
      setIsAutoScrollActive(enabled)
      if (enabled) scroll_to_bottom()
    },
  }
}