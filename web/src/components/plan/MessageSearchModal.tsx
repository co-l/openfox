import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SearchIcon } from '../shared/icons'
import { XCloseIcon } from '../shared/icons'
import { fuzzyMatch, handleModalNavigation } from '../../lib/modal-utils'
import type { Message } from '@shared/types.js'

interface MessageSearchModalProps {
  isOpen: boolean
  onClose: () => void
  messages: Message[]
  onSelectMessage: (messageId: string) => void
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

export function MessageSearchModal({ isOpen, onClose, messages, onSelectMessage }: MessageSearchModalProps) {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  const userMessages = messages.filter(
    (msg) =>
      msg.role === 'user' &&
      !msg.isSystemGenerated &&
      msg.messageKind !== 'auto-prompt' &&
      msg.messageKind !== 'command',
  )

  useEffect(() => {
    if (isOpen) wasOpenRef.current = true
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      const timer = setTimeout(() => searchRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const filteredMessages = userMessages.filter((msg) => fuzzyMatch(msg.content, search))
  const maxIndex = filteredMessages.length - 1

  const handleKeyDown = (e: React.KeyboardEvent) => {
    handleModalNavigation(
      e,
      maxIndex,
      setSelectedIndex,
      () => {
        if (filteredMessages[selectedIndex]) {
          onSelectMessage(filteredMessages[selectedIndex].id)
          onClose()
        }
      },
      onClose,
    )
  }

  const handleSelect = (messageId: string) => {
    onSelectMessage(messageId)
    onClose()
  }

  return isOpen
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <div className="relative w-full max-w-md bg-bg-secondary border border-border rounded shadow-xl">
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
                placeholder="Search messages..."
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
            <div className="overflow-y-auto max-h-[60vh] p-2">
              {filteredMessages.length === 0 ? (
                <div className="px-3 py-4 text-center text-text-muted text-sm">
                  {userMessages.length > 0 ? 'No matches' : 'No messages yet'}
                </div>
              ) : (
                filteredMessages.map((msg, index) => (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => handleSelect(msg.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      index === selectedIndex
                        ? 'bg-accent-primary/20 text-text-primary'
                        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate flex-1">{msg.content}</span>
                      <span className="text-text-muted text-xs shrink-0">{formatTimestamp(msg.timestamp)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null
}
