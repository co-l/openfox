import { useEffect, useState, useRef } from 'react'
import { MoreIcon, AttachIcon } from '../shared/icons'
import { useCommandsStore } from '../../stores/commands'
import { CommandsModal } from '../settings/CommandsModal'
import { useWorkflowsStore, type WorkflowInfo } from '../../stores/workflows'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { EditButton } from '../shared/IconButton'
import type { Attachment, Criterion } from '@shared/types.js'

interface MoreMenuProps {
  onSendCommand: (content: string, agentMode?: string, textareaContent?: string, attachments?: Attachment[]) => void
  onSelectWorkflow: (workflowId: string) => void
  onOpenCommandsManager: () => void
  onOpenWorkflowsManager: () => void
  onAttach: () => void
  textareaContent?: string
  attachments?: Attachment[]
  criteria: Criterion[]
}

type Tab = 'commands' | 'workflows' | 'attach'

function isConditionMet(workflow: WorkflowInfo, criteria: Criterion[]): boolean | null {
  const cond = workflow.startCondition
  if (!cond || cond.type === 'always') return true
  switch (cond.type) {
    case 'has_pending_criteria':
      return criteria.some(c => c.status.type !== 'passed')
    case 'all_criteria_passed':
      return criteria.length === 0 || criteria.every(c => c.status.type === 'passed')
    case 'all_criteria_completed_or_passed':
      return criteria.every(c => c.status.type === 'completed' || c.status.type === 'passed')
    case 'any_criteria_blocked':
      return criteria.some(c =>
        c.status.type === 'failed' &&
        c.attempts.filter(a => a.status === 'failed').length >= 4
      )
    case 'step_result':
      return null
    default:
      return null
  }
}

export function MoreMenu({
  onSendCommand,
  onSelectWorkflow,
  onOpenCommandsManager,
  onOpenWorkflowsManager,
  onAttach,
  textareaContent,
  attachments,
  criteria,
}: MoreMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('commands')
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editCommandId, setEditCommandId] = useState<string | null>(null)
  const [editWorkflowId, setEditWorkflowId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const commandDefaults = useCommandsStore(state => state.defaults)
  const commandUserItems = useCommandsStore(state => state.userItems)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)

  const workflowDefaults = useWorkflowsStore(state => state.defaults)
  const workflowUserItems = useWorkflowsStore(state => state.userItems)
  const fetchWorkflows = useWorkflowsStore(state => state.fetchWorkflows)

  const commands = [...commandDefaults, ...commandUserItems]
  const workflows = [...workflowDefaults, ...workflowUserItems]

  useEffect(() => {
    if (isOpen) {
      if (tab === 'commands') fetchCommands()
      else if (tab === 'workflows') fetchWorkflows()
    }
  }, [isOpen, tab, fetchCommands, fetchWorkflows])

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [isOpen, tab])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => {
          const items = tab === 'commands' ? commands : workflows
          const filtered = items.filter(item => {
            const q = search.toLowerCase()
            if (tab === 'commands') return !q || item.name.toLowerCase().includes(q)
            return !q || item.name.toLowerCase().includes(q)
          })
          return Math.min(i + 1, filtered.length - 1)
        })
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
        setIsOpen(false)
        break
    }
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setSelectedIndex(0)
  }

  const filteredCommands = commands.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
  const filteredWorkflows = workflows.filter(w => !search || w.name.toLowerCase().includes(search.toLowerCase()))

  const handleSelectCommand = async (commandId: string) => {
    const full = await useCommandsStore.getState().fetchCommand(commandId)
    if (full) {
      onSendCommand(full.prompt, full.metadata.agentMode, textareaContent, attachments)
    }
    setIsOpen(false)
  }

  const handleSelectWorkflowLocal = (workflowId: string) => {
    onSelectWorkflow(workflowId)
    setIsOpen(false)
  }

  const handleEditCommand = (commandId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    setEditCommandId(commandId)
  }

  const handleEditWorkflow = (workflowId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    setEditWorkflowId(workflowId)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-1.5 py-2 rounded-r bg-bg-secondary text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors border-l border-border/50"
        title="More options"
      >
        <MoreIcon className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-80 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => { setTab('commands'); setSearch(''); setSelectedIndex(0) }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'commands'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Commands
            </button>
            <button
              type="button"
              onClick={() => { setTab('workflows'); setSearch(''); setSelectedIndex(0) }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'workflows'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Workflows
            </button>
            <button
              type="button"
              onClick={() => setTab('attach')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'attach'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Attach
            </button>
          </div>

          {tab !== 'attach' && (
            <div className="p-2 border-b border-border">
              <input
                ref={searchRef}
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={tab === 'commands' ? 'Search commands...' : 'Search workflows...'}
                className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          )}

          <div className="overflow-y-auto max-h-64 p-1">
            {tab === 'commands' ? (
              filteredCommands.length === 0 ? (
                <div className="px-3 py-2 text-text-muted text-sm">
                  {commands.length === 0 ? 'No commands yet' : 'No matches'}
                </div>
              ) : (
                filteredCommands.map((command, index) => (
                  <div
                    key={command.id}
                    className={`flex items-center gap-1 px-3 py-2 rounded transition-colors group ${
                      index === selectedIndex ? 'bg-accent-primary/20' : 'hover:bg-bg-tertiary'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectCommand(command.id)}
                      className="flex-1 text-left"
                    >
                      <div className="text-sm text-text-primary font-medium">{command.name}</div>
                    </button>
                    <EditButton
                      className="opacity-0 group-hover:opacity-100"
                      onClick={e => handleEditCommand(command.id, e)}
                    />
                  </div>
                ))
              )
            ) : tab === 'workflows' ? (
              filteredWorkflows.length === 0 ? (
                <div className="px-3 py-2 text-text-muted text-sm">
                  {workflows.length === 0 ? 'No workflows yet' : 'No matches'}
                </div>
              ) : (
                filteredWorkflows.map((workflow, index) => {
                  const condMet = isConditionMet(workflow, criteria)
                  const color = workflow.color ?? '#3b82f6'
                  return (
                    <div
                      key={workflow.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded transition-colors group ${
                        index === selectedIndex ? 'bg-accent-primary/20' : 'hover:bg-bg-tertiary'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectWorkflowLocal(workflow.id)}
                        className="flex-1 text-left flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-sm text-text-primary font-medium flex-1">{workflow.name}</span>
                        {condMet !== null && (
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: condMet ? '#22c55e' : '#6b7280' }}
                            title={condMet ? 'Entry condition met' : 'Entry condition not met'}
                          />
                        )}
                      </button>
                      <EditButton
                        className="opacity-0 group-hover:opacity-100"
                        onClick={e => handleEditWorkflow(workflow.id, e)}
                      />
                    </div>
                  )
                })
              )
            ) : (
              <div className="p-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => { onAttach(); setIsOpen(false) }}
                  className="flex items-center gap-2 px-4 py-2 rounded bg-bg-tertiary hover:bg-accent-primary/20 text-text-primary transition-colors"
                >
                  <AttachIcon className="w-4 h-4" />
                  <span className="text-sm font-medium">Attach image</span>
                </button>
                <span className="text-xs text-text-muted">or drag & drop into chat</span>
              </div>
            )}
          </div>

          {tab !== 'attach' && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => { setIsOpen(false); tab === 'commands' ? onOpenCommandsManager() : onOpenWorkflowsManager() }}
                className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                {tab === 'commands' ? 'Manage Commands...' : 'Manage Workflows...'}
              </button>
            </div>
          )}
        </div>
      )}

      <CommandsModal isOpen={!!editCommandId} onClose={() => setEditCommandId(null)} initialEditId={editCommandId} />
      <WorkflowsModal isOpen={!!editWorkflowId} onClose={() => setEditWorkflowId(null)} initialEditId={editWorkflowId} />
    </div>
  )
}