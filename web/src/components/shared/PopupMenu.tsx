import { useEffect, useRef, useState } from 'react'
import { EditButton } from '../shared/IconButton'

interface BaseItem {
  id: string
  name: string
}

interface PopupMenuProps<T extends BaseItem> {
  items: T[]
  isLoading: boolean
  onFetch: () => void
  onSelect: (item: T) => void
  onEdit: (itemId: string) => void
  onManage: () => void
  searchPlaceholder: string
  emptyMessage: string
  renderItem?: (item: T, index: number, selectedIndex: number) => React.ReactNode
}

export function PopupMenu<T extends BaseItem>({
  items,
  isLoading,
  onFetch,
  onSelect,
  onEdit,
  onManage,
  searchPlaceholder,
  emptyMessage,
  renderItem,
}: PopupMenuProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      onFetch()
      setSearch('')
      setSelectedIndex(0)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [isOpen, onFetch])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const filtered = items.filter(item => {
    if (!search) return true
    return item.name.toLowerCase().includes(search.toLowerCase())
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex])
          setIsOpen(false)
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
    }
  }

  const handleEdit = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    onEdit(itemId)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
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

      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl z-50"
          onKeyDown={handleKeyDown}
        >
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder={searchPlaceholder}
              className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <div className="overflow-y-auto max-h-64 p-1">
            {isLoading && items.length === 0 ? (
              <div className="px-3 py-2 text-text-muted text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-text-muted text-sm">
                {items.length === 0 ? emptyMessage : 'No matches'}
              </div>
            ) : renderItem ? (
              filtered.map((item, index) => (
                <div key={item.id}>
                  {renderItem(item, index, selectedIndex)}
                </div>
              ))
            ) : (
              filtered.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-1 px-3 py-2 rounded transition-colors group ${
                    index === selectedIndex
                      ? 'bg-accent-primary/20'
                      : 'hover:bg-bg-tertiary'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(item)
                      setIsOpen(false)
                    }}
                    className="flex-1 text-left"
                  >
                    <div className="text-sm text-text-primary font-medium">{item.name}</div>
                  </button>
                  <EditButton
                    className="opacity-0 group-hover:opacity-100"
                    onClick={e => handleEdit(item.id, e)}
                  />
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false)
                onManage()
              }}
              className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              Manage...
            </button>
          </div>
        </div>
      )}
    </div>
  )
}