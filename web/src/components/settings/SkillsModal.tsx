import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { EditButton } from '../shared/IconButton'
import { useSkillsStore, type SkillFull } from '../../stores/skills'

interface SkillsModalProps {
  isOpen: boolean
  onClose: () => void
}

interface SkillsContentProps {
  isOpen: boolean
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Standalone skills content for embedding as a tab in another modal. */
export function SkillsContent({ isOpen }: SkillsContentProps) {
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
  const restoreAllDefaults = useSkillsStore(state => state.restoreAllDefaults)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formVersion, setFormVersion] = useState('1.0.0')
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)
  const [confirmRestoreAll, setConfirmRestoreAll] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchSkills()
      setView('list')
      setEditingId(null)
      setConfirmDeleteId(null)
      setConfirmRestoreId(null)
      setConfirmRestoreAll(false)
    }
  }, [isOpen, fetchSkills])

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

          {formError && (
            <div className="text-accent-error text-sm px-3 py-2 bg-accent-error/10 rounded">{formError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Name</label>
              <input
                value={formName}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="My Skill"
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">ID {editingId && <span className="text-text-muted">(read-only)</span>}</label>
              <input
                value={formId}
                onChange={e => !editingId && setFormId(e.target.value)}
                readOnly={!!editingId}
                placeholder="my-skill"
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
                placeholder="Short description of what this skill provides"
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Version</label>
              <input
                value={formVersion}
                onChange={e => setFormVersion(e.target.value)}
                placeholder="1.0.0"
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-[150px] mt-3 overflow-hidden">
          <label className="block text-xs text-text-secondary mb-1">Prompt</label>
          <textarea
            value={formPrompt}
            onChange={e => setFormPrompt(e.target.value)}
            placeholder="Instructions the agent receives when this skill is loaded..."
            className="w-full h-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 mt-5 border-t border-border flex-shrink-0">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !formName || !formPrompt}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Skills provide domain-specific knowledge that agents can load on demand.
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
                title="Restore all skills to defaults"
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
                {/* Restore default button — only shown when modified */}
                {modifiedIds.includes(skill.id) && (
                  confirmRestoreId === skill.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={async () => { await restoreDefault(skill.id); setConfirmRestoreId(null) }}
                        className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/30 transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => setConfirmRestoreId(null)}
                        className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRestoreId(skill.id)}
                      className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-amber-400 transition-colors"
                      title="Restore default"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )
                )}

                <EditButton onClick={() => handleEdit(skill.id)} />

                {/* Delete button */}
                {confirmDeleteId === skill.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(skill.id)}
                      className="px-1.5 py-0.5 rounded bg-accent-error/20 text-accent-error text-xs hover:bg-accent-error/30 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-1.5 py-0.5 rounded text-text-muted text-xs hover:bg-bg-primary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(skill.id)}
                    className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-accent-error transition-colors"
                    title="Delete skill"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}

                {/* Toggle */}
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
