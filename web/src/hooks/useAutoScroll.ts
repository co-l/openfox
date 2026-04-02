import { RefObject, useEffect } from "react"
import { Session } from "@shared/types.ts"

export const useAutoScroll = (
  container_ref: RefObject<HTMLDivElement | null>,
  session: Session | null,
) => {
  let last_raf: number
  let is_user_scrolling: boolean = false
  let is_user_touching: boolean = false
  let is_forced_scroll_to_bottom: boolean = false
  let is_programmatic_scroll: boolean = false

  const scroll_to_bottom = () => {
    is_programmatic_scroll = true
    const scroller = container_ref.current
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
    }
    setTimeout(() => { is_programmatic_scroll = false }, 100)
  }

  const scroll_to_bottom_on_startup = () => {
    last_raf = requestAnimationFrame(scroll_to_bottom)
    setTimeout(() => {
      last_raf = requestAnimationFrame(scroll_to_bottom)
    }, 250)
    setTimeout(() => {
      last_raf = requestAnimationFrame(scroll_to_bottom)
    }, 500)
    setTimeout(() => {
      last_raf = requestAnimationFrame(scroll_to_bottom)
    }, 1000)
  }

  useEffect(() => {
    const scroller = container_ref.current
    if (!scroller) {
      return
    }

    const observer = new MutationObserver(() => {
      if (is_user_scrolling || is_user_touching) {
        cancelAnimationFrame(last_raf)
        return
      }
      last_raf = requestAnimationFrame(scroll_to_bottom)
    })

    scroll_to_bottom_on_startup()

    observer.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    // add another regular reconnection to the scroll bottom
    const scroll_to_bottom_interval = setInterval(() => {
      if (is_user_scrolling || is_user_touching) {
        cancelAnimationFrame(last_raf)
        return
      }
      scroll_to_bottom()
    }, 1000)

    const start_user_scroll = (e:Event) => {
      if (is_forced_scroll_to_bottom || is_programmatic_scroll) {
        // discard event for forced scroll
        return
      }

      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.offsetHeight
      if (distance > 50) {
        cancelAnimationFrame(last_raf)
        is_user_scrolling = true
        console.log("Scroll detected!", e)
      } else {
        is_user_scrolling = false
      }
    }

    const touch_start = () => is_user_touching = true
    const touch_end = () => is_user_touching = false

    scroller.addEventListener('scroll', start_user_scroll, { passive: true })
    scroller.addEventListener('touchstart', touch_start, { passive: true })
    scroller.addEventListener('touchend', touch_end, { passive: true })

    return () => {
      scroller.removeEventListener('scroll', start_user_scroll)
      scroller.removeEventListener('touchstart', touch_start)
      scroller.removeEventListener('touchend', touch_end)
      observer.disconnect()
      clearInterval(scroll_to_bottom_interval)
    }
  }, [session?.id])

  return {
    force_scroll_to_bottom: () => {
      is_user_scrolling = false
      is_user_touching = false
      is_forced_scroll_to_bottom = true
      scroll_to_bottom()
      setTimeout(() => scroll_to_bottom(), 250)
      setTimeout(() => scroll_to_bottom(), 500)
      setTimeout(() => scroll_to_bottom(), 750)
      setTimeout(() => scroll_to_bottom(), 1000)
      setTimeout(() => {
        is_forced_scroll_to_bottom = false
      }, 1250)

    },
  }
}