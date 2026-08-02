import { useState, useEffect, useRef, useCallback } from 'react'

export interface UseResizableOptions {
  initialWidth: number
  minWidth: number
  maxWidth: number
  /** 'left' = sidebar anchored on the left edge (drag right = wider); 'right' = sidebar anchored on the right edge (drag left = wider) */
  direction: 'left' | 'right'
}

export interface UseResizableResult {
  width: number
  isResizing: boolean
  handleMouseDown: (e: React.MouseEvent) => void
}

/**
 * Mouse-driven resize hook for sidebar/railbar widths.
 *
 * Width is stored in React state — it resets to `initialWidth` on page refresh
 * (no localStorage persistence).
 */
export function useResizable({ initialWidth, minWidth, maxWidth, direction }: UseResizableOptions): UseResizableResult {
  const [width, setWidth] = useState(initialWidth)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStateRef = useRef({ startX: 0, startWidth: initialWidth })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeStateRef.current = { startX: e.clientX, startWidth: width }
      setIsResizing(true)
    },
    [width],
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const { startX, startWidth } = resizeStateRef.current
      const delta = e.clientX - startX
      const raw = direction === 'left' ? startWidth + delta : startWidth - delta
      setWidth(Math.max(minWidth, Math.min(maxWidth, raw)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
    }
  }, [isResizing, direction, minWidth, maxWidth])

  return { width, isResizing, handleMouseDown }
}
