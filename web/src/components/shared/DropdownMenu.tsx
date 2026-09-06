import { ScrollArea } from './ScrollArea'
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'wouter'

/** Below this viewport width the menu renders as a centered full-screen modal. */
const MOBILE_BREAKPOINT_PX = 640
/** Keep at least this many pixels between the menu and the viewport edges. */
const VIEWPORT_MARGIN_PX = 8

// Stable identity for the default props so memoized derivations don't churn.
const NO_ITEMS: DropdownMenuItem[] = []

export interface DropdownMenuItem {
  label: string | React.ReactNode
  icon?: React.ReactNode
  labelAction?: React.ReactNode
  /** Full-height color stripe pinned to the item's left edge. */
  stripeClass?: string
  /** Stripe color as a raw hex, for runtime-colored entries (workflow palette). */
  stripeHex?: string
  /** Purely visual full-width horizontal divider bar: no click target, keyboard-skipped. */
  decorativeBar?: boolean
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
  footerItems = NO_ITEMS,
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

  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedIndexRef = useRef(0)
  const allItems = useMemo(() => [...items, ...footerItems], [items, footerItems])
  const allItemsRef = useRef(allItems)

  /**
   * Place the menu with its REAL measured size (fallback estimate only on the
   * very first paint) and clamp it inside the viewport: flips above the
   * trigger when there is no room below, never overflows left/right.
   */
  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const mobile = window.innerWidth < MOBILE_BREAKPOINT_PX
    setIsMobile((prev) => (prev === mobile ? prev : mobile))
    if (mobile) {
      setPosition((prev) => (prev === null ? prev : null))
      return
    }

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const measured = menuRef.current?.getBoundingClientRect()
    const menuHeight = measured?.height || 200
    const menuWidth = measured?.width || Number.parseInt(minWidth, 10) || 120

    const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN_PX
    const openBelow = spaceBelow >= Math.min(menuHeight, 240) || spaceBelow >= window.innerHeight * 0.35

    let top: number
    let maxHeight: number
    if (openBelow) {
      top = triggerRect.bottom + 4
      maxHeight = window.innerHeight - top - VIEWPORT_MARGIN_PX
    } else {
      const availableAbove = Math.max(triggerRect.top - VIEWPORT_MARGIN_PX - 4, 120)
      top = Math.max(triggerRect.top - 4 - Math.min(menuHeight, availableAbove), VIEWPORT_MARGIN_PX)
      maxHeight = Math.min(availableAbove, window.innerHeight - top - VIEWPORT_MARGIN_PX)
    }

    let left = align === 'right' ? triggerRect.right - menuWidth : triggerRect.left
    const maxLeft = Math.max(window.innerWidth - menuWidth - VIEWPORT_MARGIN_PX, VIEWPORT_MARGIN_PX)
    // Clamp against the right edge only when the viewport is actually wider
    // than the menu; a too-narrow (or zero-size, e.g. test) viewport wins
    // horizontally, never the negative left.
    const minLeft = window.innerWidth > menuWidth + 2 * VIEWPORT_MARGIN_PX ? VIEWPORT_MARGIN_PX : maxLeft
    left = Math.min(Math.max(left, minLeft), maxLeft)

    setPosition((prev) =>
      prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight ? prev : { top, left, maxHeight },
    )
  }, [align, minWidth])

  // Re-measure while open: the first pass only has an estimate; the clamp
  // must follow the real painted box (ResizeObserver fires once right after
  // mount, then on any size change).
  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null)
      return
    }
    calculatePosition()
  }, [isOpen, allItems, calculatePosition])

  useEffect(() => {
    if (!isOpen || !menuRef.current) return
    const observer = new ResizeObserver(() => calculatePosition())
    observer.observe(menuRef.current)
    return () => observer.disconnect()
  }, [isOpen, calculatePosition, position !== null])

  useEffect(() => {
    if (!isOpen) return
    const reposition = () => calculatePosition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [isOpen, calculatePosition])

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
    if (item.decorativeBar) return true
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
    if (item.decorativeBar) {
      const showBarBorder = index !== total - 1
      return (
        <div key={baseIndex} className={`relative ${showBarBorder ? 'border-b border-border' : ''}`}>
          <div
            aria-hidden
            data-testid="menu-decorative-bar"
            className={`h-1 w-full ${item.stripeClass ?? 'bg-transparent'}`}
            style={item.stripeHex ? { backgroundColor: item.stripeHex } : undefined}
          />
        </div>
      )
    }
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
      <div key={baseIndex} className={`relative ${borderClass}`}>
        {item.stripeClass && <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${item.stripeClass}`} />}
        {item.stripeHex && !item.stripeClass && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-1"
            style={{ backgroundColor: item.stripeHex }}
          />
        )}
        {linkOrButton}
      </div>
    )
  }

  const menuInner = (
    <>
      <ScrollArea className="max-h-[min(60vh,calc(100vh-16px))]">
        {items.map((item, index) => renderItem(item, index, items.length, index))}
      </ScrollArea>
      {footerItems.length > 0 && (
        <div className="border-t border-border">
          {footerItems.map((item, index) => renderItem(item, index, footerItems.length, items.length + index))}
        </div>
      )}
    </>
  )

  const menuContent = isMobile ? (
    // Mobile: a centered full-screen modal instead of a positioned popover.
    <div
      data-testid="session-dropdown-overlay"
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false)
      }}
    >
      <div
        ref={menuRef}
        data-testid="session-dropdown-menu"
        className="bg-bg-secondary border border-border rounded-lg shadow-lg max-w-[min(420px,90vw)] w-full max-h-[85vh] overflow-hidden flex flex-col"
        tabIndex={-1}
      >
        {menuInner}
      </div>
    </div>
  ) : (
    position && (
      <div
        ref={menuRef}
        data-testid="session-dropdown-menu"
        className="fixed bg-bg-secondary border border-border rounded shadow-lg z-50 overflow-hidden flex flex-col"
        style={{
          top: position.top,
          left: position.left,
          minWidth,
          maxHeight: Math.max(position.maxHeight, 120),
        }}
        tabIndex={-1}
      >
        {menuInner}
      </div>
    )
  )

  return (
    <>
      <div className="relative min-w-0">
        <div ref={triggerRef} onClick={handleTriggerClick} className="min-w-0">
          {trigger}
        </div>
      </div>
      {isOpen && createPortal(menuContent, document.body)}
    </>
  )
}
