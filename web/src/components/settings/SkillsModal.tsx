import { useEffect } from 'react'
import { EditButton } from '../shared/IconButton'
import { useSkillsStore, type SkillFull } from '../../stores/skills'
import {
  useConfirmDialog,
  ConfirmButton,
  DeleteIcon,
  RestoreIcon,
  FormField,
  FormTextArea,
  ModalActions,
  ErrorBanner,
} from './CRUDModal'
import { CRUDListHeader } from './CRUDListHeader'
import { NameIdFields } from './FormFields'
import { useCRUDForm } from './useCRUDForm'

type SkillFormData = {
  name: string
  id: string
  description: string
  version: string
  prompt: string
  [key: string]: unknown
}

export function SkillsContent({ isOpen }: { isOpen: boolean }) {
  const skills = useSkillsStore(state => state.skills)
  const modifiedIds = useSkillsStore(state => state.modifiedIds)
  const loading = useSkillsStore(state => state.loading)
  const fetchSkills = useSkillsStore(state => state.fetchSkills)
  const fetchSkill = useSkillsStore(state => state.fetchSkill)
  const createSkill = useSkillsStore(state => state.createSkill)
  const updateSkill = useSkillsStore(state => state.updateSkill)
  const deleteSkillAction = useSkillsStore(state => state.deleteSkill)
  const restoreDefault = useSkillsStore(state => state.restoreDefault)

  const {
    view,
    editingId,
    formError,
    saving,
    formData,
    setView,
    setEditingId,
    setFormError,
    setFormData,
    setSaving,
  } = useCRUDForm<SkillFormData>()

  const { requestDelete, requestRestore, requestRestoreAll, clearConfirm, isConfirming, isConfirmingRestoreAll } = useConfirmDialog()

  useEffect(() => {
    if (isOpen) {
      fetchSkills()
      setView('list')
      setEditingId(null)
      clearConfirm()
    }
  }, [isOpen, fetchSkills, clearConfirm, setView, setEditingId])

  const handleNew = () => {
    setFormData({ name: '', id: '', description: '', version: '1.0.0', prompt: '' })
    setView('edit')
  }

  const handleEdit = async (skillId: string) => {
    const skill = await fetchSkill(skillId)
    if (!skill) return
    setEditingId(skillId)
    setFormData({
      name: skill.metadata.name,
      id: skill.metadata.id,
      description: skill.metadata.description ?? '',
      version: skill.metadata.version ?? '1.0.0',
      prompt: skill.prompt,
    })
    setFormError('')
    setView('edit')
  }

  const handleDelete = async (skillId: string) => {
    await deleteSkillAction(skillId)
    clearConfirm()
  }

  const handleSave = async () => {
    const id = editingId ?? formData.id
    if (!id || !formData.name || !formData.prompt) {
      setFormError('Name, ID, and prompt are required.')
      return
    }

    setSaving(true)
    setFormError('')

    const skill: SkillFull = {
      metadata: {
        id,
        name: formData.name,
        description: formData.description,
        version: formData.version,
      },
      prompt: formData.prompt,
    }

    const result = editingId
      ? await updateSkill(editingId, skill)
      : await createSkill(skill)

    setSaving(false)

    if (!result.success) {
      setFormError(result.error ?? 'Failed to save skill.')
      return
    }

    setView('list')
  }

  const handleNameChange = (name: string) => {
    setFormData(prev => ({ ...prev, name }))
    if (!editingId) {
      setFormData(prev => ({ ...prev, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))
    }
  }

  if (view === 'edit') {
    return (
      <div>
        <div className="mb-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-text-primary">{editingId ? 'Edit Skill' : 'New Skill'}</h2>
          <button onClick={() => setView('list')} className="text-text-muted hover:text-text-primary">Cancel</button>
        </div>

        {formError && <ErrorBanner message={formError} />}

        <div className="space-y-3">
          <NameIdFields
            name={formData.name as string}
            id={formData.id as string}
            nameLabel="Name"
            idLabel="ID"
            namePlaceholder="My Skill"
            idPlaceholder="my-skill"
            readOnlyId={!!editingId}
            onNameChange={handleNameChange}
            onIdChange={(id: string) => setFormData(prev => ({ ...prev, id }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Description"
              value={formData.description as string}
              onChange={description => setFormData(prev => ({ ...prev, description }))}
              placeholder="What this skill does..."
            />
            <FormField
              label="Version"
              value={formData.version as string}
              onChange={version => setFormData(prev => ({ ...prev, version }))}
              placeholder="1.0.0"
            />
          </div>

          <FormTextArea
            label="Prompt"
            value={formData.prompt}
            onChange={prompt => setFormData(prev => ({ ...prev, prompt }))}
            placeholder="The system prompt for this skill..."
            className="h-48"
          />

          <ModalActions onCancel={() => setView('list')} onSave={handleSave} saving={saving} saveDisabled={!formData.name || !formData.id || !formData.prompt} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <CRUDListHeader
        description="Skills provide domain-specific knowledge that agents can load on demand."
        modifiedCount={modifiedIds.length}
        onRestoreAll={requestRestoreAll}
        isConfirmingRestoreAll={isConfirmingRestoreAll()}
        onCancelRestoreAll={clearConfirm}
        onNew={handleNew}
      />

      {loading && skills.length === 0 ? (
        <div className="text-text-muted text-sm">Loading skills...</div>
      ) : skills.length === 0 ? (
        <div className="text-text-muted text-sm">No skills created yet.</div>
      ) : (
        <div className="space-y-2">
          {skills.map(skill => (
            <div
              key={skill.id}
              className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
            >
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2">
                  <span className="text-text-primary text-sm font-medium">{skill.name}</span>
                  {modifiedIds.includes(skill.id) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400">modified</span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-text-muted text-xs truncate">{skill.description}</p>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {modifiedIds.includes(skill.id) && (
                  isConfirming(skill.id, 'restore') ? (
                    <ConfirmButton type="restore" onConfirm={() => restoreDefault(skill.id).then(clearConfirm)} onCancel={clearConfirm} />
                  ) : (
                    <RestoreIcon onClick={() => requestRestore(skill.id)} />
                  )
                )}

                <EditButton onClick={() => handleEdit(skill.id)} />

                {isConfirming(skill.id, 'delete') ? (
                  <ConfirmButton type="delete" onConfirm={() => handleDelete(skill.id)} onCancel={clearConfirm} />
                ) : (
                  <DeleteIcon onClick={() => requestDelete(skill.id)} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}