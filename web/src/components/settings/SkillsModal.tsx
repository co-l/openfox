import { useEffect, useState } from 'react'
import { Button } from '../shared/Button'
import { useSkillsStore, type SkillFull, type SkillInfo } from '../../stores/skills'
import { useConfirmDialog, FormField, ErrorBanner } from './CRUDModal'
import { ItemsHeader } from '../shared/ItemsHeader'
import { CRUDListHeader } from './CRUDListHeader'
import { CRUDListView } from './CRUDListView'
import { NameIdFields } from './FormFields'
import { useCRUDForm } from './useCRUDForm'
import { SkillLibraryPanel } from './SkillLibraryPanel'
import { SkillListItem } from './SkillListItem'
import { SkillDeleteModal } from './SkillDeleteModal'
type SkillFormData = {
  name: string
  id: string
  description: string
  version: string
  prompt: string
  isReadOnly: boolean
  destination: 'project' | 'user'
  [key: string]: unknown
}

export function SkillsContent({ isOpen }: { isOpen: boolean }) {
  const defaults = useSkillsStore((state) => state.defaults)
  const userItems = useSkillsStore((state) => state.userItems)
  const projectItems = useSkillsStore((state) => state.projectItems)
  const items = useSkillsStore((state) => state.items)
  const selectedDirectory = useSkillsStore((state) => state.selectedDirectory)
  const diagnostics = useSkillsStore((state) => state.diagnostics)
  const loading = useSkillsStore((state) => state.loading)
  const fetchSkills = useSkillsStore((state) => state.fetchSkills)
  const fetchSkill = useSkillsStore((state) => state.fetchSkill)
  const fetchDefaultContent = useSkillsStore((state) => state.fetchDefaultContent)
  const createSkill = useSkillsStore((state) => state.createSkill)
  const updateSkill = useSkillsStore((state) => state.updateSkill)
  const deleteSkillAction = useSkillsStore((state) => state.deleteSkill)
  const selectDirectory = useSkillsStore((state) => state.selectDirectory)
  const removeDirectory = useSkillsStore((state) => state.removeDirectory)
  const installSkill = useSkillsStore((state) => state.installSkill)
  const toggleSkill = useSkillsStore((state) => state.toggleSkill)
  const [pendingDelete, setPendingDelete] = useState<SkillInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const { view, editingId, formError, saving, formData, setView, setEditingId, setFormError, setFormData, setSaving } =
    useCRUDForm<SkillFormData>()

  const { clearConfirm } = useConfirmDialog()

  useEffect(() => {
    if (isOpen) {
      fetchSkills()
      setView('list')
      setEditingId(null)
      clearConfirm()
    }
  }, [isOpen, fetchSkills, clearConfirm])

  const setSkillFormData = (skill: SkillFull, readOnly: boolean, newId?: string, newName?: string) => {
    setFormData({
      name: newName ?? skill.metadata.name,
      id: newId ?? skill.metadata.id,
      description: skill.metadata.description ?? '',
      version: skill.metadata.version ?? '1.0.0',
      prompt: skill.prompt,
      isReadOnly: readOnly,
      destination: 'user',
    })
  }

  const handleView = async (skillId: string) => {
    const isDefault = defaults.some((d) => d.id === skillId)
    if (isDefault) {
      const content = await fetchDefaultContent(skillId)
      if (!content) return
      setSkillFormData(content, true)
      setEditingId(skillId)
      setFormError('')
      setView('edit')
    } else {
      const skill = await fetchSkill(skillId)
      if (!skill) return
      setSkillFormData(skill, true)
      setEditingId(skillId)
      setFormError('')
      setView('edit')
    }
  }

  const handleDuplicate = async (skillId: string) => {
    const isDefault = defaults.some((d) => d.id === skillId)
    const content = isDefault ? await fetchDefaultContent(skillId) : await fetchSkill(skillId)
    if (!content) return
    const newId = `${skillId}-copy-${Date.now()}`
    setSkillFormData(content, false, newId, `${content.metadata.name} (copy)`)
    setEditingId(null)
    setFormError('')
    setView('edit')
  }

  const handleNew = () => {
    setFormData({
      name: '',
      id: '',
      description: '',
      version: '1.0.0',
      prompt: '',
      isReadOnly: false,
      destination: 'user',
    })
    setView('edit')
  }

  const handleEdit = async (skillId: string) => {
    const skill = await fetchSkill(skillId)
    if (!skill) return
    setSkillFormData(skill, false)
    setEditingId(skillId)
    setFormError('')
    setView('edit')
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError('')
    const result = await deleteSkillAction(pendingDelete.id)
    setDeleting(false)
    if (!result.success) {
      setDeleteError(result.error ?? 'Failed to delete skill.')
      return
    }
    await fetchSkills()
    setPendingDelete(null)
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
      : await createSkill(skill, formData.destination as 'project' | 'user')

    setSaving(false)

    if (!result.success) {
      setFormError(result.error ?? 'Failed to save skill.')
      return
    }

    setView('list')
  }

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({ ...prev, name }))
    if (!editingId) {
      setFormData((prev) => ({
        ...prev,
        id: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      }))
    }
  }

  const isReadOnly = formData.isReadOnly as boolean

  if (view === 'edit') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold text-text-primary">
            {isReadOnly ? formData.name : editingId ? 'Edit Skill' : 'New Skill'}
          </h2>
          <button onClick={() => setView('list')} className="text-text-muted hover:text-text-primary">
            Cancel
          </button>
        </div>

        {formError && <ErrorBanner message={formError} />}

        <div className="space-y-3 mb-3">
          <NameIdFields
            name={formData.name as string}
            id={formData.id as string}
            nameLabel="Name"
            idLabel="ID"
            namePlaceholder="My Skill"
            idPlaceholder="my-skill"
            readOnlyId={true}
            onNameChange={handleNameChange}
            onIdChange={() => {}}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Description"
              value={formData.description as string}
              onChange={(description) => setFormData((prev) => ({ ...prev, description }))}
              placeholder="What this skill does..."
              readOnly={isReadOnly}
            />
            <FormField
              label="Version"
              value={formData.version as string}
              onChange={(version) => setFormData((prev) => ({ ...prev, version }))}
              placeholder="1.0.0"
              readOnly={isReadOnly}
            />
          </div>
        </div>

        <div className="flex-1 min-h-[120px] border-t border-border pt-3 flex flex-col">
          <label className="block text-xs text-text-secondary mb-1">Prompt</label>
          <textarea
            value={formData.prompt}
            onChange={(e) => setFormData((prev) => ({ ...prev, prompt: e.target.value }))}
            readOnly={isReadOnly}
            placeholder="The system prompt for this skill..."
            className="h-80 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>

        {!editingId && (
          <div className="flex items-center gap-2 pt-2">
            <label className="text-xs text-text-secondary">Save to:</label>
            <select
              value={formData.destination as string}
              onChange={(e) => setFormData((prev) => ({ ...prev, destination: e.target.value as 'project' | 'user' }))}
              className="px-2 py-1 bg-bg-tertiary border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary"
            >
              <option value="user">Global config</option>
              <option value="project">Project (.openfox/)</option>
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border flex-shrink-0">
          <Button variant="secondary" onClick={() => setView('list')}>
            Cancel
          </Button>
          {isReadOnly ? (
            <Button
              variant="primary"
              onClick={() => {
                setFormData((prev) => ({
                  ...prev,
                  name: prev.name + ' (copy)',
                  id: `${editingId}-copy-${Date.now()}`,
                  isReadOnly: false,
                }))
                setEditingId(null)
              }}
            >
              Duplicate & Customize
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !formData.name || !formData.id || !formData.prompt}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    )
  }

  function EditableSkillItems({ items }: { items: SkillInfo[] }) {
    return items.map((skill) => (
      <SkillListItem
        key={skill.id}
        skill={skill}
        isBuiltIn={false}
        isConfirmingDelete={false}
        onView={() => handleView(skill.id)}
        onEdit={() => handleEdit(skill.id)}
        onDuplicate={() => handleDuplicate(skill.id)}
        onDelete={() => {
          setDeleteError('')
          setPendingDelete(skill)
        }}
        onToggle={() => toggleSkill(skill.id)}
        readOnly={skill.readOnly}
      />
    ))
  }

  return (
    <div>
      <SkillDeleteModal
        skill={pendingDelete}
        deleting={deleting}
        error={deleteError}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={handleDelete}
      />
      <SkillLibraryPanel
        selectedDirectory={selectedDirectory}
        onSelect={selectDirectory}
        onRemove={removeDirectory}
        onRefresh={fetchSkills}
        onInstall={installSkill}
      />
      {diagnostics.length > 0 && (
        <div className="mb-3 rounded border border-accent-warning/40 bg-accent-warning/10 p-2 text-xs text-text-secondary">
          {diagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic}-${index}`}>{diagnostic}</p>
          ))}
        </div>
      )}
      <CRUDListHeader
        description="Skills provide domain-specific knowledge that agents can load on demand."
        onNew={handleNew}
      />

      <CRUDListView
        loading={loading}
        hasItems={defaults.length > 0 || userItems.length > 0}
        loadingLabel="Loading skills..."
        emptyLabel="No skills created yet."
      >
        {defaults.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Built-in</h3>
            <div className="space-y-2">
              {defaults.map((skill) => (
                <SkillListItem
                  key={skill.id}
                  skill={skill}
                  isBuiltIn={true}
                  isConfirmingDelete={false}
                  onView={() => handleView(skill.id)}
                  onDuplicate={() => handleDuplicate(skill.id)}
                  onToggle={() => toggleSkill(skill.id)}
                />
              ))}
            </div>
          </div>
        )}

        {userItems.length > 0 && (
          <ItemsHeader>
            <EditableSkillItems items={userItems} />
          </ItemsHeader>
        )}

        {items.some((skill) => ['global-shared', 'selected', 'project-shared'].includes(skill.source)) && (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Shared</h3>
            <div className="space-y-2">
              <EditableSkillItems
                items={items.filter((skill) => ['global-shared', 'selected', 'project-shared'].includes(skill.source))}
              />
            </div>
          </div>
        )}

        {projectItems.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Project</h3>
            <div className="space-y-2">
              <EditableSkillItems items={projectItems} />
            </div>
          </div>
        )}
      </CRUDListView>
    </div>
  )
}
