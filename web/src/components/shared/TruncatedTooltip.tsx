import { useEffect, useRef, useState } from 'react'
import { Tooltip } from './Tooltip'

interface TruncatedTooltipProps {
  text: string
  className?: string
}

export function TruncatedTooltip({ text, className }: TruncatedTooltipProps) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const el = labelRef.current
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  // The layout wrapper must be allowed to shrink below its content width
  // (min-width: auto would otherwise grow it to the full text width), so the
  // label can actually truncate.
  const wrapperClassName = className ? `${className} min-w-0` : 'min-w-0'

  return (
    <Tooltip content={text} triggerClassName={wrapperClassName} enabled={truncated}>
      <span ref={labelRef} className="truncate block w-full min-w-0">
        {text}
      </span>
    </Tooltip>
  )
}
