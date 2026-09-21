import { useEffect, useState } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { createAgent, updateAgent, deleteAgent, type AgentFull } from '../../lib/agents-actions'
import { authFetch } from '../../lib/api'
import { useResource } from '../../hooks/useResource'
import { useProviders } from '../../hooks/useProviders'
import { agentsResource, agentResource, agentDefaultResource, readProviders } from '../../lib/resources'
import { CRUDListHeader, useConfirmDialog, DestinationSelector, ModalActions } from './CRUDModal'
import { AgentGroup } from './agents/AgentListItem'
import { AgentForm } from './agents/AgentForm'
import { ModelPicker } from '../shared/ModelPicker'
import { PluginZone } from '../plugins/PluginZone'
import { parseModelValue } from '../../lib/model-value'
import { useT } from '../../hooks/useT'

interface AgentsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
  /** Project root workdir this modal was opened from — scopes project agents shown and saved. */
  projectDir?: string
}

function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return slug ? `custom-${slug}` : ''
}

export function AgentsModal({ isOpen, onClose, initialEditId, projectDir }: AgentsModalProps) {
  const t = useT()
  const { data, loading } = useResource(agentsResource, projectDir)
  const defaults = data?.defaults ?? []
  const userItems = data?.userItems ?? []
  const projectItems = data?.projectItems ?? []
  const modelOverrides = data?.modelOverrides ?? {}

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isReadOnly, setIsReadOnly] = useState(false)

  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSubagent, setFormSubagent] = useState(false)
  const [formTools, setFormTools] = useState<string[]>([])
  const [formColor, setFormColor] = useState('#6b7280')
  const [formModel, setFormModel] = useState<string | undefined>(undefined)
  const [formPrompt, setFormPrompt] = useState('')
  const [formDestination, setFormDestination] = useState<'project' | 'user'>('user')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingModel, setLoadingModel] = useState(false)

  const [modelModalAgentId, setModelModalAgentId] = useState<string | null>(null)

  const [availableTools, setAvailableTools] = useState<{ name: string; actions: string[]; topLevelOnly?: boolean }[]>(
    [],
  )
  const [alwaysAllowedNames, setAlwaysAllowedNames] = useState<Set<string>>(new Set())
  const { requestDelete, clearConfirm, isConfirming } = useConfirmDialog()

  const populateFormFromAgent = (agent: AgentFull) => {
    setFormName(agent.metadata.name)
    setFormId(agent.metadata.id)
    setFormDescription(agent.metadata.description)
    setFormSubagent(agent.metadata.subagent)
    setFormTools(agent.metadata.allowedTools)
    setFormColor(agent.metadata.color ?? '#6b7280')
    setFormPrompt(agent.prompt)
    setFormError('')
    setLoadingModel(true)
    // Fetch model override
    // Authorized transient read: per-agent model override is a one-shot form load.
    authFetch(`/api/agents/${agent.metadata.id}/model`)
      .then((r) => r.json())
      .then((data) => {
        if (data.providerId && data.model) {
          const effort = data.reasoningEffort ? `:${data.reasoningEffort}` : ''
          setFormModel(`${data.providerId}/${data.model}${effort}`)
        } else {
          setFormModel(undefined)
        }
      })
      .catch(() => setFormModel(undefined))
      .finally(() => setLoadingModel(false))
  }

  const applyDuplicateFromContent = (content: AgentFull, id: string, setAsNew: boolean) => {
    setFormName(content.metadata.name + ' ' + t({ en: '(copy)', fr: '(copie)' }))
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
      // Authorized transient read: tools list is a one-shot modal load.
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
        const isDefault = defaults.some((d) => d.id === initialEditId)
        if (isDefault) {
          agentDefaultResource.refresh(initialEditId).then((content) => {
            if (!content) return
            applyDuplicateFromContent(content, initialEditId, true)
          })
        } else {
          agentResource.refresh(initialEditId, projectDir).then((agent) => {
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
  }, [isOpen, initialEditId, projectDir])

  const handleView = async (agentId: string) => {
    const isDefault = defaults.some((d) => d.id === agentId)
    if (isDefault) {
      const content = await agentDefaultResource.refresh(agentId)
      if (!content) return
      applyViewFromContent(content, agentId)
    } else {
      const agent = await agentResource.refresh(agentId, projectDir)
      if (!agent) return
      applyViewFromContent(agent, agentId)
    }
  }

  const handleDuplicate = async (agentId: string) => {
    let content = await agentDefaultResource.refresh(agentId)
    if (!content) {
      content = await agentResource.refresh(agentId, projectDir)
    }
    if (!content) return
    applyDuplicateFromContent(content, agentId, true)
  }

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormDescription('')
    setFormSubagent(false)
    setFormTools(['read_file'])
    setFormColor('#6b7280')
    setFormPrompt('')
    setFormDestination('user')
    setFormError('')
    setIsReadOnly(false)
    setView('edit')
  }

  const handleEdit = async (agentId: string) => {
    const agent = await agentResource.refresh(agentId, projectDir)
    if (!agent) return
    populateFormFromAgent(agent)
    setEditingId(agentId)
    setIsReadOnly(false)
    setView('edit')
  }

  const handleEditBuiltInModel = (agentId: string) => {
    setModelModalAgentId(agentId)
  }

  const handleDelete = async (agentId: string) => {
    await deleteAgent(agentId, projectDir)
  }

  const handleSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName || !formPrompt) {
      setFormError(t({ en: 'Name and prompt are required.', fr: 'Le nom et l’invite sont requis.' }))
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
      },
      prompt: formPrompt,
    }

    const result = editingId
      ? await updateAgent(editingId, agent, projectDir)
      : await createAgent(agent, formDestination, projectDir)

    if (!result.success) {
      setSaving(false)
      setFormError(result.error ?? t({ en: 'Failed to save agent.', fr: 'Échec de l’enregistrement de l’agent.' }))
      return
    }

    // Save model override separately
    await saveAgentModelOverride(editingId ?? formId, formModel)

    // Re-fetch agents so the list reflects the updated model override badge
    await agentsResource.refresh(projectDir)

    setSaving(false)

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
  const userSubAgents = userItems.filter((a) => a.subagent)
  const userTopLevelAgents = userItems.filter((a) => !a.subagent)
  const projectSubAgents = projectItems.filter((a) => a.subagent)
  const projectTopLevelAgents = projectItems.filter((a) => !a.subagent)

  if (view === 'edit') {
    return (
      <>
        <Modal
          isOpen={isOpen}
          onClose={handleCancel}
          title={
            isReadOnly
              ? `${formName}`
              : editingId
                ? t({ en: 'Edit Agent', fr: 'Modifier l’agent' })
                : t({ en: 'New Agent', fr: 'Nouvel agent' })
          }
          size="xl"
          footer={
            isReadOnly ? (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setFormName(formName + ' ' + t({ en: '(copy)', fr: '(copie)' }))
                    setFormId(`${editingId}-copy-${Date.now()}`)
                    setEditingId(null)
                    setIsReadOnly(false)
                  }}
                  className="px-3 py-1.5 rounded bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 transition-colors"
                >
                  {t({ en: 'Duplicate & Customize', fr: 'Dupliquer et personnaliser' })}
                </button>
              </div>
            ) : (
              <ModalActions
                onCancel={handleCancel}
                onSave={handleSave}
                saving={saving}
                saveDisabled={!formName || !formPrompt || loadingModel}
              />
            )
          }
        >
          {!editingId && !isReadOnly && <DestinationSelector value={formDestination} onChange={setFormDestination} />}
          <AgentForm
            formName={formName}
            formId={formId}
            formDescription={formDescription}
            formSubagent={formSubagent}
            formTools={formTools}
            formColor={formColor}
            formModel={formModel}
            formPrompt={formPrompt}
            formError={formError}
            isReadOnly={isReadOnly}
            availableTools={availableTools}
            providers={readProviders()?.providers ?? []}
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
            onModelChange={setFormModel}
            onPromptChange={setFormPrompt}
          />
        </Modal>
        <BuiltInModelModal
          agentId={modelModalAgentId}
          onClose={() => setModelModalAgentId(null)}
          projectDir={projectDir}
          onSaved={() => void agentsResource.refresh(projectDir)}
        />
      </>
    )
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={t({ en: 'Agents', fr: 'Agents' })} size="lg">
        <PluginZone id="agents.modal" context={{ projectDir }}>
          <CRUDListHeader
            description={t({
              en: 'Agents define behavior, tools, and prompts for top-level modes and sub-agents.',
              fr: 'Les agents définissent le comportement, les outils et les invites des modes principaux et des sous-agents.',
            })}
            onNew={handleNew}
            loading={loading}
            hasItems={defaults.length > 0 || userItems.length > 0 || projectItems.length > 0}
          >
            <div className="space-y-4">
              {defaults.length > 0 && (
                <AgentGroup
                  title={t({ en: 'Built-in', fr: 'Intégrés' })}
                  agents={defaultTopLevelAgents}
                  subagents={defaultSubAgents}
                  isBuiltIn={true}
                  alwaysAllowedNames={alwaysAllowedNames}
                  modelOverrides={modelOverrides}
                  onView={handleView}
                  onEdit={handleEditBuiltInModel}
                  onDuplicate={handleDuplicate}
                />
              )}

              {(userTopLevelAgents.length > 0 ||
                userSubAgents.length > 0 ||
                projectTopLevelAgents.length > 0 ||
                projectSubAgents.length > 0) && (
                <div>
                  <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">
                    {t({ en: 'Custom', fr: 'Personnalisés' })}
                  </h3>
                  <div className="ml-3 space-y-3">
                    {[
                      {
                        title: t({ en: 'Global', fr: 'Global' }),
                        agents: userTopLevelAgents,
                        subagents: userSubAgents,
                      },
                      {
                        title: t({ en: 'Project', fr: 'Projet' }),
                        agents: projectTopLevelAgents,
                        subagents: projectSubAgents,
                      },
                    ].map(
                      (section) =>
                        (section.agents.length > 0 || section.subagents.length > 0) && (
                          <AgentGroup
                            key={section.title}
                            title={section.title}
                            agents={section.agents}
                            subagents={section.subagents}
                            isBuiltIn={false}
                            alwaysAllowedNames={alwaysAllowedNames}
                            modelOverrides={modelOverrides}
                            isConfirmingDelete={(id) => isConfirming(id, 'delete')}
                            onView={handleView}
                            onDuplicate={handleDuplicate}
                            onEdit={handleEdit}
                            onDelete={(id) => {
                              if (isConfirming(id, 'delete')) {
                                handleDelete(id)
                                clearConfirm()
                              } else {
                                requestDelete(id)
                              }
                            }}
                            onCancelDelete={clearConfirm}
                          />
                        ),
                    )}
                  </div>
                </div>
              )}
            </div>
          </CRUDListHeader>
        </PluginZone>
      </Modal>
      <BuiltInModelModal
        agentId={modelModalAgentId}
        onClose={() => setModelModalAgentId(null)}
        projectDir={projectDir}
        onSaved={() => void agentsResource.refresh(projectDir)}
      />
    </>
  )
}

function parseModelOverride(value: string): { providerId: string; model: string; reasoningEffort?: string } {
  return (
    parseModelValue(value) ?? {
      providerId: value,
      model: '',
    }
  )
}

async function saveAgentModelOverride(agentId: string, modelOverride: string | undefined): Promise<void> {
  if (modelOverride) {
    const { providerId, model, reasoningEffort } = parseModelOverride(modelOverride)
    await authFetch(`/api/agents/${agentId}/model`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }),
    })
  } else {
    await authFetch(`/api/agents/${agentId}/model`, { method: 'DELETE' })
  }
}

// Model-only modal for built-in agents — rendered outside the main component tree
function BuiltInModelModal({
  agentId,
  onClose,
  onSaved,
  projectDir,
}: {
  agentId: string | null
  onClose: () => void
  onSaved: () => void
  projectDir?: string
}) {
  const [value, setValue] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useT()
  const { data } = useResource(agentsResource, projectDir)
  const agents = data ? [...data.defaults, ...data.userItems, ...data.projectItems] : []
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined
  const providers = useProviders().providers

  useEffect(() => {
    if (!agentId) return
    setLoading(true)
    authFetch(`/api/agents/${agentId}/model`)
      .then((r) => r.json())
      .then((data) => {
        const effort = data.reasoningEffort ? `:${data.reasoningEffort}` : ''
        setValue(data.providerId && data.model ? `${data.providerId}/${data.model}${effort}` : undefined)
      })
      .catch(() => setValue(undefined))
      .finally(() => setLoading(false))
  }, [agentId])

  const handleSave = async () => {
    if (!agentId) return
    setSaving(true)
    setError(null)
    try {
      await saveAgentModelOverride(agentId, value)

      onSaved()
      onClose()
    } catch {
      setError(t({ en: 'Failed to save. Please try again.', fr: 'Échec de l’enregistrement. Veuillez réessayer.' }))
    }
    setSaving(false)
  }

  return (
    <Modal
      isOpen={!!agentId}
      onClose={onClose}
      title={t({ en: 'Model — {{name}}', fr: 'Modèle — {{name}}' }, { name: agent?.name ?? agentId ?? '' })}
      size="md"
    >
      <div className="space-y-4 p-2">
        <p className="text-xs text-text-muted">
          {t({
            en: 'Choose which model to use when this agent is active. This overrides the session/global model.',
            fr: 'Choisissez le modèle à utiliser lorsque cet agent est actif. Il remplace le modèle de session/global.',
          })}
        </p>
        {loading ? (
          <div className="text-sm text-text-muted py-2">{t({ en: 'Loading...', fr: 'Chargement...' })}</div>
        ) : (
          <ModelPicker
            providers={providers}
            value={value}
            onChange={setValue}
            defaultLabel={t({ en: 'Default (global model)', fr: 'Défaut (modèle global)' })}
          />
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 disabled:opacity-50 transition-colors"
          >
            {saving ? t({ en: 'Saving...', fr: 'Enregistrement...' }) : t({ en: 'Save', fr: 'Enregistrer' })}
          </button>
        </div>
      </div>
    </Modal>
  )
}
