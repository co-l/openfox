import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../hooks/useT'
import { ChevronRightIcon } from './icons'

/** Pixels the mouse must travel before a press becomes a drag (below it, it stays a click). */
const DRAG_THRESHOLD_PX = 5

/**
 * A single row that scrolls horizontally without a visible scrollbar: arrow
 * buttons at the overflowing edges, vertical mouse wheel, and mouse drag.
 * Touch keeps the native swipe.
 */
export function HorizontalScroller({ children }: { children: ReactNode }) {
  const t = useT()
  const rowRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; scrollLeft: number; moved: boolean } | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const updateEdges = () => {
    const row = rowRef.current
    if (!row) return
    const left = row.scrollLeft > 0
    const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }

  // Children (e.g. plugin tabs) can change the content width on any render.
  useEffect(updateEdges)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    // Non-passive so the wheel scrolls the row instead of the page behind it.
    const onWheel = (e: WheelEvent) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      row.scrollLeft += e.deltaY
      updateEdges()
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', updateEdges)
    return () => {
      row.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', updateEdges)
    }
  }, [])

  const scrollByPage = (direction: 1 | -1) => {
    const row = rowRef.current
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: 'smooth' })
  }

  const arrowClass =
    'absolute inset-y-0 z-10 flex items-center px-1 text-text-muted hover:text-text-primary bg-bg-secondary'

  return (
    <div className="relative">
      {edges.left && (
        <button
          type="button"
          aria-label={t({ en: 'Scroll left', fr: 'Défiler vers la gauche' })}
          onClick={() => scrollByPage(-1)}
          className={`${arrowClass} left-0`}
        >
          <ChevronRightIcon rotate={180} className="w-4 h-4" />
        </button>
      )}
      <div
        ref={rowRef}
        className="flex overflow-x-auto scrollbar-hidden"
        onScroll={updateEdges}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0) return
          drag.current = { x: e.clientX, scrollLeft: e.currentTarget.scrollLeft, moved: false }
        }}
        onPointerMove={(e) => {
          const state = drag.current
          if (!state) return
          const dx = e.clientX - state.x
          if (!state.moved) {
            if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
            state.moved = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          e.currentTarget.scrollLeft = state.scrollLeft - dx
          updateEdges()
        }}
        onPointerUp={() => {
          // A drag keeps its state until the click it produces is swallowed below.
          if (!drag.current?.moved) drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault()
            e.stopPropagation()
          }
          drag.current = null
        }}
      >
        {children}
      </div>
      {edges.right && (
        <button
          type="button"
          aria-label={t({ en: 'Scroll right', fr: 'Défiler vers la droite' })}
          onClick={() => scrollByPage(1)}
          className={`${arrowClass} right-0`}
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
