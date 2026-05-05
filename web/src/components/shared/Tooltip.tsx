import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

export function Tooltip({ content, children, position = 'top', delay = 200 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const triggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const showTooltip = () => {
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setCoords({ top: rect.top, left: rect.left + rect.width / 2 })
      }
      setVisible(true)
    }, delay)
  }

  const hideTooltip = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }

  const positionStyles = (() => {
    const offset = 8
    switch (position) {
      case 'top':
        return { top: coords.top - offset, left: coords.left, tx: '-50%', ty: '-100%' }
      case 'bottom':
        return { top: coords.top + offset, left: coords.left, tx: '-50%', ty: '0%' }
      case 'left':
        return { top: coords.top, left: coords.left - offset, tx: '-100%', ty: '-50%' }
      case 'right':
        return { top: coords.top, left: coords.left + offset, tx: '0%', ty: '-50%' }
    }
  })()

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            className="fixed z-[9999] px-4 py-3 text-sm text-text-primary bg-bg-secondary border border-border rounded-lg shadow-xl max-w-sm break-words pointer-events-none"
            style={{
              top: positionStyles.top,
              left: positionStyles.left,
              transform: `translate(${positionStyles.tx}, ${positionStyles.ty})`,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
