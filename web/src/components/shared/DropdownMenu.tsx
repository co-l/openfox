import { ScrollArea } from './ScrollArea'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'wouter'

export interface DropdownMenuItem {
  label: string | React.ReactNode
  icon?: React.ReactNode
  labelAction?: React.ReactNode
  onClick?: (event?: React.MouseEvent) => void
  href?: string
  danger?: boolean
  closeOnClick?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  footerItems?: DropdownMenuItem[]
  trigger: React.ReactNode
  minWidth?: string
  /** Which edge of the trigger the menu's corresponding edge aligns to. */
  align?: 'left' | 'right'
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  labelActionClassName?: string
}

export function DropdownMenu({
  items,
  footerItems = [],
  trigger,
  minWidth = '120px',
  align = 'left',
  isOpen: controlledIsOpen,
  onOpenChange,
  labelActionClassName,
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
  const allItems = useMemo(() => [...items, ...footerItems], [items, footerItems])
  const allItemsRef = useRef(allItems)

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const menuHeight = 200
    const menuWidth = Number.parseInt(minWidth, 10) || 120

    const spaceBelow = window.innerHeight - triggerRect.bottom
    const alignToTop = spaceBelow < menuHeight

    setPosition({
      top: alignToTop ? triggerRect.top - menuHeight - 4 : triggerRect.bottom + 4,
      left: align === 'right' ? triggerRect.right - menuWidth : triggerRect.left,
      alignToTop,
    })
  }, [align, minWidth])

  useEffect(() => {
    allItemsRef.current = allItems
  }, [allItems])

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
      const currentItems = allItemsRef.current
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
  }, [isOpen, allItems])

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
      setSelectedIndex(allItems.findIndex((item) => !isHeaderItem(item)))
      selectedIndexRef.current = allItems.findIndex((item) => !isHeaderItem(item))
    }
  }, [isOpen, allItems])

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOpen) {
      calculatePosition()
    }
    setIsOpen(!isOpen)
  }

  function renderItem(item: DropdownMenuItem, index: number, total: number, baseIndex: number) {
    const isHeader = isHeaderItem(item)
    const isSelected = !isHeader && baseIndex === selectedIndex
    const content = (
      <>
        {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
        <span className="min-w-0">{item.label}</span>
      </>
    )
    const showBorder = index !== total - 1
    const borderClass = showBorder ? 'border-b border-border' : ''
    const stateClass = item.danger
      ? 'text-accent-error hover:bg-accent-error/10'
      : isSelected
        ? 'bg-accent-primary/20 text-text-primary'
        : 'hover:bg-bg-tertiary text-text-primary'
    const baseClass = `px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${stateClass}`

    const linkOrButton = item.href ? (
      <Link
        href={item.href}
        onClick={(e) => {
          item.onClick?.(e)
          setIsOpen(false)
        }}
        onAuxClick={() => setIsOpen(false)}
        className={`w-full ${baseClass}`}
      >
        {content}
      </Link>
    ) : (
      <button
        onClick={(e) => {
          item.onClick?.(e)
          if (item.closeOnClick !== false) {
            setIsOpen(false)
          }
        }}
        className={`w-full ${baseClass}`}
      >
        {content}
      </button>
    )

    if (item.labelAction) {
      return (
        <div key={baseIndex} className={`flex items-center gap-1 pr-1 ${borderClass} ${labelActionClassName ?? ''}`}>
          {linkOrButton}
          <span className="flex-shrink-0">{item.labelAction}</span>
        </div>
      )
    }

    return (
      <div key={baseIndex} className={borderClass}>
        {linkOrButton}
      </div>
    )
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
      <ScrollArea className="max-h-[60vh]">
        {items.map((item, index) => renderItem(item, index, items.length, index))}
      </ScrollArea>
      {footerItems.length > 0 && (
        <div className="border-t border-border">
          {footerItems.map((item, index) => renderItem(item, index, footerItems.length, items.length + index))}
        </div>
      )}
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
