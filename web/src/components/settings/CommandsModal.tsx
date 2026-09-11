import { useEffect, useState, useRef } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { EditButton } from '../shared/IconButton'
import { EyeIcon } from '../shared/icons'
import {
  createCommand,
  updateCommand,
  deleteCommand,
  type CommandInfo,
  type CommandFull,
} from '../../lib/commands-actions'
import { useResource } from '../../hooks/useResource'
import { agentsResource, commandsResource, commandResource, commandDefaultResource } from '../../lib/resources'
import {
  useConfirmDialog,
  ConfirmButton,
  DeleteIcon,
  DuplicateIcon,
  ErrorBanner,
  DestinationSelector,
  ModalActions,
} from './CRUDModal'
import { ItemsHeader } from '../shared/ItemsHeader'
import { CRUDListScaffold } from './CRUDListScaffold'
import { NameIdFields } from './FormFields'
import { useCRUDForm } from './useCRUDForm'
import { useT } from '../../hooks/useT'

interface CommandsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
  /** Project root workdir this modal was opened from — scopes project commands shown and saved. */
  projectDir?: string
}

type CommandFormData = {
  name: string
  id: string
  prompt: string
  agentMode: string
  isDefault: boolean
  destination: 'project' | 'user'
  [key: string]: unknown
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function ViewButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
      title={t({ en: 'View', fr: 'Voir' })}
    >
      <EyeIcon />
    </button>
  )
}

export function CommandsModal({ isOpen, onClose, initialEditId, projectDir }: CommandsModalProps) {
  const t = useT()
  const { data: commandsData, loading } = useResource(commandsResource, projectDir)
  const defaults = commandsData?.defaults ?? []
  const userItems = commandsData?.userItems ?? []
  const projectItems = commandsData?.projectItems ?? []
  const [viewingDefaultId, setViewingDefaultId] = useState<string | null>(null)
  const [defaultContent, setDefaultContent] = useState<string | null>(null)

  const { view, editingId, formError, saving, formData, setView, setEditingId, setFormError, setFormData, setSaving } =
    useCRUDForm<CommandFormData>()

  const { requestDelete, clearConfirm, isConfirming } = useConfirmDialog()
  const clearConfirmCalled = useRef(false)

  const { data } = useResource(agentsResource, projectDir)
  const allAgents = data ? [...data.defaults, ...data.userItems] : []
  const topLevelAgents = allAgents.filter((a) => !a.subagent)

  const projectDirRef = useRef(projectDir)
  const initialEditIdRef = useRef(initialEditId)
  const setViewRef = useRef(setView)
  const setEditingIdRef = useRef(setEditingId)
  const setFormErrorRef = useRef(setFormError)
  const clearConfirmRef = useRef(clearConfirm)

  useEffect(() => {
    projectDirRef.current = projectDir
    initialEditIdRef.current = initialEditId
    setViewRef.current = setView
    setEditingIdRef.current = setEditingId
    setFormErrorRef.current = setFormError
    clearConfirmRef.current = clearConfirm
  })

  useEffect(() => {
    if (isOpen) {
      if (!clearConfirmCalled.current) {
        clearConfirmRef.current()
        clearConfirmCalled.current = true
      }
      if (initialEditIdRef.current) {
        const isDefaultItem = defaults.some((d) => d.id === initialEditIdRef.current)
        setViewRef.current('edit')
        setEditingIdRef.current(initialEditIdRef.current)
        setFormErrorRef.current('')
        if (isDefaultItem) {
          commandDefaultResource.refresh(initialEditIdRef.current).then((content) => {
            if (!content) return
            setFormData({
              name: content.metadata.name + ' ' + t({ en: '(copy)', fr: '(copie)' }),
              id: `${initialEditIdRef.current}-copy-${Date.now()}`,
              prompt: content.prompt,
              agentMode: content.metadata.agentMode ?? '',
              isDefault: true,
              destination: 'user',
            })
          })
        } else {
          commandResource.refresh(initialEditIdRef.current, projectDirRef.current).then((command) => {
            if (!command) return
            setFormData({
              name: command.metadata.name,
              id: command.metadata.id,
              prompt: command.prompt,
              agentMode: command.metadata.agentMode ?? '',
              isDefault: false,
              destination: 'user',
            })
          })
        }
      } else {
        setViewRef.current('list')
        setEditingIdRef.current(null)
      }
    } else {
      clearConfirmCalled.current = false
    }
  }, [isOpen])

  const handleViewDefault = async (commandId: string) => {
    setViewingDefaultId(commandId)
    const content = await commandDefaultResource.refresh(commandId)
    setDefaultContent(content?.prompt ?? null)
  }

  const handleDuplicate = async (commandId: string) => {
    const isDefault = defaults.some((d) => d.id === commandId)
    if (isDefault) {
      const content = await commandDefaultResource.refresh(commandId)
      if (content) {
        setEditingId(null)
        setFormData({
          name: `${content.metadata.name} ${t({ en: '(copy)', fr: '(copie)' })}`,
          id: `${commandId}-copy-${Date.now()}`,
          prompt: content.prompt,
          agentMode: content.metadata.agentMode ?? '',
          isDefault: true,
          destination: 'user',
        })
        setFormError('')
        setView('edit')
      }
    } else {
      const command = await commandResource.refresh(commandId, projectDir)
      if (command) {
        setEditingId(null)
        setFormData({
          name: `${command.metadata.name} ${t({ en: '(copy)', fr: '(copie)' })}`,
          id: `${commandId}-copy-${Date.now()}`,
          prompt: command.prompt,
          agentMode: command.metadata.agentMode ?? '',
          isDefault: false,
          destination: 'user',
        })
        setFormError('')
        setView('edit')
      }
    }
  }

  const handleNew = () => {
    setFormData({ name: '', id: '', prompt: '', agentMode: '', isDefault: false, destination: 'user' })
    setEditingId(null)
    setView('edit')
  }

  const handleEdit = async (commandId: string) => {
    const command = await commandResource.refresh(commandId, projectDir)
    if (!command) return
    setEditingId(commandId)
    setFormData({
      name: command.metadata.name,
      id: command.metadata.id,
      prompt: command.prompt,
      agentMode: command.metadata.agentMode ?? '',
      isDefault: false,
      destination: 'user',
    })
    setFormError('')
    setView('edit')
  }

  const handleDelete = async (commandId: string) => {
    await deleteCommand(commandId, projectDir)
    clearConfirm()
  }

  const handleSave = async () => {
    const id = editingId ?? formData.id
    if (!id || !formData.name || !formData.prompt) {
      setFormError(t({ en: 'Name and message are required.', fr: 'Le nom et le message sont requis.' }))
      return
    }

    setSaving(true)
    setFormError('')

    const command: CommandFull = {
      metadata: { id, name: formData.name, ...(formData.agentMode ? { agentMode: formData.agentMode } : {}) },
      prompt: formData.prompt,
    }

    const result = editingId
      ? await updateCommand(editingId, command, projectDir)
      : await createCommand(command, formData.destination as 'project' | 'user', projectDir)

    setSaving(false)

    if (!result.success) {
      setFormError(
        result.error ?? t({ en: 'Failed to save command.', fr: 'Échec de l’enregistrement de la commande.' }),
      )
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
      setViewingDefaultId(null)
      setDefaultContent(null)
    }
  }

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({ ...prev, name }))
    if (!editingId || formData.isDefault) {
      setFormData((prev) => ({ ...prev, id: toSlug(name) }))
    }
  }

  const handleViewClose = () => {
    setViewingDefaultId(null)
    setDefaultContent(null)
    setView('list')
  }

  const handleDuplicateFromView = () => {
    if (!viewingDefaultId) return
    setViewingDefaultId(null)
    setView('edit')
    // A duplicate is a NEW command: leave editingId null so Save creates a
    // fresh copy instead of updating (and overwriting) the source default.
    setEditingId(null)
    commandDefaultResource.refresh(viewingDefaultId).then((content) => {
      if (!content) return
      setFormData({
        name: `${content.metadata.name} ${t({ en: '(copy)', fr: '(copie)' })}`,
        id: `${viewingDefaultId}-copy-${Date.now()}`,
        prompt: content.prompt,
        agentMode: content.metadata.agentMode ?? '',
        isDefault: true,
        destination: 'user',
      })
    })
  }

  if (viewingDefaultId) {
    const defaultItem = defaults.find((d) => d.id === viewingDefaultId)
    return (
      <Modal
        isOpen={isOpen}
        onClose={handleViewClose}
        title={t({ en: 'Default: {{name}}', fr: 'Défaut : {{name}}' }, { name: defaultItem?.name ?? viewingDefaultId })}
        size="xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleViewClose}>
              {t({ en: 'Close', fr: 'Fermer' })}
            </Button>
            <Button variant="primary" onClick={handleDuplicateFromView}>
              {t({ en: 'Duplicate & Customize', fr: 'Dupliquer et personnaliser' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col h-full">
          <div className="space-y-3 mb-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">
                {t({ en: 'Built-in', fr: 'Intégré' })}
              </span>
              <span className="font-mono">{viewingDefaultId}</span>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Name', fr: 'Nom' })}</label>
              <div className="px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm">{defaultItem?.name}</div>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t({ en: 'Agent Mode', fr: 'Mode agent' })}
              </label>
              <div className="px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-muted">
                {defaultItem?.agentMode || t({ en: 'None', fr: 'Aucun' })}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-[120px] border-t border-border pt-3 flex flex-col">
            <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Message', fr: 'Message' })}</label>
            <textarea
              value={defaultContent ?? ''}
              readOnly
              placeholder={t({ en: '...', fr: '...' })}
              className="flex-1 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none opacity-60"
            />
          </div>
        </div>
      </Modal>
    )
  }

  if (view === 'edit') {
    return (
      <Modal
        isOpen={isOpen}
        onClose={handleCancel}
        title={
          editingId
            ? t({ en: 'Edit Command', fr: 'Modifier la commande' })
            : t({ en: 'New Command', fr: 'Nouvelle commande' })
        }
        size="xl"
        footer={
          <ModalActions
            onCancel={handleCancel}
            onSave={handleSave}
            saving={saving}
            saveDisabled={!formData.name || !formData.prompt}
          />
        }
      >
        <div className="flex flex-col h-full">
          {formError && <ErrorBanner message={formError} />}

          <div className="space-y-3 mb-3">
            <NameIdFields
              name={formData.name}
              id={formData.id}
              nameLabel={t({ en: 'Name', fr: 'Nom' })}
              idLabel={t({ en: 'ID', fr: 'ID' })}
              namePlaceholder={t({ en: 'My Command', fr: 'Ma commande' })}
              idPlaceholder="my-command"
              readOnlyId={!!editingId && !formData.isDefault}
              onNameChange={handleNameChange}
              onIdChange={(id) => setFormData((prev) => ({ ...prev, id }))}
            />

            <div>
              <label className="block text-xs text-text-secondary mb-1">
                {t({ en: 'Agent Mode', fr: 'Mode agent' })}{' '}
                <span className="text-text-muted">{t({ en: '(optional)', fr: '(facultatif)' })}</span>
              </label>
              <select
                value={formData.agentMode}
                onChange={(e) => setFormData((prev) => ({ ...prev, agentMode: e.target.value }))}
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                <option value="">
                  {t({ en: 'None (keep current mode)', fr: 'Aucun (conserver le mode actuel)' })}
                </option>
                {topLevelAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            {!editingId && (
              <DestinationSelector
                value={formData.destination as 'project' | 'user'}
                onChange={(v) => setFormData((prev) => ({ ...prev, destination: v }))}
              />
            )}
          </div>

          <div className="flex-1 min-h-[120px] border-t border-border pt-3 flex flex-col">
            <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Message', fr: 'Message' })}</label>
            <textarea
              value={formData.prompt}
              onChange={(e) => setFormData((prev) => ({ ...prev, prompt: e.target.value }))}
              placeholder={t({
                en: 'The message that will be sent when this command is triggered...',
                fr: 'Le message qui sera envoyé lorsque cette commande est déclenchée...',
              })}
              className="h-80 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
            <p className="text-xs text-text-muted mt-1">
              {t({
                en: 'Arguments: {{name}} takes one value in order (/cmd first second), {{ARGUMENTS}} takes everything typed after the command. Quote a value to keep it whole: /cmd "two words". Anything left unfilled is asked for before sending.',
                fr: 'Arguments : {{nom}} prend une valeur dans l’ordre (/cmd premier second), {{ARGUMENTS}} prend tout ce qui suit la commande. Mettez une valeur entre guillemets pour la garder entière : /cmd « deux mots ». Ce qui reste vide vous sera demandé avant l’envoi.',
              })}
            </p>
          </div>
        </div>
      </Modal>
    )
  }

  const renderCommandItems = (items: CommandInfo[]) =>
    items.map((command) => (
      <div
        key={command.id}
        className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
      >
        <div className="min-w-0 flex-1 mr-3">
          <div className="flex items-center gap-2">
            <span className="text-text-primary text-sm font-medium">{command.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <EditButton onClick={() => handleEdit(command.id)} />
          <DuplicateIcon onClick={() => handleDuplicate(command.id)} />

          {isConfirming(command.id, 'delete') ? (
            <ConfirmButton onConfirm={() => handleDelete(command.id)} onCancel={clearConfirm} />
          ) : (
            <DeleteIcon onClick={() => requestDelete(command.id)} />
          )}
        </div>
      </div>
    ))

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t({ en: 'Commands', fr: 'Commandes' })} size="lg">
      <CRUDListScaffold
        description={t({
          en: 'Commands are pre-defined messages you can send with a single click.',
          fr: 'Les commandes sont des messages prédéfinis que vous pouvez envoyer en un seul clic.',
        })}
        onNew={handleNew}
        loading={loading}
        hasItems={defaults.length > 0 || userItems.length > 0 || projectItems.length > 0}
        loadingLabel={t({ en: 'Loading commands...', fr: 'Chargement des commandes...' })}
        emptyLabel={t({ en: 'No commands created yet.', fr: 'Aucune commande créée pour l’instant.' })}
      >
        {defaults.length > 0 && (
          <ItemsHeader label={t({ en: 'Built-in', fr: 'Intégrées' })}>
            {defaults.map((command) => (
              <div
                key={command.id}
                className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
              >
                <div className="min-w-0 flex-1 mr-3">
                  <span className="text-text-primary text-sm font-medium">{command.name}</span>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <ViewButton onClick={() => handleViewDefault(command.id)} />
                  <DuplicateIcon onClick={() => handleDuplicate(command.id)} />
                </div>
              </div>
            ))}
          </ItemsHeader>
        )}

        {userItems.length > 0 && <ItemsHeader>{renderCommandItems(userItems)}</ItemsHeader>}

        {projectItems.length > 0 && (
          <div className="mt-4">
            <ItemsHeader label={t({ en: 'Project', fr: 'Projet' })}>{renderCommandItems(projectItems)}</ItemsHeader>
          </div>
        )}
      </CRUDListScaffold>
    </Modal>
  )
}
