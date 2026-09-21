import { ScrollArea } from '../shared/ScrollArea'
import { useEffect, useState, useRef } from 'react'
import { MoreIcon, AttachIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'
import { useSessionStore } from '../../stores/session'
import { type WorkflowInfo } from '../../lib/workflows-actions'
import { CommandsModal } from '../settings/CommandsModal'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { useResource } from '../../hooks/useResource'
import { useWorkflows } from '../../hooks/useWorkflows'
import { commandsResource, commandResource } from '../../lib/resources'
import { dedupById } from '../../lib/modal-utils'
import { SCOPE_LABELS } from '../../lib/workflow-scope'
import { shouldAutofocus } from '../../lib/device'
import { EditButton } from '../shared/IconButton'
import { Portal } from '../shared/Portal'
import { useClickOutside } from '../../hooks/useClickOutside'
import type { Attachment, WorkflowScope } from '@shared/types.js'

interface MoreMenuProps {
  onSendCommand: (content: string, agentMode?: string, textareaContent?: string, attachments?: Attachment[]) => void
  onSelectWorkflow: (workflowId: string, scope?: WorkflowScope) => void
  onSelectWorkflowWithSubGroup: (workflowId: string, subGroup: string, scope?: WorkflowScope) => void
  onOpenCommandsManager: () => void
  onOpenWorkflowsManager: () => void
  onAttach: () => void
  textareaContent?: string
  attachments?: Attachment[]
  onTriggerMouseDown?: (e: React.MouseEvent) => void
}

type Tab = 'commands' | 'workflows' | 'attach'

function isConditionMet(workflow: WorkflowInfo): boolean | null {
  const cond = workflow.startCondition
  if (!cond || cond.type === 'always') return true
  switch (cond.type) {
    case 'step_result':
    case 'metadata_all_match':
    case 'metadata_all_in':
      return null
    default:
      return null
  }
}

export function MoreMenu({
  onSendCommand,
  onSelectWorkflow,
  onSelectWorkflowWithSubGroup,
  onOpenCommandsManager,
  onOpenWorkflowsManager,
  onAttach,
  textareaContent,
  attachments,
  onTriggerMouseDown,
}: MoreMenuProps) {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('commands')
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editCommandId, setEditCommandId] = useState<string | null>(null)
  const [editWorkflowId, setEditWorkflowId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentWorkdir = useSessionStore((state) => state.currentSession?.workdir)

  const { data: commandData } = useResource(commandsResource, currentWorkdir)
  const commands = commandData
    ? dedupById(dedupById(commandData.defaults, commandData.userItems), commandData.projectItems)
    : []
  // Workflows: keep every scope visible so same-id workflows in different scopes
  // are distinguishable instead of silently collapsed.
  const { workflows } = useWorkflows(currentWorkdir)

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      requestAnimationFrame(() => {
        if (shouldAutofocus()) searchRef.current?.focus()
      })
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
        setSelectedIndex((i) => {
          const items = tab === 'commands' ? commands : workflows
          const filtered = items.filter((item) => {
            const q = search.toLowerCase()
            if (tab === 'commands') return !q || item.name.toLowerCase().includes(q)
            return !q || item.name.toLowerCase().includes(q)
          })
          return Math.min(i + 1, filtered.length - 1)
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
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

  const filteredCommands = commands.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
  const filteredWorkflows = workflows.filter((w) => !search || w.name.toLowerCase().includes(search.toLowerCase()))

  const handleSelectCommand = async (commandId: string) => {
    const full = await commandResource.refresh(commandId, currentWorkdir)
    if (full) {
      onSendCommand(full.prompt, full.metadata.agentMode, textareaContent, attachments)
    }
    setIsOpen(false)
  }

  const handleSelectWorkflowLocal = (workflowId: string, scope?: WorkflowScope) => {
    onSelectWorkflow(workflowId, scope)
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
        onMouseDown={onTriggerMouseDown}
        className="px-1.5 py-2 rounded-r bg-bg-secondary text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors border-l border-border/50"
        title={t({ en: 'More options', fr: 'Plus d’options' })}
      >
        <MoreIcon className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-80 max-w-[calc(100vw-2rem)] bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => {
                setTab('commands')
                setSearch('')
                setSelectedIndex(0)
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'commands'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t({ en: 'Commands', fr: 'Commandes' })}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('workflows')
                setSearch('')
                setSelectedIndex(0)
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'workflows'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t({ en: 'Workflows', fr: 'Workflows' })}
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
              {t({ en: 'Attach', fr: 'Joindre' })}
            </button>
          </div>

          {tab !== 'attach' && (
            <div className="p-2 border-b border-border">
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  tab === 'commands'
                    ? t({ en: 'Search commands...', fr: 'Rechercher des commandes…' })
                    : t({ en: 'Search workflows...', fr: 'Rechercher des workflows…' })
                }
                className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          )}

          <ScrollArea className="max-h-64 p-1">
            {tab === 'commands' ? (
              filteredCommands.length === 0 ? (
                <div className="px-3 py-2 text-text-muted text-sm">
                  {commands.length === 0
                    ? t({ en: 'No commands yet', fr: 'Aucune commande pour le moment' })
                    : t({ en: 'No matches', fr: 'Aucun résultat' })}
                </div>
              ) : (
                filteredCommands.map((command, index) => (
                  <div
                    key={command.id}
                    className={`flex items-center gap-1 px-3 py-2 rounded transition-colors group ${
                      index === selectedIndex ? 'bg-accent-primary/20' : 'hover:bg-bg-tertiary'
                    }`}
                  >
                    <button type="button" onClick={() => handleSelectCommand(command.id)} className="flex-1 text-left">
                      <div className="text-sm text-text-primary font-medium">{command.name}</div>
                    </button>
                    <EditButton
                      className="opacity-0 group-hover:opacity-100"
                      onClick={(e) => handleEditCommand(command.id, e)}
                    />
                  </div>
                ))
              )
            ) : tab === 'workflows' ? (
              filteredWorkflows.length === 0 ? (
                <div className="px-3 py-2 text-text-muted text-sm">
                  {workflows.length === 0
                    ? t({ en: 'No workflows yet', fr: 'Aucun workflow pour le moment' })
                    : t({ en: 'No matches', fr: 'Aucun résultat' })}
                </div>
              ) : (
                filteredWorkflows.map((workflow, index) => {
                  const condMet = isConditionMet(workflow)
                  const color = workflow.color ?? '#3b82f6'
                  return (
                    <div
                      key={`${workflow.id}-${workflow.scope}`}
                      className={`flex items-center gap-2 px-3 py-2 rounded transition-colors group ${
                        index === selectedIndex ? 'bg-accent-primary/20' : 'hover:bg-bg-tertiary'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectWorkflowLocal(workflow.id, workflow.scope)}
                        className="flex-1 text-left flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-sm text-text-primary font-medium flex-1">{workflow.name}</span>
                        <span className="text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded whitespace-nowrap">
                          {SCOPE_LABELS[workflow.scope]}
                        </span>
                        {condMet !== null && (
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: condMet ? '#22c55e' : '#6b7280' }}
                            title={
                              condMet
                                ? t({ en: 'Entry condition met', fr: 'Condition d’entrée satisfaite' })
                                : t({ en: 'Entry condition not met', fr: 'Condition d’entrée non satisfaite' })
                            }
                          />
                        )}
                      </button>
                      <div className="flex items-center gap-1">
                        {workflow.subGroups && workflow.subGroups.length > 0 && (
                          <WorkflowSubGroupMenu
                            subGroups={workflow.subGroups}
                            onSelect={(subGroup) => {
                              setIsOpen(false)
                              onSelectWorkflowWithSubGroup(workflow.id, subGroup, workflow.scope)
                            }}
                          />
                        )}
                        <EditButton
                          className="opacity-0 group-hover:opacity-100"
                          onClick={(e) => handleEditWorkflow(workflow.id, e)}
                        />
                      </div>
                    </div>
                  )
                })
              )
            ) : (
              <div className="p-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onAttach()
                    setIsOpen(false)
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded bg-bg-tertiary hover:bg-accent-primary/20 text-text-primary transition-colors"
                >
                  <AttachIcon className="w-4 h-4" />
                  <span className="text-sm font-medium">{t({ en: 'Attach file', fr: 'Joindre un fichier' })}</span>
                </button>
                <span className="text-xs text-text-muted">
                  {t({ en: 'or drag & drop into chat', fr: 'ou glissez-déposez dans le chat' })}
                </span>
              </div>
            )}
          </ScrollArea>

          {tab !== 'attach' && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  if (tab === 'commands') onOpenCommandsManager()
                  else onOpenWorkflowsManager()
                }}
                className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                {tab === 'commands'
                  ? t({ en: 'Manage Commands...', fr: 'Gérer les commandes…' })
                  : t({ en: 'Manage Workflows...', fr: 'Gérer les workflows…' })}
              </button>
            </div>
          )}
        </div>
      )}

      <CommandsModal
        isOpen={!!editCommandId}
        onClose={() => setEditCommandId(null)}
        initialEditId={editCommandId}
        projectDir={currentWorkdir}
      />
      <WorkflowsModal
        isOpen={!!editWorkflowId}
        onClose={() => setEditWorkflowId(null)}
        initialEditId={editWorkflowId}
      />
    </div>
  )
}

function WorkflowSubGroupMenu({ subGroups, onSelect }: { subGroups: string[]; onSelect: (subGroup: string) => void }) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setMenuOpen(!menuOpen)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
        title={t({ en: 'Sub-groups', fr: 'Sous-groupes' })}
      >
        ⋮
      </button>
      {menuOpen && (
        <Portal>
          <div
            ref={menuRef}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed w-40 bg-bg-secondary border border-border rounded-lg shadow-xl z-[100] overflow-hidden"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            {subGroups.map((sg) => (
              <button
                key={sg}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(sg)
                }}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                {sg}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </>
  )
}
