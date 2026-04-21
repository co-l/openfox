import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CloseButton } from './shared/IconButton'
import { useCommandsStore } from '../stores/commands'
import { useWorkflowsStore } from '../stores/workflows'
import { useAgentsStore } from '../stores/agents'
import { useSessionStore } from '../stores/session'

interface QuickActionModalProps {
  isOpen: boolean
  onClose: () => void
  onCloseComplete?: () => void
  onSelectCommand: (commandId: string, textareaContent?: string) => void
  onSelectWorkflow: (workflowId: string) => void
  textareaContent?: string
}

interface ActionItem {
  id: string
  name: string
  prefix: string
  action: () => void
}

const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true
  const queryParts = query.toLowerCase().split(/\s+/)
  const words = text.toLowerCase().split(/\s+/)
  return queryParts.every(qp => {
    for (const word of words) {
      let qi = 0
      for (let ni = 0; ni < word.length && qi < qp.length; ni++) {
        if (word[ni] === qp[qi]) qi++
      }
      if (qi === qp.length) return true
    }
    return false
  })
}

export function QuickActionModal({ isOpen, onClose, onCloseComplete, onSelectCommand, onSelectWorkflow, textareaContent }: QuickActionModalProps) {
  const fetchCommands = useCommandsStore(state => state.fetchCommands)
  const fetchWorkflows = useWorkflowsStore(state => state.fetchWorkflows)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const commandDefaults = useCommandsStore(state => state.defaults)
  const commandUserItems = useCommandsStore(state => state.userItems)
  const workflowDefaults = useWorkflowsStore(state => state.defaults)
  const workflowUserItems = useWorkflowsStore(state => state.userItems)
  const agentDefaults = useAgentsStore(state => state.defaults)
  const agentUserItems = useAgentsStore(state => state.userItems)
  const currentMode = useSessionStore(state => state.currentSession?.mode)
  const currentDangerLevel = useSessionStore(state => state.currentSession?.dangerLevel ?? 'normal')
  const switchMode = useSessionStore(state => state.switchMode)
  const switchDangerLevel = useSessionStore(state => state.switchDangerLevel)
  const currentProjectId = useSessionStore(state => state.currentSession?.projectId)
  const createSession = useSessionStore(state => state.createSession)

  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen) wasOpenRef.current = true
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      fetchCommands()
      fetchWorkflows()
      fetchAgents()
      setSearch('')
      setSelectedIndex(0)
      const timer = setTimeout(() => searchRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen, fetchCommands, fetchWorkflows, fetchAgents])

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      onCloseComplete?.()
    }
  }, [isOpen, onCloseComplete])

  const dedupById = <T extends { id: string }>(defaults: T[], userItems: T[]): T[] => {
    const userIds = new Set(userItems.map(i => i.id))
    return [...defaults.filter(i => !userIds.has(i.id)), ...userItems]
  }

  const items: ActionItem[] = [
    {
      id: 'create-session',
      name: 'New Session',
      prefix: 'Action > Create',
      action: () => currentProjectId && createSession(currentProjectId),
    },
    ...dedupById(agentDefaults, agentUserItems)
      .filter(a => !a.subagent && a.id !== currentMode)
      .map(a => ({ id: a.id, name: a.name, prefix: 'Agent > Switch to', action: () => switchMode(a.id) })),
    ...dedupById(commandDefaults, commandUserItems)
      .map(c => ({ id: c.id, name: c.name, prefix: 'Command > Launch', action: () => onSelectCommand(c.id, textareaContent) })),
    ...dedupById(workflowDefaults, workflowUserItems)
      .map(w => ({ id: w.id, name: w.name, prefix: 'Workflow > Run', action: () => onSelectWorkflow(w.id) })),
    ...(['normal', 'dangerous'] as const)
      .filter(m => m !== currentDangerLevel)
      .map(m => ({ id: m, name: m.charAt(0).toUpperCase() + m.slice(1), prefix: 'Mode > Switch to', action: () => switchDangerLevel(m) })),
  ]

  const filteredItems = items.filter(item => fuzzyMatch(`${item.prefix} ${item.name}`, search))
  const maxIndex = filteredItems.length - 1

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, maxIndex))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        filteredItems[selectedIndex]?.action()
        onClose()
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return isOpen ? createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-bg-secondary border border-border rounded shadow-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-text-muted"
          />
          <CloseButton onClick={onClose} className="shrink-0" aria-label="Close" />
        </div>
        <div className="overflow-y-auto max-h-[60vh] p-2">
          {filteredItems.length === 0 ? (
            <div className="px-3 py-4 text-center text-text-muted text-sm">
              {commandDefaults.length + commandUserItems.length + workflowDefaults.length + workflowUserItems.length > 0 ? 'No matches' : 'No agents, commands, or workflows yet'}
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { item.action(); onClose() }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  index === selectedIndex
                    ? 'bg-accent-primary/20 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                }`}
              >
                <span className="text-text-muted font-normal">{item.prefix} </span>
                <span>{item.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null
}