import { useEffect, useRef, useState } from 'react'

export interface DropdownMenuItem {
  label: string | React.ReactNode
  icon?: React.ReactNode
  onClick: (event?: React.MouseEvent) => void
  danger?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  trigger: React.ReactNode
  minWidth?: string
}

export function DropdownMenu({ items, trigger, minWidth = '120px' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={menuRef}>
      <div onClick={(e) => {
        e.stopPropagation()
        setIsOpen(!isOpen)
      }}>{trigger}</div>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 bg-bg-secondary border border-border rounded shadow-lg z-50" style={{ minWidth }}>
          {items.map((item, index) => (
            <button
              key={index}
              onClick={(e) => {
                item.onClick(e)
                setIsOpen(false)
              }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-bg-tertiary transition-colors flex items-center gap-2 ${
                item.danger ? 'text-accent-error hover:bg-accent-error/10' : 'text-text-primary'
              } ${index !== items.length - 1 ? 'border-b border-border' : ''}`}
            >
              {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
