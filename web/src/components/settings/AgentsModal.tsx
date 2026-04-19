import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { DropdownMenu } from '../shared/DropdownMenu'
import { useAgentsStore, type AgentFull } from '../../stores/agents'
import { authFetch } from '../../lib/api'
import {
  FormField,
  ModalActions,
  ErrorBanner,
} from './CRUDModal'
import { CRUDListItem } from './CRUDListItem'
import type { AgentInfo } from '../../stores/agents'

interface AgentsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function AgentListItem({
  agent,
  isBuiltIn,
  isConfirmingDelete,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  agent: AgentInfo
  isBuiltIn: boolean
  isConfirmingDelete: boolean
  onView: () => void
  onEdit?: () => void
  onDuplicate: () => void
  onDelete?: () => void
}) {
  return (
    <CRUDListItem
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete}
      onView={onView}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: agent.color ?? '#6b7280' }} />
        <span className="text-text-primary text-sm font-medium">{agent.name}</span>
        <span className="text-text-muted text-xs font-mono">{agent.id}</span>
        {isBuiltIn && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-primary text-text-muted">Built-in</span>
        )}
      </div>
      {agent.description && (
        <p className="text-text-secondary text-xs mt-0.5 truncate">{agent.description}</p>
      )}
      <div className="flex flex-wrap gap-1 mt-1">
        {agent.allowedTools.slice(0, 5).map(tool => (
          <span key={tool} className="text-[10px] font-mono text-text-muted bg-bg-primary px-1 py-0.5 rounded">
            {tool}
          </span>
        ))}
        {agent.allowedTools.length > 5 && (
          <span className="text-[10px] text-text-muted">+{agent.allowedTools.length - 5} more</span>
        )}
      </div>
    </CRUDListItem>
  )
}

function AgentGroup({
  title,
  agents,
  subagents,
  isBuiltIn,
  onView,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  title: string
  agents: AgentInfo[]
  subagents: AgentInfo[]
  isBuiltIn: boolean
  onView: (id: string) => void
  onDuplicate: (id: string) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  if (agents.length === 0 && subagents.length === 0) return null
  const renderAgentItem = (agent: AgentInfo) => (
    <AgentListItem
      key={agent.id}
      agent={agent}
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={false}
      onView={() => onView(agent.id)}
      onEdit={isBuiltIn ? undefined : () => onEdit?.(agent.id)}
      onDuplicate={() => onDuplicate(agent.id)}
      onDelete={isBuiltIn ? undefined : () => onDelete?.(agent.id)}
    />
  )
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{title}</h3>
      <div className="space-y-2">
        {agents.map(renderAgentItem)}
        {subagents.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">Sub-agents</div>
            <div className="space-y-2">
              {subagents.map(renderAgentItem)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function AgentsModal({ isOpen, onClose, initialEditId }: AgentsModalProps) {
  const defaults = useAgentsStore(state => state.defaults)
  const userItems = useAgentsStore(state => state.userItems)
  const loading = useAgentsStore(state => state.loading)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const fetchAgent = useAgentsStore(state => state.fetchAgent)
  const fetchDefaultContent = useAgentsStore(state => state.fetchDefaultContent)
  const createAgent = useAgentsStore(state => state.createAgent)
  const updateAgent = useAgentsStore(state => state.updateAgent)
  const deleteAgentAction = useAgentsStore(state => state.deleteAgent)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isReadOnly, setIsReadOnly] = useState(false)

  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSubagent, setFormSubagent] = useState(true)
  const [formTools, setFormTools] = useState<string[]>([])
  const [formColor, setFormColor] = useState('#6b7280')
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [availableTools, setAvailableTools] = useState<{ name: string; actions: string[] }[]>([])

  function parseAllowedTools(tools: string[]): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>()
    for (const entry of tools) {
      const colonIdx = entry.indexOf(':')
      if (colonIdx === -1) {
        result.set(entry, new Set())
      } else {
        const toolName = entry.slice(0, colonIdx)
        const actionsStr = entry.slice(colonIdx + 1)
        const actions = actionsStr.split(',').filter(Boolean)
        result.set(toolName, new Set(actions))
      }
    }
    return result
  }

  function serializeTools(granular: Map<string, Set<string>>): string[] {
    const result: string[] = []
    for (const [toolName, actions] of granular) {
      if (actions.size === 0) {
        result.push(toolName)
      } else {
        result.push(`${toolName}:${[...actions].join(',')}`)
      }
    }
    return result
  }

  const granularTools = parseAllowedTools(formTools)

  const toggleToolAction = (toolName: string, action: string) => {
    const newGranular = new Map(granularTools)
    const current = newGranular.get(toolName) || new Set()
    const newActions = new Set(current)
    if (newActions.has(action)) {
      newActions.delete(action)
    } else {
      newActions.add(action)
    }
    if (newActions.size === 0) {
      newGranular.set(toolName, new Set())
    } else {
      newGranular.set(toolName, newActions)
    }
    setFormTools(serializeTools(newGranular))
  }

  const toggleTool = (toolName: string) => {
    const newGranular = new Map(granularTools)
    if (newGranular.has(toolName)) {
      newGranular.delete(toolName)
    } else {
      newGranular.set(toolName, new Set())
    }
    setFormTools(serializeTools(newGranular))
  }

  const populateFormFromAgent = (agent: AgentFull) => {
    setFormName(agent.metadata.name)
    setFormId(agent.metadata.id)
    setFormDescription(agent.metadata.description)
    setFormSubagent(agent.metadata.subagent)
    setFormTools(agent.metadata.allowedTools)
    setFormColor(agent.metadata.color ?? '#6b7280')
    setFormPrompt(agent.prompt)
    setFormError('')
  }

  const applyDuplicateFromContent = (content: AgentFull, id: string, setAsNew: boolean) => {
    setFormName(content.metadata.name + ' (copy)')
    setFormId(`${id}-copy-${Date.now()}`)
    setFormDescription(content.metadata.description)
    setFormSubagent(content.metadata.subagent)
    setFormTools(content.metadata.allowedTools)
    setFormColor(content.metadata.color ?? '#6b7280')
    setFormPrompt(content.prompt)
    setFormError('')
    if (setAsNew) {
      setEditingId(null)
    }
    setIsReadOnly(false)
    setView('edit')
  }

  const applyViewFromContent = (content: AgentFull, id: string) => {
    populateFormFromAgent(content)
    setEditingId(id)
    setIsReadOnly(true)
    setView('edit')
  }

  useEffect(() => {
    if (isOpen) {
      fetchAgents()
      authFetch('/api/tools').then(r => r.json()).then(d => setAvailableTools(d.tools || [])).catch(() => setAvailableTools([]))
      
      if (initialEditId) {
        const isDefault = defaults.some(d => d.id === initialEditId)
        if (isDefault) {
          fetchDefaultContent(initialEditId).then(content => {
            if (!content) return
            applyDuplicateFromContent(content, initialEditId, true)
          })
        } else {
          fetchAgent(initialEditId).then(agent => {
            if (!agent) return
            populateFormFromAgent(agent)
            setEditingId(initialEditId)
            setIsReadOnly(false)
            setView('edit')
          })
        }
      } else {
        setView('list')
        setEditingId(null)
        setIsReadOnly(false)
      }
    }
  }, [isOpen, fetchAgents, fetchAgent, fetchDefaultContent, initialEditId])

  const handleView = async (agentId: string) => {
    const isDefault = defaults.some(d => d.id === agentId)
    if (isDefault) {
      const content = await fetchDefaultContent(agentId)
      if (!content) return
      applyViewFromContent(content, agentId)
    } else {
      const agent = await fetchAgent(agentId)
      if (!agent) return
      applyViewFromContent(agent, agentId)
    }
  }

  const handleDuplicate = async (agentId: string) => {
    const content = await fetchDefaultContent(agentId)
    if (!content) return
    applyDuplicateFromContent(content, agentId, true)
  }

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormDescription('')
    setFormSubagent(true)
    setFormTools(['read_file'])
    setFormColor('#6b7280')
    setFormPrompt('')
    setFormError('')
    setIsReadOnly(false)
    setView('edit')
  }

  const handleEdit = async (agentId: string) => {
    const agent = await fetchAgent(agentId)
    if (!agent) return
    populateFormFromAgent(agent)
    setEditingId(agentId)
    setIsReadOnly(false)
    setView('edit')
  }

  const handleDelete = async (agentId: string) => {
    await deleteAgentAction(agentId)
  }

  const handleSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName || !formPrompt) {
      setFormError('Name and prompt are required.')
      return
    }

    setSaving(true)
    setFormError('')

    const agent: AgentFull = {
      metadata: {
        id,
        name: formName,
        description: formDescription,
        subagent: formSubagent,
        allowedTools: formTools,
        color: formColor,
      },
      prompt: formPrompt,
    }

    const result = editingId
      ? await updateAgent(editingId, agent)
      : await createAgent(agent)

    setSaving(false)

    if (!result.success) {
      setFormError(result.error ?? 'Failed to save agent.')
      return
    }

    initialEditId ? onClose() : setView('list')
  }

  const handleCancel = () => {
    if (initialEditId) {
      onClose()
    } else {
      setView('list')
      setIsReadOnly(false)
    }
  }

  const handleNameChange = (name: string) => {
    setFormName(name)
    if (!editingId) {
      setFormId(toSlug(name))
    }
  }

  const defaultSubAgents = defaults.filter(a => a.subagent)
  const defaultTopLevelAgents = defaults.filter(a => !a.subagent)
  const userSubAgents = userItems.filter(a => a.subagent)
  const userTopLevelAgents = userItems.filter(a => !a.subagent)

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={handleCancel} title={isReadOnly ? `${formName}` : (editingId ? 'Edit Agent' : 'New Agent')} size="xl">
        <div className="flex flex-col h-full">
          <div className="space-y-3">
            {formError && <ErrorBanner message={formError} />}

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name" value={formName} onChange={handleNameChange} placeholder="My Agent" readOnly={isReadOnly} />
              <FormField label="ID" value={formId} onChange={setFormId} readOnly={true} placeholder="my_agent" hint="(read-only)" mono />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Description" value={formDescription} onChange={setFormDescription} placeholder="What this agent does" readOnly={isReadOnly} />
              <div>
                <label className="block text-xs text-text-secondary mb-1">Type</label>
                <div className="flex items-center gap-3 h-[34px]">
                  <button
                    onClick={() => !isReadOnly && setFormSubagent(true)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      formSubagent
                        ? 'bg-accent-primary/25 text-accent-primary'
                        : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                    } ${isReadOnly ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    Sub-agent
                  </button>
                  <button
                    onClick={() => !isReadOnly && setFormSubagent(false)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      !formSubagent
                        ? 'bg-accent-primary/25 text-accent-primary'
                        : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                    } ${isReadOnly ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    Top-level
                  </button>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <label className="text-xs text-text-secondary">Color</label>
                    <input
                      type="color"
                      value={formColor}
                      onChange={e => !isReadOnly && setFormColor(e.target.value)}
                      disabled={isReadOnly}
                      className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Tools</label>
              <div className="flex flex-wrap gap-1.5 p-2 bg-bg-tertiary border border-border rounded max-h-32 overflow-y-auto">
                {availableTools.map(tool => {
                  const isSelected = granularTools.has(tool.name)
                  const hasActions = tool.actions.length > 0
                  const selectedActions = granularTools.get(tool.name) || new Set()

                  const button = (
                    <button
                      key={tool.name}
                      className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors flex items-center gap-1 ${
                        isSelected
                          ? 'bg-accent-primary/25 text-accent-primary'
                          : 'bg-bg-primary text-text-muted'
                      }`}
                    >
                      <span>{tool.name}</span>
                      {hasActions && (
                        <span className={`text-[10px] ${isSelected && selectedActions.size > 0 ? 'text-accent-primary' : 'text-text-muted'}`}>*</span>
                      )}
                    </button>
                  )

                  if (!hasActions) {
                    return (
                      <button
                        key={tool.name}
                        onClick={() => !isReadOnly && toggleTool(tool.name)}
                        className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors flex items-center gap-1 ${
                          isSelected
                            ? 'bg-accent-primary/25 text-accent-primary'
                            : 'bg-bg-primary text-text-muted hover:text-text-secondary'
                        } ${isReadOnly ? 'pointer-events-none' : 'cursor-pointer'}`}
                      >
                        <span>{tool.name}</span>
                      </button>
                    )
                  }

                  if (isReadOnly) {
                    return (
                      <button
                        key={tool.name}
                        className="px-1.5 py-0.5 rounded text-xs font-mono flex items-center gap-1 bg-bg-primary text-text-muted pointer-events-none opacity-60"
                      >
                        <span>{tool.name}</span>
                        <span className="text-[10px]">*</span>
                      </button>
                    )
                  }

                  return (
                    <DropdownMenu
                      key={tool.name}
                      trigger={button}
                      minWidth="160px"
                      items={[
                        ...tool.actions.map(action => ({
                          label: (
                            <label className="flex items-center gap-2 cursor-pointer" htmlFor={`${tool.name}-${action}`}>
                              <input
                                type="checkbox"
                                id={`${tool.name}-${action}`}
                                checked={selectedActions.has(action)}
                                onChange={() => toggleToolAction(tool.name, action)}
                                disabled={isReadOnly}
                                className="w-3 h-3 rounded accent-accent-primary"
                              />
                              <span>{action}</span>
                            </label>
                          ),
                          closeOnClick: false,
                        })),
                        {
                          label: isSelected ? 'Deselect all' : 'Select all',
                          closeOnClick: false,
                          onClick: () => {
                            if (isSelected) {
                              toggleTool(tool.name)
                            } else {
                              const newGranular = new Map(granularTools)
                              newGranular.set(tool.name, new Set(tool.actions))
                              setFormTools(serializeTools(newGranular))
                            }
                          },
                        },
                      ]}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-[150px] border-t border-border pt-3 flex flex-col">
            <label className="block text-xs text-text-secondary mb-1">Prompt</label>
            <textarea
              value={formPrompt}
              onChange={e => !isReadOnly && setFormPrompt(e.target.value)}
              readOnly={isReadOnly}
              placeholder="Instructions for this agent..."
              className={`flex-1 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary ${isReadOnly ? 'opacity-60' : ''}`}
            />
          </div>

          <ModalActions
            onCancel={handleCancel}
            onSave={handleSave}
            saving={saving}
            saveDisabled={!formName || !formPrompt || isReadOnly}
          />
          {isReadOnly && (
            <div className="flex justify-end mt-2">
              <Button
                variant="primary"
                onClick={() => {
                  setFormName(formName + ' (copy)')
                  setFormId(`${editingId}-copy-${Date.now()}`)
                  setEditingId(null)
                  setIsReadOnly(false)
                }}
              >
                Duplicate & Customize
              </Button>
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agents" size="lg">
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Agents define behavior, tools, and prompts for top-level modes and sub-agents.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <Button variant="primary" size="sm" onClick={handleNew}>
            + New
          </Button>
        </div>
      </div>

      {loading && defaults.length === 0 && userItems.length === 0 ? (
        <div className="text-text-muted text-sm">Loading agents...</div>
      ) : defaults.length === 0 && userItems.length === 0 ? (
        <div className="text-text-muted text-sm">No agents defined.</div>
      ) : (
        <div className="space-y-4">
          {defaults.length > 0 && (
            <AgentGroup
              title="Built-in"
              agents={defaultTopLevelAgents}
              subagents={defaultSubAgents}
              isBuiltIn={true}
              onView={handleView}
              onDuplicate={handleDuplicate}
            />
          )}

          {userItems.length > 0 && (
            <AgentGroup
              title="Custom"
              agents={userTopLevelAgents}
              subagents={userSubAgents}
              isBuiltIn={false}
              onView={handleView}
              onDuplicate={handleDuplicate}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )}
        </div>
      )}
    </Modal>
  )
}