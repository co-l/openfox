import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
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

interface SkillsModalProps {
  isOpen: boolean
  onClose: () => void
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function SkillsContent({ isOpen }: { isOpen: boolean }) {
  const skills = useSkillsStore(state => state.skills)
  const modifiedIds = useSkillsStore(state => state.modifiedIds)
  const loading = useSkillsStore(state => state.loading)
  const fetchSkills = useSkillsStore(state => state.fetchSkills)
  const toggleSkill = useSkillsStore(state => state.toggleSkill)
  const fetchSkill = useSkillsStore(state => state.fetchSkill)
  const createSkill = useSkillsStore(state => state.createSkill)
  const updateSkill = useSkillsStore(state => state.updateSkill)
  const deleteSkillAction = useSkillsStore(state => state.deleteSkill)
  const restoreDefault = useSkillsStore(state => state.restoreDefault)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formVersion, setFormVersion] = useState('1.0.0')
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const { requestDelete, requestRestore, requestRestoreAll, clearConfirm, isConfirming, isConfirmingRestoreAll } = useConfirmDialog()

  useEffect(() => {
    if (isOpen) {
      fetchSkills()
      setView('list')
      setEditingId(null)
      clearConfirm()
    }
  }, [isOpen, fetchSkills, clearConfirm])

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormDescription('')
    setFormVersion('1.0.0')
    setFormPrompt('')
    setFormError('')
    setView('edit')
  }

  const handleEdit = async (skillId: string) => {
    const skill = await fetchSkill(skillId)
    if (!skill) return
    setEditingId(skillId)
    setFormName(skill.metadata.name)
    setFormId(skill.metadata.id)
    setFormDescription(skill.metadata.description)
    setFormVersion(skill.metadata.version)
    setFormPrompt(skill.prompt)
    setFormError('')
    setView('edit')
  }

  const handleDelete = async (skillId: string) => {
    await deleteSkillAction(skillId)
    clearConfirm()
  }

  const handleSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName || !formPrompt) {
      setFormError('Name and prompt are required.')
      return
    }

    setSaving(true)
    setFormError('')

    const skill: SkillFull = {
      metadata: { id, name: formName, description: formDescription, version: formVersion || '1.0.0' },
      prompt: formPrompt,
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

  const handleCancel = () => {
    setView('list')
  }

  const handleNameChange = (name: string) => {
    setFormName(name)
    if (!editingId) {
      setFormId(toSlug(name))
    }
  }

  if (view === 'edit') {
    return (
      <div className="flex flex-col h-full">
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={handleCancel}
              className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title="Back to list"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium text-text-primary">{editingId ? 'Edit Skill' : 'New Skill'}</span>
          </div>

          {formError && <ErrorBanner message={formError} />}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" value={formName} onChange={handleNameChange} placeholder="My Skill" />
            <FormField label="ID" value={formId} onChange={setFormId} readOnly={!!editingId} placeholder="my-skill" hint={editingId ? '(read-only)' : undefined} mono />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Description" value={formDescription} onChange={setFormDescription} placeholder="Short description of what this skill provides" />
            <FormField label="Version" value={formVersion} onChange={setFormVersion} placeholder="1.0.0" mono />
          </div>
        </div>

        <FormTextArea
          label="Prompt"
          value={formPrompt}
          onChange={setFormPrompt}
          placeholder="Instructions the agent receives when this skill is loaded..."
          className="flex-1 min-h-[150px] mt-3 overflow-hidden"
        />

        <ModalActions onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!formName || !formPrompt} />
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
        <div className="text-text-muted text-sm">No skills installed.</div>
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
                  <span className="text-text-muted text-xs">v{skill.version}</span>
                  {modifiedIds.includes(skill.id) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400">modified</span>
                  )}
                </div>
                <p className="text-text-secondary text-xs mt-0.5 truncate">{skill.description}</p>
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

                <button
                  onClick={() => toggleSkill(skill.id)}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ml-1 ${
                    skill.enabled ? 'bg-accent-primary' : 'bg-bg-primary'
                  }`}
                  title={skill.enabled ? 'Disable skill' : 'Enable skill'}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      skill.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SkillsModal({ isOpen, onClose }: SkillsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Skills" size="lg">
      <SkillsContent isOpen={isOpen} />
    </Modal>
  )
}