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

export function QuickActionModal({ isOpen, onClose, onCloseComplete, onSelectCommand, onSelectWorkflow, textareaContent }: QuickActionModalProps) {
  const commandDefaults = useCommandsStore(state => state.defaults)
  const commandUserItems = useCommandsStore(state => state.userItems)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)
  const workflowDefaults = useWorkflowsStore(state => state.defaults)
  const workflowUserItems = useWorkflowsStore(state => state.userItems)
  const fetchWorkflows = useWorkflowsStore(state => state.fetchWorkflows)
  const agentDefaults = useAgentsStore(state => state.defaults)
  const agentUserItems = useAgentsStore(state => state.userItems)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const currentMode = useSessionStore(state => state.currentSession?.mode)
  const currentDangerLevel = useSessionStore(state => state.currentSession?.dangerLevel ?? 'normal')
  const switchMode = useSessionStore(state => state.switchMode)
  const switchDangerLevel = useSessionStore(state => state.switchDangerLevel)

  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      fetchCommands()
      fetchWorkflows()
      fetchAgents()
      setSearch('')
      setSelectedIndex(0)
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [isOpen, fetchCommands, fetchWorkflows, fetchAgents])

  useEffect(() => {
    if (!isOpen) {
      onCloseComplete?.()
    }
  }, [isOpen, onCloseComplete])

  const fuzzyMatch = (name: string, query: string): boolean => {
    if (!query) return true
    const queryParts = query.toLowerCase().split(/\s+/)
    const nameWords = name.toLowerCase().split(/\s+/)
    return queryParts.every(qp => {
      for (const word of nameWords) {
        let qi = 0
        for (let ni = 0; ni < word.length && qi < qp.length; ni++) {
          if (word[ni] === qp[qi]) qi++
        }
        if (qi === qp.length) return true
      }
      return false
    })
  }

  const agents = [...agentDefaults, ...agentUserItems].filter(a => !a.subagent && a.id !== currentMode).map(a => ({ kind: 'agent' as const, id: a.id, name: a.name }))
  const commands = [...commandDefaults, ...commandUserItems].map(c => ({ kind: 'command' as const, id: c.id, name: c.name }))
  const workflows = [...workflowDefaults, ...workflowUserItems].map(w => ({ kind: 'workflow' as const, id: w.id, name: w.name }))
  const modes = (['normal', 'dangerous'] as const).filter(m => m !== currentDangerLevel).map(m => ({ kind: 'mode' as const, id: m, name: m.charAt(0).toUpperCase() + m.slice(1) }))

  type ActionEntry = typeof agents[number] | typeof commands[number] | typeof workflows[number] | typeof modes[number]

  const getPrefix = (kind: ActionEntry['kind']) => {
    if (kind === 'agent') return 'Agent > Switch to'
    if (kind === 'mode') return 'Mode > Switch to'
    if (kind === 'command') return 'Command > Launch'
    return 'Workflow > Run'
  }

  const matchesSearch = (item: ActionEntry) => {
    const label = `${getPrefix(item.kind)} ${item.name}`
    return fuzzyMatch(label, search)
  }

  const allItems = [
    ...agents.filter(a => matchesSearch(a)),
    ...commands.filter(c => matchesSearch(c)),
    ...workflows.filter(w => matchesSearch(w)),
    ...modes.filter(m => matchesSearch(m)),
  ]
  const maxIndex = allItems.length - 1

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
        activateItem(allItems[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  const activateItem = (item: typeof allItems[number] | undefined) => {
    if (!item) return
    if (item.kind === 'agent') {
      switchMode(item.id)
    } else if (item.kind === 'mode') {
      switchDangerLevel(item.id)
    } else if (item.kind === 'command') {
      onSelectCommand(item.id, textareaContent)
    } else {
      onSelectWorkflow(item.id)
    }
    onClose()
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setSelectedIndex(0)
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
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-text-muted"
          />
          <CloseButton onClick={onClose} className="shrink-0" aria-label="Close" />
        </div>
        <div className="overflow-y-auto max-h-80 p-2">
          {allItems.length === 0 ? (
            <div className="px-3 py-4 text-center text-text-muted text-sm">
              {commandDefaults.length + commandUserItems.length + workflowDefaults.length + workflowUserItems.length > 0 ? 'No matches' : 'No agents, commands, or workflows yet'}
            </div>
          ) : (
            allItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => activateItem(item)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  index === selectedIndex
                    ? 'bg-accent-primary/20 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                }`}
              >
                <span className="text-text-muted font-normal">{getPrefix(item.kind)} </span>
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