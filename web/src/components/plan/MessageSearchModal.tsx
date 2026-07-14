import type { ReactNode } from 'react'
import { useEffect, useState, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { SearchIcon, XCloseIcon, UserIcon, ThinkingIcon, AgentIcon } from '../shared/icons'
import { fuzzyMatch, handleModalNavigation } from '../../lib/modal-utils'
import type { DisplayItem } from './groupMessages'

const STORAGE_KEY = 'openfox-message-search-filters'

export const FILTER_CATEGORIES = [
  { key: 'user', label: 'User prompts' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'response', label: 'Responses' },
] as const

type FilterKey = (typeof FILTER_CATEGORIES)[number]['key']

function loadFilters(): Set<FilterKey> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as FilterKey[]
      return new Set(parsed)
    }
  } catch {
    /* ignore */
  }
  return new Set(['user', 'thinking', 'response'])
}

function saveFilters(filters: Set<FilterKey>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...filters]))
}

export function getItemCategory(item: DisplayItem): FilterKey | null {
  if (item.type !== 'message') return null
  const msg = item.message
  if (msg.role === 'user') return 'user'
  if (msg.role === 'assistant') {
    if (msg.content?.trim()) return 'response'
    if (msg.thinkingContent?.trim()) return 'thinking'
  }
  return null
}

interface MessageSearchModalProps {
  isOpen: boolean
  onClose: () => void
  displayItems: DisplayItem[]
  onNavigate: (index: number) => void
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const HH = String(date.getHours()).padStart(2, '0')
  const mm2 = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd} ${HH}:${mm2}`
}

function getTimestamp(item: DisplayItem): string | undefined {
  if (item.type === 'message') return item.message.timestamp
  if (item.type === 'subagent') return item.messages[0]?.timestamp
  return undefined
}

export function getItemStyle(item: DisplayItem): string {
  if (item.type === 'message') {
    const msg = item.message
    if (msg.role === 'assistant') {
      const hasContent = msg.content?.trim()
      const hasThinking = msg.thinkingContent?.trim()
      if (hasThinking && !hasContent) return 'italic text-text-muted'
      return ''
    }
    if (msg.role === 'user') return 'font-bold'
  }
  return ''
}

export function getItemIcon(item: DisplayItem): ReactNode {
  if (item.type !== 'message') return <AgentIcon className="w-3.5 h-3.5" />
  const msg = item.message
  if (msg.role === 'assistant') {
    if (msg.thinkingContent?.trim() && !msg.content?.trim()) return <ThinkingIcon className="w-3.5 h-3.5" />
    return <AgentIcon className="w-3.5 h-3.5" />
  }
  return <UserIcon className="w-3.5 h-3.5" />
}

export function getItemLabel(item: DisplayItem): string {
  if (item.type === 'message') {
    const msg = item.message
    const rawContent = msg.content || ''
    const cleanContent = rawContent
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (msg.messageKind === 'workflow-started') {
      try {
        const data = JSON.parse(rawContent) as { workflowName: string }
        return `Workflow: ${data.workflowName}`
      } catch {
        return 'Workflow started'
      }
    }
    if (msg.messageKind === 'task-completed') return 'Task completed'
    if (msg.messageKind === 'auto-prompt') return 'Auto-prompt'
    if (msg.messageKind === 'correction') return 'Correction'
    if (msg.messageKind === 'context-reset') return 'Context reset'
    if (msg.messageKind === 'command') return 'Command executed'

    if (msg.role === 'assistant') {
      if (cleanContent) return cleanContent.slice(0, 200)
      if (msg.thinkingContent?.trim()) return msg.thinkingContent.slice(0, 200)
      return ''
    }
    const preview = cleanContent.slice(0, 180)
    const hasAttachments = msg.attachments && msg.attachments.length > 0
    const attachmentLabel = hasAttachments ? (cleanContent ? '[Image attached]' : '[Image uploaded]') : ''
    const suffix = preview.length < cleanContent.length ? '...' : ''
    return attachmentLabel ? `${preview}${suffix} ${attachmentLabel}` : `${preview}${suffix}`
  }
  if (item.type === 'subagent') return `Sub-agent: ${item.subAgentType}`
  return ''
}

export function MessageSearchModal({ isOpen, onClose, displayItems, onNavigate }: MessageSearchModalProps) {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(loadFilters)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selectedItemRef = useRef<HTMLButtonElement>(null)

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      saveFilters(next)
      return next
    })
  }

  const baseItems = useMemo(() => {
    return displayItems.filter((item) => {
      if (item.type === 'context-divider') return false
      if (item.type === 'message') {
        if (item.message.messageKind === 'auto-prompt') return false
        if (item.message.role === 'assistant') {
          if (!item.message.content?.trim() && !item.message.thinkingContent?.trim()) return false
        }
      }
      return true
    })
  }, [displayItems])

  const visibleItems = useMemo(() => {
    return baseItems.filter((item) => {
      const category = getItemCategory(item)
      if (category && !activeFilters.has(category)) return false
      return true
    })
  }, [baseItems, activeFilters])

  const filteredItems = useMemo(() => {
    if (!search) return visibleItems
    return baseItems.filter((item) => {
      const label = getItemLabel(item)
      return fuzzyMatch(label, search)
    })
  }, [visibleItems, search])

  const maxIndex = filteredItems.length - 1

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      const timer = setTimeout(() => searchRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [isOpen])

  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    handleModalNavigation(
      e,
      maxIndex,
      setSelectedIndex,
      () => {
        const item = filteredItems[selectedIndex]
        if (item) {
          const realIndex = displayItems.indexOf(item)
          if (realIndex >= 0) onNavigate(realIndex)
          onClose()
        }
      },
      onClose,
    )
  }

  const handleSelect = (item: DisplayItem) => {
    const realIndex = displayItems.indexOf(item)
    if (realIndex >= 0) onNavigate(realIndex)
    onClose()
  }

  const getRealIndex = (item: DisplayItem): number => displayItems.indexOf(item)

  return isOpen
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <div className="relative w-full max-w-lg bg-bg-secondary border border-border rounded shadow-xl">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <SearchIcon />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setSelectedIndex(0)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search timeline..."
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-text-muted"
              />
              <button
                type="button"
                onClick={onClose}
                className="p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <XCloseIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-1.5 px-4 py-2 border-b border-border">
              {FILTER_CATEGORIES.map((cat) => {
                const isActive = activeFilters.has(cat.key)
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => toggleFilter(cat.key)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/40'
                        : 'bg-bg-tertiary text-text-muted border border-border hover:text-text-secondary'
                    }`}
                  >
                    {cat.label}
                  </button>
                )
              })}
            </div>
            <div ref={listRef} className="overflow-y-auto max-h-[60vh] p-2">
              {filteredItems.length === 0 ? (
                <div className="px-3 py-4 text-center text-text-muted text-sm">
                  {visibleItems.length > 0 ? 'No matches' : 'No messages yet'}
                </div>
              ) : (
                filteredItems.map((item, index) => {
                  const realIndex = getRealIndex(item)
                  const icon = getItemIcon(item)
                  const label = getItemLabel(item)
                  const style = getItemStyle(item)
                  const timestamp = getTimestamp(item)
                  const isUser = item.type === 'message' && item.message.role === 'user'

                  return (
                    <button
                      ref={index === selectedIndex ? selectedItemRef : null}
                      key={`${realIndex}-${item.type}`}
                      type="button"
                      onClick={() => handleSelect(item)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        index === selectedIndex
                          ? 'bg-accent-primary/20 text-text-primary'
                          : isUser
                            ? 'bg-accent-primary/5 text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
                            : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="flex-shrink-0">{icon}</span>
                          <span className={`truncate flex-1 ${style}`}>{label}</span>
                        </div>
                        {timestamp && (
                          <span className="text-text-muted text-xs shrink-0">{formatTimestamp(timestamp)}</span>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null
}
