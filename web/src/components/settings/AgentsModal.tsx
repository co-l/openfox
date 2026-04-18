import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { EditButton } from '../shared/IconButton'
import { DropdownMenu } from '../shared/DropdownMenu'
import { useAgentsStore, type AgentInfo, type AgentFull } from '../../stores/agents'
import { authFetch } from '../../lib/api'
import {
  ConfirmButton,
  DeleteIcon,
  RestoreIcon,
  FormField,
  ModalActions,
  ErrorBanner,
} from './CRUDModal'

interface AgentsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function renderAgentListItem(
  agent: AgentInfo,
  confirmDeleteId: string | null,
  modifiedIds: string[],
  confirmRestoreId: string | null,
  restoreDefault: (id: string) => Promise<boolean>,
  setConfirmRestoreId: (id: string | null) => void,
  handleEdit: (id: string) => void,
  handleDelete: (id: string) => void
) {
  return (
    <AgentListItem
      key={agent.id}
      agent={agent}
      isConfirmingDelete={confirmDeleteId === agent.id}
      isModified={modifiedIds.includes(agent.id)}
      isConfirmingRestore={confirmRestoreId === agent.id}
      onRestore={async () => { await restoreDefault(agent.id); setConfirmRestoreId(null) }}
      onEdit={() => handleEdit(agent.id)}
      onDelete={() => handleDelete(agent.id)}
    />
  )
}

function AgentListItem({
  agent,
  isConfirmingDelete,
  isConfirmingRestore,
  isModified,
  onRestore,
  onEdit,
  onDelete,
}: {
  agent: { id: string; name: string; description: string; allowedTools: string[]; color?: string }
  isConfirmingDelete: boolean
  isConfirmingRestore: boolean
  isModified: boolean
  onRestore: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary">
      <div className="min-w-0 flex-1 mr-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: agent.color ?? '#6b7280' }} />
          <span className="text-text-primary text-sm font-medium">{agent.name}</span>
          <span className="text-text-muted text-xs font-mono">{agent.id}</span>
          {isModified && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400">modified</span>
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
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {isModified && (
          isConfirmingRestore ? (
            <ConfirmButton type="restore" onConfirm={onRestore} onCancel={() => {}} />
          ) : (
            <RestoreIcon onClick={onRestore} />
          )
        )}

        <EditButton onClick={onEdit} />

        {isConfirmingDelete ? (
          <ConfirmButton type="delete" onConfirm={onDelete} onCancel={() => {}} />
        ) : (
          <DeleteIcon onClick={onDelete} />
        )}
      </div>
    </div>
  )
}

export function AgentsModal({ isOpen, onClose, initialEditId }: AgentsModalProps) {
  const agents = useAgentsStore(state => state.agents)
  const modifiedIds = useAgentsStore(state => state.modifiedIds)
  const loading = useAgentsStore(state => state.loading)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const fetchAgent = useAgentsStore(state => state.fetchAgent)
  const createAgent = useAgentsStore(state => state.createAgent)
  const updateAgent = useAgentsStore(state => state.updateAgent)
  const deleteAgentAction = useAgentsStore(state => state.deleteAgent)
  const restoreDefault = useAgentsStore(state => state.restoreDefault)
  const restoreAllDefaults = useAgentsStore(state => state.restoreAllDefaults)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSubagent, setFormSubagent] = useState(true)
  const [formTools, setFormTools] = useState<string[]>([])
  const [formColor, setFormColor] = useState('#6b7280')
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)
  const [confirmRestoreAll, setConfirmRestoreAll] = useState(false)
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

  const populateFormFromAgent = (agent: AgentFull, clearError = false) => {
    setFormName(agent.metadata.name)
    setFormId(agent.metadata.id)
    setFormDescription(agent.metadata.description)
    setFormSubagent(agent.metadata.subagent)
    setFormTools(agent.metadata.allowedTools)
    setFormColor(agent.metadata.color ?? '#6b7280')
    setFormPrompt(agent.prompt)
    if (clearError) setFormError('')
  }

  useEffect(() => {
    if (isOpen) {
      fetchAgents()
      authFetch('/api/tools').then(r => r.json()).then(d => setAvailableTools(d.tools || [])).catch(() => setAvailableTools([]))
      setConfirmDeleteId(null)
      setConfirmRestoreId(null)
      setConfirmRestoreAll(false)
      if (initialEditId) {
        setView('edit')
        setEditingId(initialEditId)
        setFormError('')
        fetchAgent(initialEditId).then(agent => {
          if (!agent) return
          populateFormFromAgent(agent)
        })
      } else {
        setView('list')
        setEditingId(null)
      }
    }
  }, [isOpen, fetchAgents, fetchAgent, initialEditId])

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
    setView('edit')
  }

  const handleEdit = async (agentId: string) => {
    const agent = await fetchAgent(agentId)
    if (!agent) return
    setEditingId(agentId)
    populateFormFromAgent(agent, true)
    setView('edit')
  }

  const handleDelete = async (agentId: string) => {
    await deleteAgentAction(agentId)
    setConfirmDeleteId(null)
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
    }
  }

  const handleNameChange = (name: string) => {
    setFormName(name)
    if (!editingId) {
      setFormId(toSlug(name))
    }
  }

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={handleCancel} title={editingId ? 'Edit Agent' : 'New Agent'} size="xl">
        <div className="flex flex-col h-full">
          <div className="space-y-3">
            {formError && <ErrorBanner message={formError} />}

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name" value={formName} onChange={handleNameChange} placeholder="My Agent" />
              <FormField label="ID" value={formId} onChange={setFormId} readOnly={!!editingId} placeholder="my_agent" hint={editingId ? '(read-only)' : undefined} mono />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Description" value={formDescription} onChange={setFormDescription} placeholder="What this agent does" />
              <div>
                <label className="block text-xs text-text-secondary mb-1">Type</label>
                <div className="flex items-center gap-3 h-[34px]">
                  <button
                    onClick={() => setFormSubagent(true)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      formSubagent
                        ? 'bg-accent-primary/25 text-accent-primary'
                        : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    Sub-agent
                  </button>
                  <button
                    onClick={() => setFormSubagent(false)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      !formSubagent
                        ? 'bg-accent-primary/25 text-accent-primary'
                        : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    Top-level
                  </button>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <label className="text-xs text-text-secondary">Color</label>
                    <input
                      type="color"
                      value={formColor}
                      onChange={e => setFormColor(e.target.value)}
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
                          : 'bg-bg-primary text-text-muted hover:text-text-secondary'
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
                        onClick={() => toggleTool(tool.name)}
                        className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors flex items-center gap-1 ${
                          isSelected
                            ? 'bg-accent-primary/25 text-accent-primary'
                            : 'bg-bg-primary text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        <span>{tool.name}</span>
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

          <div className="flex-1 min-h-[150px] mt-5 overflow-hidden">
            <label className="block text-xs text-text-secondary mb-1">Prompt</label>
            <textarea
              value={formPrompt}
              onChange={e => setFormPrompt(e.target.value)}
              placeholder="Instructions for this agent..."
              className="w-full h-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <ModalActions onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!formName || !formPrompt} />
        </div>
      </Modal>
    )
  }

  const subAgents = agents.filter(a => a.subagent)
  const topLevelAgents = agents.filter(a => !a.subagent)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agents" size="lg">
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Agents define behavior, tools, and prompts for top-level modes and sub-agents.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {modifiedIds.length > 0 && (
            confirmRestoreAll ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={async () => { await restoreAllDefaults(); setConfirmRestoreAll(false) }}
                  className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/30 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmRestoreAll(false)}
                  className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRestoreAll(true)}
                className="px-2 py-1 rounded text-xs text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                title="Restore all agents to defaults"
              >
                Restore Defaults
              </button>
            )
          )}
          <Button variant="primary" size="sm" onClick={handleNew}>
            + New
          </Button>
        </div>
      </div>

      {loading && agents.length === 0 ? (
        <div className="text-text-muted text-sm">Loading agents...</div>
      ) : agents.length === 0 ? (
        <div className="text-text-muted text-sm">No agents defined.</div>
      ) : (
        <div className="space-y-4">
          {topLevelAgents.length > 0 && (
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">Top-level</div>
              <div className="space-y-2">
                {topLevelAgents.map(agent => renderAgentListItem(
                  agent,
                  confirmDeleteId,
                  modifiedIds,
                  confirmRestoreId,
                  restoreDefault,
                  setConfirmRestoreId,
                  handleEdit,
                  handleDelete
                ))}
              </div>
            </div>
          )}

          {subAgents.length > 0 && (
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">Sub-agents</div>
              <div className="space-y-2">
                {subAgents.map(agent => renderAgentListItem(
                  agent,
                  confirmDeleteId,
                  modifiedIds,
                  confirmRestoreId,
                  restoreDefault,
                  setConfirmRestoreId,
                  handleEdit,
                  handleDelete
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}