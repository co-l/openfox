import { useEffect, useRef, useState } from 'react'
// @ts-ignore
import type { Attachment } from '@shared/types.js'
import { useCommandsStore } from '../../stores/commands'
import { CommandsModal } from '../settings/CommandsModal'
import { EditButton } from '../shared/IconButton'

interface CommandMenuProps {
  onSendCommand: (content: string, agentMode?: string, textareaContent?: string, attachments?: Attachment[]) => void
  onOpenManager: () => void
  textareaContent?: string
  attachments?: Attachment[]
}

export function CommandMenu({ onSendCommand, onOpenManager, textareaContent, attachments }: CommandMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const commands = useCommandsStore(state => state.commands)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)

  useEffect(() => {
    if (isOpen) {
      fetchCommands()
      setSearch('')
      setSelectedIndex(0)
      // Focus search input after render
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [isOpen, fetchCommands])

  // Click outside to close
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

  const filtered = commands.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q)
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
          handleSelect(filtered[selectedIndex].id)
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
    }
  }

  const handleSelect = async (commandId: string) => {
    const full = await useCommandsStore.getState().fetchCommand(commandId)
    if (full) {
      onSendCommand(full.prompt, full.metadata.agentMode, textareaContent, attachments)
    }
    setIsOpen(false)
  }

  const handleManage = () => {
    setIsOpen(false)
    onOpenManager()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        Commands
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
          {/* Search */}
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Search commands..."
              className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          {/* Command list */}
          <div className="overflow-y-auto max-h-64 p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-text-muted text-sm">
                {commands.length === 0 ? 'No commands yet' : 'No matches'}
              </div>
            ) : (
              filtered.map((command, index) => (
                <div
                  key={command.id}
                  className={`flex items-center gap-1 px-3 py-2 rounded transition-colors group ${
                    index === selectedIndex
                      ? 'bg-accent-primary/20'
                      : 'hover:bg-bg-tertiary'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(command.id)}
                    className="flex-1 text-left"
                  >
                    <div className="text-sm text-text-primary font-medium">{command.name}</div>
                  </button>
                  <EditButton
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsOpen(false)
                      setEditId(command.id)
                    }}
                  />
                </div>
              ))
            )}
          </div>

          {/* Manage button */}
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={handleManage}
              className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              Manage Commands...
            </button>
          </div>
        </div>
      )}

      <CommandsModal isOpen={!!editId} onClose={() => setEditId(null)} initialEditId={editId} />
    </div>
  )
}
