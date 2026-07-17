import { useEffect, useState } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { useAgentsStore, type AgentFull, type AgentModelRef } from '../../stores/agents'
import { useConfigStore } from '../../stores/config'
import { authFetch } from '../../lib/api'
import { CRUDListHeader, ErrorBanner } from './CRUDModal'
import { AgentGroup } from './agents/AgentListItem'
import { AgentForm } from './agents/AgentForm'

interface AgentsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function AgentsModal({ isOpen, onClose, initialEditId }: AgentsModalProps) {
  const defaults = useAgentsStore((state) => state.defaults)
  const userItems = useAgentsStore((state) => state.userItems)
  const overrideIds = useAgentsStore((state) => state.overrideIds)
  const loading = useAgentsStore((state) => state.loading)
  const fetchAgents = useAgentsStore((state) => state.fetchAgents)
  const fetchAgent = useAgentsStore((state) => state.fetchAgent)
  const fetchDefaultContent = useAgentsStore((state) => state.fetchDefaultContent)
  const createAgent = useAgentsStore((state) => state.createAgent)
  const updateAgent = useAgentsStore((state) => state.updateAgent)
  const deleteAgentAction = useAgentsStore((state) => state.deleteAgent)
  const providers = useConfigStore((state) => state.providers)
  const fetchConfig = useConfigStore((state) => state.fetchConfig)

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
  const [formModelCascade, setFormModelCascade] = useState<AgentModelRef[] | undefined>()
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [availableTools, setAvailableTools] = useState<{ name: string; actions: string[]; topLevelOnly?: boolean }[]>(
    [],
  )
  const [alwaysAllowedNames, setAlwaysAllowedNames] = useState<Set<string>>(new Set())

  const populateFormFromAgent = (agent: AgentFull) => {
    setFormName(agent.metadata.name)
    setFormId(agent.metadata.id)
    setFormDescription(agent.metadata.description)
    setFormSubagent(agent.metadata.subagent)
    setFormTools(agent.metadata.allowedTools)
    setFormColor(agent.metadata.color ?? '#6b7280')
    setFormPrompt(agent.prompt)
    setFormModelCascade(agent.metadata.modelCascade ?? undefined)
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
    setFormModelCascade(content.metadata.modelCascade ?? undefined)
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
      fetchConfig()
      authFetch('/api/tools')
        .then((r) => r.json())
        .then((d) => {
          const tools: { name: string; actions: string[]; alwaysAllowed?: boolean; topLevelOnly?: boolean }[] =
            d.tools || []
          setAlwaysAllowedNames(new Set(tools.filter((t) => t.alwaysAllowed).map((t) => t.name)))
          setAvailableTools(tools.filter((t) => !t.alwaysAllowed))
        })
        .catch(() => {
          setAvailableTools([])
          setAlwaysAllowedNames(new Set())
        })

      if (initialEditId) {
        fetchDefaultContent(initialEditId).then((content) => {
          if (content) {
            applyViewFromContent(content, initialEditId)
            return
          }
          fetchAgent(initialEditId).then((agent) => {
            if (!agent) return
            populateFormFromAgent(agent)
            setEditingId(initialEditId)
            setIsReadOnly(false)
            setView('edit')
          })
        })
      } else {
        setView('list')
        setEditingId(null)
        setIsReadOnly(false)
      }
    }
  }, [isOpen, fetchAgents, fetchAgent, fetchDefaultContent, initialEditId])

  const handleView = async (agentId: string) => {
    const isDefault = defaults.some((d) => d.id === agentId)
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
    const isDefault = defaults.some((agent) => agent.id === agentId)
    const content = isDefault ? await fetchDefaultContent(agentId) : await fetchAgent(agentId)
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
    setFormModelCascade(undefined)
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
    const result = await deleteAgentAction(agentId)
    if (!result.success) setFormError(result.error ?? 'Failed to reset agent override.')
  }

  const handleSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName || !formPrompt) {
      setFormError('Name and prompt are required.')
      return
    }
    if (!editingId && defaults.some((agent) => agent.id === id)) {
      setFormError('This ID belongs to a built-in agent. Choose a different name.')
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
        allowedTools: formTools.filter((t) => !alwaysAllowedNames.has(t)),
        color: formColor,
        modelCascade: formModelCascade?.length ? formModelCascade : null,
      },
      prompt: formPrompt,
    }

    const result = editingId ? await updateAgent(editingId, agent) : await createAgent(agent)

    setSaving(false)

    if (!result.success) {
      setFormError(result.error ?? 'Failed to save agent.')
      return
    }

    if (initialEditId) onClose()
    else setView('list')
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

  const defaultSubAgents = defaults.filter((a) => a.subagent)
  const defaultTopLevelAgents = defaults.filter((a) => !a.subagent)
  const customItems = userItems.filter((agent) => !overrideIds.includes(agent.id))
  const userSubAgents = customItems.filter((a) => a.subagent)
  const userTopLevelAgents = customItems.filter((a) => !a.subagent)

  if (view === 'edit') {
    return (
      <Modal
        isOpen={isOpen}
        onClose={handleCancel}
        title={isReadOnly ? `${formName}` : editingId ? 'Edit Agent' : 'New Agent'}
        size="xl"
      >
        <AgentForm
          formName={formName}
          formId={formId}
          formDescription={formDescription}
          formSubagent={formSubagent}
          formTools={formTools}
          formColor={formColor}
          formPrompt={formPrompt}
          formError={formError}
          saving={saving}
          isReadOnly={isReadOnly}
          availableTools={availableTools}
          providers={providers}
          modelCascade={formModelCascade}
          onModelCascadeChange={setFormModelCascade}
          onNameChange={handleNameChange}
          onIdChange={setFormId}
          onDescriptionChange={setFormDescription}
          onSubagentChange={(subagent) => {
            setFormSubagent(subagent)
            if (subagent) {
              setFormTools((prev) => prev.filter((t) => !availableTools.find((at) => at.name === t)?.topLevelOnly))
            }
          }}
          onToolsChange={setFormTools}
          onColorChange={setFormColor}
          onPromptChange={setFormPrompt}
          onSave={handleSave}
          onCancel={handleCancel}
          onDuplicate={() => {
            setFormName(formName + ' (copy)')
            setFormId(`${editingId}-copy-${Date.now()}`)
            setEditingId(null)
            setIsReadOnly(false)
          }}
        />
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agents" size="lg">
      <CRUDListHeader
        description="Agents define behavior, tools, and prompts for top-level modes and sub-agents."
        onNew={handleNew}
        loading={loading}
        hasItems={defaults.length > 0 || userItems.length > 0}
      >
        <div className="space-y-4">
          {formError && <ErrorBanner message={formError} />}
          {defaults.length > 0 && (
            <AgentGroup
              title="Built-in"
              agents={defaultTopLevelAgents}
              subagents={defaultSubAgents}
              isBuiltIn={true}
              alwaysAllowedNames={alwaysAllowedNames}
              onView={handleView}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              canDelete={(agentId) => overrideIds.includes(agentId)}
            />
          )}

          {userItems.length > 0 && (
            <AgentGroup
              title="Custom"
              agents={userTopLevelAgents}
              subagents={userSubAgents}
              isBuiltIn={false}
              alwaysAllowedNames={alwaysAllowedNames}
              onView={handleView}
              onDuplicate={handleDuplicate}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )}
        </div>
      </CRUDListHeader>
    </Modal>
  )
}
