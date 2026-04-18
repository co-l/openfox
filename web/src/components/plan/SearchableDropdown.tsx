import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'

interface UseSearchableMenuOptions<T> {
  items: T[]
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  filterFn: (item: T, search: string) => boolean
}

interface UseSearchableMenuResult<T> {
  isOpen: boolean
  search: string
  selectedIndex: number
  filtered: T[]
  containerRef: React.RefObject<HTMLDivElement | null>
  searchRef: React.RefObject<HTMLInputElement | null>
  handleToggle: () => void
  handleSearchChange: (value: string) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
  setSelectedIndex: (index: number) => void
  resetSelection: () => void
}

export function useSearchableMenu<T>({
  items,
  isOpen,
  onOpen,
  onClose,
  filterFn,
}: UseSearchableMenuOptions<T>): UseSearchableMenuResult<T> {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  const handleToggle = useCallback(() => {
    if (isOpen) {
      onClose()
    } else {
      onOpen()
    }
  }, [isOpen, onOpen, onClose])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setSelectedIndex(0)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const filtered = items.filter(item => filterFn(item, search))
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [items, search, filterFn, onClose])

  const resetSelection = useCallback(() => {
    setSelectedIndex(0)
  }, [])

  const filtered = items.filter(item => filterFn(item, search))

  return {
    isOpen,
    search,
    selectedIndex,
    filtered,
    containerRef,
    searchRef,
    handleToggle,
    handleSearchChange,
    handleKeyDown,
    setSelectedIndex,
    resetSelection,
  }
}

interface DropdownTriggerProps {
  label: string
  isOpen: boolean
  onClick: () => void
  className?: string
}

export function DropdownTrigger({ label, isOpen, onClick, className = '' }: DropdownTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors ${className}`}
    >
      {label}
      <svg
        className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  ref: React.RefObject<HTMLInputElement | null>
  placeholder: string
}

export function SearchInput({ value, onChange, onKeyDown, ref, placeholder }: SearchInputProps) {
  return (
    <div className="p-2 border-b border-border">
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
      />
    </div>
  )
}

interface ListContainerProps {
  children: ReactNode
  maxHeight?: string
}

export function ListContainer({ children, maxHeight = 'max-h-64' }: ListContainerProps) {
  return <div className={`overflow-y-auto ${maxHeight} p-1`}>{children}</div>
}

interface EmptyMessageProps {
  hasItems: boolean
  message: string
}

export function EmptyMessage({ hasItems, message }: EmptyMessageProps) {
  return (
    <div className="px-3 py-2 text-text-muted text-sm">
      {hasItems ? 'No matches' : message}
    </div>
  )
}

interface ManageButtonProps {
  label: string
  onClick: () => void
}

export function ManageButton({ label, onClick }: ManageButtonProps) {
  return (
    <div className="border-t border-border p-1">
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
      >
        {label}
      </button>
    </div>
  )
}