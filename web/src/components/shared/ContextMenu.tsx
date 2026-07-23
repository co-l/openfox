import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number } | null
  onClose: () => void
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  useEffect(() => {
    if (position) setSelectedIndex(-1)
  }, [position])

  useEffect(() => {
    if (!position) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
          break
        case 'Enter':
          e.preventDefault()
          items[selectedIndex]?.onClick()
          onClose()
          break
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', onClose)

    menuRef.current?.focus()

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', onClose)
    }
  }, [position, items, selectedIndex, onClose])

  if (!position) return null

  let left = Math.min(position.x, window.innerWidth - 190)
  let top = Math.min(position.y, window.innerHeight - 100)
  left = Math.max(8, left)
  top = Math.max(8, top)

  return createPortal(
    <div
      ref={menuRef}
      tabIndex={-1}
      className="fixed bg-bg-secondary border border-border rounded shadow-lg z-50 min-w-[160px] outline-none"
      style={{ left, top }}
    >
      <div className="max-h-[60vh] overflow-y-auto" onMouseLeave={() => setSelectedIndex(-1)}>
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
              i < items.length - 1 ? 'border-b border-border' : ''
            } ${
              item.danger
                ? 'text-accent-error hover:bg-accent-error/10'
                : i === selectedIndex
                  ? 'bg-accent-primary/20 text-text-primary'
                  : 'hover:bg-bg-tertiary text-text-primary'
            }`}
          >
            {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
