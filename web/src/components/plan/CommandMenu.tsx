import { useEffect, useState } from 'react'
// @ts-ignore
import type { Attachment } from '@shared/types.js'
import { useCommandsStore } from '../../stores/commands'
import { CommandsModal } from '../settings/CommandsModal'
import { EditButton } from '../shared/IconButton'
import {
  useSearchableMenu,
  DropdownTrigger,
  SearchInput,
  ListContainer,
  EmptyMessage,
  ManageButton,
} from './SearchableDropdown'

interface CommandMenuProps {
  onSendCommand: (content: string, agentMode?: string, textareaContent?: string, attachments?: Attachment[]) => void
  onOpenManager: () => void
  textareaContent?: string
  attachments?: Attachment[]
}

export function CommandMenu({ onSendCommand, onOpenManager, textareaContent, attachments }: CommandMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const defaults = useCommandsStore(state => state.defaults)
  const userItems = useCommandsStore(state => state.userItems)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)
  const commands = [...defaults, ...userItems]

  const {
    isOpen: menuOpen,
    search,
    selectedIndex,
    filtered,
    containerRef,
    searchRef,
    handleToggle,
    handleSearchChange,
    handleKeyDown,
  } = useSearchableMenu({
    items: commands,
    isOpen,
    onOpen: () => setIsOpen(true),
    onClose: () => setIsOpen(false),
    filterFn: (command, q) => !q || command.name.toLowerCase().includes(q.toLowerCase()),
  })

  useEffect(() => {
    if (isOpen) {
      fetchCommands()
    }
  }, [isOpen, fetchCommands])

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
      <DropdownTrigger label="Commands" isOpen={menuOpen} onClick={handleToggle} />

      {menuOpen && (
        <div
          className="absolute bottom-full right-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl z-50"
          onKeyDown={handleKeyDown}
        >
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            ref={searchRef}
            placeholder="Search commands..."
          />

          <ListContainer>
            {filtered.length === 0 ? (
              <EmptyMessage hasItems={commands.length > 0} message="No commands yet" />
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
          </ListContainer>

          <ManageButton label="Manage Commands..." onClick={handleManage} />
        </div>
      )}

      <CommandsModal isOpen={!!editId} onClose={() => setEditId(null)} initialEditId={editId} />
    </div>
  )
}