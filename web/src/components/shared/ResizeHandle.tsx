interface ResizeHandleProps {
  /** Which edge of the parent sidebar this handle sits on. */
  side: 'left' | 'right'
  onMouseDown: (e: React.MouseEvent) => void
  /** Extra classes (e.g. 'hidden md:block' to restrict to desktop). */
  className?: string
}

/**
 * Thin vertical drag handle for resizing sidebar/railbar widths.
 * Must be placed inside a `position: relative` parent.
 */
export function ResizeHandle({ side, onMouseDown, className = '' }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className={`absolute top-0 bottom-0 w-1 z-20 cursor-col-resize hover:bg-accent-primary/30 transition-colors ${
        side === 'left' ? 'left-0 -ml-0.5' : 'right-0 -mr-0.5'
      } ${className}`}
    />
  )
}
