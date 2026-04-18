import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'wouter'

export interface DropdownMenuItem {
  label: string | React.ReactNode
  icon?: React.ReactNode
  onClick?: (event?: React.MouseEvent) => void
  href?: string
  danger?: boolean
  closeOnClick?: boolean  // default: true
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  trigger: React.ReactNode
  minWidth?: string
}

export function DropdownMenu({ items, trigger, minWidth = '120px' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; alignToTop: boolean } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
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

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const menuHeight = 200

    const spaceBelow = window.innerHeight - triggerRect.bottom
    const alignToTop = spaceBelow < menuHeight

    setPosition({
      top: alignToTop ? triggerRect.top - menuHeight - 4 : triggerRect.bottom + 4,
      left: triggerRect.left,
      alignToTop,
    })
  }, [])

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOpen) {
      calculatePosition()
    }
    setIsOpen(!isOpen)
  }

  const menuContent = position && (
    <div
      ref={menuRef}
      data-testid="session-dropdown-menu"
      className={`fixed bg-bg-secondary border border-border rounded shadow-lg z-50 ${
        position.alignToTop ? 'mb-1' : 'mt-1'
      }`}
      style={{
        top: position.top,
        left: position.left,
        minWidth,
      }}
    >
      {items.map((item, index) => {
        const content = (
          <>
            {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
            {item.label}
          </>
        )

        if (item.href) {
          return (
            <Link
              key={index}
              href={item.href}
              onClick={(e) => {
                item.onClick?.(e)
                setIsOpen(false)
              }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-bg-tertiary transition-colors flex items-center gap-2 ${
                item.danger ? 'text-accent-error hover:bg-accent-error/10' : 'text-text-primary'
              } ${index !== items.length - 1 ? 'border-b border-border' : ''}`}
            >
              {content}
            </Link>
          )
        }

        return (
          <button
            key={index}
            onClick={(e) => {
              item.onClick?.(e)
              if (item.closeOnClick !== false) {
                setIsOpen(false)
              }
            }}
            className={`w-full px-3 py-2 text-left text-sm hover:bg-bg-tertiary transition-colors flex items-center gap-2 ${
              item.danger ? 'text-accent-error hover:bg-accent-error/10' : 'text-text-primary'
            } ${index !== items.length - 1 ? 'border-b border-border' : ''}`}
          >
            {content}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <div className="relative">
        <div ref={triggerRef} onClick={handleTriggerClick}>{trigger}</div>
      </div>
      {isOpen && createPortal(menuContent, document.body)}
    </>
  )
}
