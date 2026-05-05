import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'wouter'

export interface DropdownMenuItem {
  label: string | React.ReactNode
  icon?: React.ReactNode
  onClick?: (event?: React.MouseEvent) => void
  href?: string
  danger?: boolean
  closeOnClick?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  trigger: React.ReactNode
  minWidth?: string
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DropdownMenu({
  items,
  trigger,
  minWidth = '120px',
  isOpen: controlledIsOpen,
  onOpenChange,
}: DropdownMenuProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isControlled = controlledIsOpen !== undefined
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen
  const setIsOpen = (val: boolean | ((prev: boolean) => boolean)) => {
    if (isControlled) {
      const next = typeof val === 'function' ? val(internalIsOpen) : val
      onOpenChange?.(next)
    } else {
      setInternalIsOpen(val)
    }
  }

  const [position, setPosition] = useState<{ top: number; left: number; alignToTop: boolean } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedIndexRef = useRef(0)
  const itemsRef = useRef(items)

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

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current) {
        const target = event.target as Node
        if (!menuRef.current.contains(target)) {
          setIsOpen(false)
        }
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      calculatePosition()
    }
  }, [isOpen, calculatePosition])

  useEffect(() => {
    if (!isOpen) return

    setTimeout(() => {
      menuRef.current?.focus()
    }, 0)

    function handleKeyDown(e: KeyboardEvent) {
      const currentItems = itemsRef.current
      const navigableItems = currentItems.filter((item) => !isHeaderItem(item))
      const currentNavigableIndex = getNavigableIndexRef(selectedIndexRef.current, currentItems)

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          if (currentNavigableIndex < navigableItems.length - 1) {
            const nextIndex = findNextNavigableIndexRef(selectedIndexRef.current + 1, currentItems)
            selectedIndexRef.current = nextIndex
            setSelectedIndex(nextIndex)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          if (currentNavigableIndex > 0) {
            const prevIndex = findPrevNavigableIndexRef(selectedIndexRef.current - 1, currentItems)
            selectedIndexRef.current = prevIndex
            setSelectedIndex(prevIndex)
          }
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          activateItemRef(selectedIndexRef.current, currentItems)
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setIsOpen(false)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, items])

  function isHeaderItem(item: DropdownMenuItem) {
    const el = item.label as React.ReactElement<{ className?: string }> | null
    if (!el) return false
    const className = String(el.props?.className ?? '')
    return className.includes('cursor-default')
  }

  function getNavigableIndexRef(localIndex: number, itemsArr: DropdownMenuItem[]): number {
    let count = 0
    for (let i = 0; i < localIndex; i++) {
      const it = itemsArr[i]
      if (it && !isHeaderItem(it)) count++
    }
    return count
  }

  function findNextNavigableIndexRef(from: number, itemsArr: DropdownMenuItem[]): number {
    for (let i = from; i < itemsArr.length; i++) {
      const it = itemsArr[i]
      if (it && !isHeaderItem(it)) return i
    }
    return from
  }

  function findPrevNavigableIndexRef(from: number, itemsArr: DropdownMenuItem[]): number {
    for (let i = from; i >= 0; i--) {
      const it = itemsArr[i]
      if (it && !isHeaderItem(it)) return i
    }
    return from
  }

  function activateItemRef(index: number, itemsArr: DropdownMenuItem[]) {
    const item = itemsArr[index]
    if (!item || isHeaderItem(item)) return
    item.onClick?.()
    if (item.href) {
      window.history.pushState(null, '', item.href)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    setIsOpen(false)
  }

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(items.findIndex((item) => !isHeaderItem(item)))
      selectedIndexRef.current = items.findIndex((item) => !isHeaderItem(item))
    }
  }, [isOpen, items])

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
      tabIndex={-1}
    >
      {items.map((item, index) => {
        const isHeader = isHeaderItem(item)
        const isSelected = !isHeader && index === selectedIndex
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
              onAuxClick={() => setIsOpen(false)}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                item.danger
                  ? 'text-accent-error hover:bg-accent-error/10'
                  : isSelected
                    ? 'bg-accent-primary/20 text-text-primary'
                    : 'hover:bg-bg-tertiary text-text-primary'
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
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
              item.danger
                ? 'text-accent-error hover:bg-accent-error/10'
                : isSelected
                  ? 'bg-accent-primary/20 text-text-primary'
                  : 'hover:bg-bg-tertiary text-text-primary'
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
        <div ref={triggerRef} onClick={handleTriggerClick}>
          {trigger}
        </div>
      </div>
      {isOpen && createPortal(menuContent, document.body)}
    </>
  )
}
