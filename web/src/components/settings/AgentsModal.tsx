import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { useAgentsStore, type AgentFull } from '../../stores/agents'

interface AgentsModalProps {
  isOpen: boolean
  onClose: () => void
}

const ALL_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'run_command',
  'glob', 'grep', 'git', 'ask_user', 'web_fetch',
  'complete_criterion', 'pass_criterion', 'fail_criterion',
  'get_criteria', 'add_criterion', 'update_criterion', 'remove_criterion',
  'todo_write', 'call_sub_agent', 'load_skill',
]

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export function AgentsModal({ isOpen, onClose }: AgentsModalProps) {
  const agents = useAgentsStore(state => state.agents)
  const loading = useAgentsStore(state => state.loading)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const fetchAgent = useAgentsStore(state => state.fetchAgent)
  const createAgent = useAgentsStore(state => state.createAgent)
  const updateAgent = useAgentsStore(state => state.updateAgent)
  const deleteAgentAction = useAgentsStore(state => state.deleteAgent)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSubagent, setFormSubagent] = useState(true)
  const [formTools, setFormTools] = useState<string[]>([])
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchAgents()
      setView('list')
      setEditingId(null)
      setConfirmDeleteId(null)
    }
  }, [isOpen, fetchAgents])

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormDescription('')
    setFormSubagent(true)
    setFormTools(['read_file'])
    setFormPrompt('')
    setFormError('')
    setView('edit')
  }

  const handleEdit = async (agentId: string) => {
    const agent = await fetchAgent(agentId)
    if (!agent) return
    setEditingId(agentId)
    setFormName(agent.metadata.name)
    setFormId(agent.metadata.id)
    setFormDescription(agent.metadata.description)
    setFormSubagent(agent.metadata.subagent)
    setFormTools(agent.metadata.tools)
    setFormPrompt(agent.prompt)
    setFormError('')
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
        tools: formTools,
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

    setView('list')
  }

  const handleCancel = () => {
    setView('list')
  }

  const handleNameChange = (name: string) => {
    setFormName(name)
    if (!editingId) {
      setFormId(toSlug(name))
    }
  }

  const toggleTool = (tool: string) => {
    setFormTools(prev =>
      prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]
    )
  }

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={handleCancel} title={editingId ? 'Edit Agent' : 'New Agent'} size="lg">
        <div className="space-y-3">
          {formError && (
            <div className="text-accent-error text-sm px-3 py-2 bg-accent-error/10 rounded">{formError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Name</label>
              <input
                value={formName}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="My Agent"
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">ID {editingId && <span className="text-text-muted">(read-only)</span>}</label>
              <input
                value={formId}
                onChange={e => !editingId && setFormId(e.target.value)}
                readOnly={!!editingId}
                placeholder="my_agent"
                className={`w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary ${editingId ? 'opacity-60' : ''}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Description</label>
              <input
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="What this agent does"
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
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
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Tools</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-bg-tertiary border border-border rounded max-h-24 overflow-y-auto">
              {ALL_TOOLS.map(tool => (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors ${
                    formTools.includes(tool)
                      ? 'bg-accent-primary/25 text-accent-primary'
                      : 'bg-bg-primary text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Prompt</label>
            <textarea
              value={formPrompt}
              onChange={e => setFormPrompt(e.target.value)}
              placeholder="Instructions for this agent..."
              className="w-full h-64 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !formName || !formPrompt}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  const subAgents = agents.filter(a => a.subagent)
  const topLevelAgents = agents.filter(a => !a.subagent)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agents" size="md">
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Agents define behavior, tools, and prompts for top-level modes and sub-agents.
        </p>
        <Button variant="primary" size="sm" onClick={handleNew} className="flex-shrink-0 ml-3">
          + New
        </Button>
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
                {topLevelAgents.map(agent => (
                  <AgentListItem
                    key={agent.id}
                    agent={agent}
                    confirmDeleteId={confirmDeleteId}
                    onEdit={() => handleEdit(agent.id)}
                    onDelete={() => handleDelete(agent.id)}
                    onConfirmDelete={() => setConfirmDeleteId(agent.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                ))}
              </div>
            </div>
          )}

          {subAgents.length > 0 && (
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1.5">Sub-agents</div>
              <div className="space-y-2">
                {subAgents.map(agent => (
                  <AgentListItem
                    key={agent.id}
                    agent={agent}
                    confirmDeleteId={confirmDeleteId}
                    onEdit={() => handleEdit(agent.id)}
                    onDelete={() => handleDelete(agent.id)}
                    onConfirmDelete={() => setConfirmDeleteId(agent.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function AgentListItem({
  agent,
  confirmDeleteId,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  agent: { id: string; name: string; description: string; tools: string[] }
  confirmDeleteId: string | null
  onEdit: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary">
      <div className="min-w-0 flex-1 mr-3">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-sm font-medium">{agent.name}</span>
          <span className="text-text-muted text-xs font-mono">{agent.id}</span>
        </div>
        {agent.description && (
          <p className="text-text-secondary text-xs mt-0.5 truncate">{agent.description}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-1">
          {agent.tools.slice(0, 5).map(tool => (
            <span key={tool} className="text-[10px] font-mono text-text-muted bg-bg-primary px-1 py-0.5 rounded">
              {tool}
            </span>
          ))}
          {agent.tools.length > 5 && (
            <span className="text-[10px] text-text-muted">+{agent.tools.length - 5} more</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors"
          title="Edit agent"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {confirmDeleteId === agent.id ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              className="px-1.5 py-0.5 rounded bg-accent-error/20 text-accent-error text-xs hover:bg-accent-error/30 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={onCancelDelete}
              className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onConfirmDelete}
            className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-accent-error transition-colors"
            title="Delete agent"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
