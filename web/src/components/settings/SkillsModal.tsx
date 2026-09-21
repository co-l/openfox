import { useEffect, useState } from 'react'
import { Button } from '../shared/Button'
import {
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkill,
  selectDirectory,
  removeDirectory,
  installSkill,
  type SkillFull,
  type SkillInfo,
} from '../../lib/skills-actions'
import { useResource } from '../../hooks/useResource'
import { skillsResource, skillResource, skillDefaultResource } from '../../lib/resources'
import { useSessionStore } from '../../stores/session/store'
import { useConfirmDialog, FormField, ErrorBanner, DestinationSelector } from './CRUDModal'
import { ItemsHeader } from '../shared/ItemsHeader'
import { CRUDListScaffold } from './CRUDListScaffold'
import { NameIdFields } from './FormFields'
import { useCRUDForm } from './useCRUDForm'
import { SkillLibraryPanel } from './SkillLibraryPanel'
import { SkillListItem } from './SkillListItem'
import { SkillDeleteModal } from './SkillDeleteModal'
import { useT } from '../../hooks/useT'
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
  const t = useT()
  const currentSession = useSessionStore((state) => state.currentSession)
  const workdir = currentSession?.workdir
  const { data, refresh, loading } = useResource(skillsResource, workdir)
  const defaults = data?.defaults ?? []
  const userItems = data?.userItems ?? []
  const projectItems = data?.projectItems ?? []
  const items = data?.items ?? []
  const selectedDirectory = data?.selectedDirectory ?? null
  const diagnostics = data?.diagnostics ?? []
  const [pendingDelete, setPendingDelete] = useState<SkillInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const { view, editingId, formError, saving, formData, setView, setEditingId, setFormError, setFormData, setSaving } =
    useCRUDForm<SkillFormData>()

  const { clearConfirm } = useConfirmDialog()

  useEffect(() => {
    if (isOpen) {
      setView('list')
      setEditingId(null)
      clearConfirm()
    }
  }, [isOpen, clearConfirm])

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
      const content = await skillDefaultResource.refresh(skillId)
      if (!content) return
      setSkillFormData(content, true)
      setEditingId(skillId)
      setFormError('')
      setView('edit')
    } else {
      const skill = await skillResource.refresh(skillId, workdir)
      if (!skill) return
      setSkillFormData(skill, true)
      setEditingId(skillId)
      setFormError('')
      setView('edit')
    }
  }

  const handleDuplicate = async (skillId: string) => {
    const isDefault = defaults.some((d) => d.id === skillId)
    const content = isDefault
      ? await skillDefaultResource.refresh(skillId)
      : await skillResource.refresh(skillId, workdir)
    if (!content) return
    const newId = `${skillId}-copy-${Date.now()}`
    setSkillFormData(content, false, newId, `${content.metadata.name} ${t({ en: '(copy)', fr: '(copie)' })}`)
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
    const skill = await skillResource.refresh(skillId, workdir)
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
    const result = await deleteSkill(pendingDelete.id, workdir)
    setDeleting(false)
    if (!result.success) {
      setDeleteError(
        result.error ?? t({ en: 'Failed to delete skill.', fr: 'Échec de la suppression de la compétence.' }),
      )
      return
    }
    await refresh()
    setPendingDelete(null)
    clearConfirm()
  }

  const handleSave = async () => {
    const id = editingId ?? formData.id
    if (!id || !formData.name || !formData.prompt) {
      setFormError(t({ en: 'Name, ID, and prompt are required.', fr: 'Le nom, l’ID et l’invite sont requis.' }))
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
      ? await updateSkill(editingId, skill, workdir)
      : await createSkill(skill, formData.destination as 'project' | 'user', workdir)

    setSaving(false)

    if (!result.success) {
      setFormError(
        result.error ?? t({ en: 'Failed to save skill.', fr: 'Échec de l’enregistrement de la compétence.' }),
      )
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
            {isReadOnly
              ? formData.name
              : editingId
                ? t({ en: 'Edit Skill', fr: 'Modifier la compétence' })
                : t({ en: 'New Skill', fr: 'Nouvelle compétence' })}
          </h2>
          <button onClick={() => setView('list')} className="text-text-muted hover:text-text-primary">
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
        </div>

        {formError && <ErrorBanner message={formError} />}

        <div className="space-y-3 mb-3">
          <NameIdFields
            name={formData.name as string}
            id={formData.id as string}
            nameLabel={t({ en: 'Name', fr: 'Nom' })}
            idLabel={t({ en: 'ID', fr: 'ID' })}
            namePlaceholder={t({ en: 'My Skill', fr: 'Ma compétence' })}
            idPlaceholder="my-skill"
            readOnlyId={true}
            onNameChange={handleNameChange}
            onIdChange={() => {}}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={t({ en: 'Description', fr: 'Description' })}
              value={formData.description as string}
              onChange={(description) => setFormData((prev) => ({ ...prev, description }))}
              placeholder={t({ en: 'What this skill does...', fr: 'Ce que fait cette compétence...' })}
              readOnly={isReadOnly}
            />
            <FormField
              label={t({ en: 'Version', fr: 'Version' })}
              value={formData.version as string}
              onChange={(version) => setFormData((prev) => ({ ...prev, version }))}
              placeholder="1.0.0"
              readOnly={isReadOnly}
            />
          </div>
        </div>

        <div className="flex-1 min-h-[120px] border-t border-border pt-3 flex flex-col">
          <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Prompt', fr: 'Invite' })}</label>
          <textarea
            value={formData.prompt}
            onChange={(e) => setFormData((prev) => ({ ...prev, prompt: e.target.value }))}
            readOnly={isReadOnly}
            placeholder={t({
              en: 'The system prompt for this skill...',
              fr: 'L’invite système pour cette compétence...',
            })}
            className="h-80 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>

        {!editingId && (
          <DestinationSelector
            value={formData.destination as 'project' | 'user'}
            onChange={(v) => setFormData((prev) => ({ ...prev, destination: v }))}
          />
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border flex-shrink-0">
          <Button variant="secondary" onClick={() => setView('list')}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </Button>
          {isReadOnly ? (
            <Button
              variant="primary"
              onClick={() => {
                setFormData((prev) => ({
                  ...prev,
                  name: prev.name + ' ' + t({ en: '(copy)', fr: '(copie)' }),
                  id: `${editingId}-copy-${Date.now()}`,
                  isReadOnly: false,
                }))
                setEditingId(null)
              }}
            >
              {t({ en: 'Duplicate & Customize', fr: 'Dupliquer et personnaliser' })}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !formData.name || !formData.id || !formData.prompt}
            >
              {saving ? t({ en: 'Saving...', fr: 'Enregistrement...' }) : t({ en: 'Save', fr: 'Enregistrer' })}
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
        onToggle={() => toggleSkill(skill.id, workdir)}
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
        onSelect={(path) => selectDirectory(path, workdir)}
        onRemove={() => removeDirectory(workdir)}
        onRefresh={() => void refresh()}
        onInstall={(skillPackage) => installSkill(skillPackage, workdir)}
      />
      {diagnostics.length > 0 && (
        <div className="mb-3 rounded border border-accent-warning/40 bg-accent-warning/10 p-2 text-xs text-text-secondary">
          {diagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic}-${index}`}>{diagnostic}</p>
          ))}
        </div>
      )}
      <CRUDListScaffold
        description={t({
          en: 'Skills provide domain-specific knowledge that agents can load on demand.',
          fr: 'Les compétences fournissent des connaissances spécifiques que les agents peuvent charger à la demande.',
        })}
        onNew={handleNew}
        loading={loading}
        hasItems={defaults.length > 0 || userItems.length > 0}
        loadingLabel={t({ en: 'Loading skills...', fr: 'Chargement des compétences...' })}
        emptyLabel={t({ en: 'No skills created yet.', fr: 'Aucune compétence créée pour l’instant.' })}
      >
        {defaults.length > 0 && (
          <ItemsHeader label={t({ en: 'Built-in', fr: 'Intégrées' })}>
            {defaults.map((skill) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                isBuiltIn={true}
                isConfirmingDelete={false}
                onView={() => handleView(skill.id)}
                onDuplicate={() => handleDuplicate(skill.id)}
                onToggle={() => toggleSkill(skill.id, workdir)}
              />
            ))}
          </ItemsHeader>
        )}

        {userItems.length > 0 && (
          <ItemsHeader>
            <EditableSkillItems items={userItems} />
          </ItemsHeader>
        )}

        {items.some((skill) => ['global-shared', 'selected', 'project-shared'].includes(skill.source)) && (
          <div className="mt-4">
            <ItemsHeader label={t({ en: 'Shared', fr: 'Partagées' })}>
              <EditableSkillItems
                items={items.filter((skill) => ['global-shared', 'selected', 'project-shared'].includes(skill.source))}
              />
            </ItemsHeader>
          </div>
        )}

        {projectItems.length > 0 && (
          <div className="mt-4">
            <ItemsHeader label={t({ en: 'Project', fr: 'Projet' })}>
              <EditableSkillItems items={projectItems} />
            </ItemsHeader>
          </div>
        )}
      </CRUDListScaffold>
    </div>
  )
}
