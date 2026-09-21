import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'wouter'
import { ChevronDownIcon } from './icons'

export interface InlineDropdownItem {
  label: ReactNode
  icon?: ReactNode
  href?: string
  onClick?: () => void
}

interface InlineDropdownProps {
  items: InlineDropdownItem[]
  trigger: ReactNode
  isActive?: boolean
}

export function InlineDropdown({ items, trigger, isActive = false }: InlineDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${isActive ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'}`}
      >
        {typeof trigger === 'string' ? (
          <span className="text-sm text-text-secondary font-medium">{trigger}</span>
        ) : (
          trigger
        )}
        <ChevronDownIcon
          className="w-3 h-3 text-text-muted flex-shrink-0 transition-transform"
          rotate={isOpen ? 180 : 0}
        />
      </button>

      {isOpen && items.length > 0 && (
        <div
          data-testid="inline-dropdown-menu"
          className="absolute top-full left-0 mt-1 w-56 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden z-50"
        >
          {items.map((item, index) => {
            const linkChild =
              item.label && typeof item.label === 'object' && (item.label as React.ReactElement).type === Link
                ? (item.label as React.ReactElement<{ href?: string; children?: ReactNode }>)
                : null

            if (linkChild) {
              const href = linkChild.props.href || ''
              return (
                <Link
                  key={index}
                  href={href}
                  onClick={() => setIsOpen(false)}
                  onAuxClick={(e) => {
                    if (e.button === 1) setIsOpen(false)
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border hover:bg-bg-tertiary transition-colors"
                >
                  {item.icon}
                  {linkChild.props.children}
                </Link>
              )
            }
            if (item.href) {
              return (
                <a
                  key={index}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  onAuxClick={(e) => {
                    if (e.button === 1) setIsOpen(false)
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border hover:bg-bg-tertiary transition-colors"
                >
                  {item.icon}
                  {item.label}
                </a>
              )
            }
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  item.onClick?.()
                  setIsOpen(false)
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left border-b border-border hover:bg-bg-tertiary transition-colors"
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
