import { useEffect, useState, useRef } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { EditButton } from '../shared/IconButton'
import { useCommandsStore, type CommandFull } from '../../stores/commands'
import { useAgentsStore } from '../../stores/agents'
import {
  useConfirmDialog,
  ConfirmButton,
  DeleteIcon,
  DuplicateIcon,
  ErrorBanner,
} from './CRUDModal'
import { CRUDListHeader } from './CRUDListHeader'
import { CRUDListView } from './CRUDListView'
import { NameIdFields } from './FormFields'
import { useCRUDForm } from './useCRUDForm'

interface CommandsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
}

type CommandFormData = {
  name: string
  id: string
  prompt: string
  agentMode: string
  isDefault: boolean
  [key: string]: unknown
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const VIEW_ICON = 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z'

function ViewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
      title="View"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={VIEW_ICON} />
      </svg>
    </button>
  )
}

export function CommandsModal({ isOpen, onClose, initialEditId }: CommandsModalProps) {
  const defaults = useCommandsStore(state => state.defaults)
  const userItems = useCommandsStore(state => state.userItems)
  const loading = useCommandsStore(state => state.loading)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)
  const fetchCommand = useCommandsStore(state => state.fetchCommand)
  const fetchDefaultContent = useCommandsStore(state => state.fetchDefaultContent)
  const createCommand = useCommandsStore(state => state.createCommand)
  const updateCommand = useCommandsStore(state => state.updateCommand)
  const deleteCommandAction = useCommandsStore(state => state.deleteCommand)

  const [viewingDefaultId, setViewingDefaultId] = useState<string | null>(null)
  const [defaultContent, setDefaultContent] = useState<string | null>(null)

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
  } = useCRUDForm<CommandFormData>()

  const { requestDelete, clearConfirm, isConfirming } = useConfirmDialog()
  const clearConfirmCalled = useRef(false)

  const agentDefaults = useAgentsStore(state => state.defaults)
  const agentUserItems = useAgentsStore(state => state.userItems)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const allAgents = [...agentDefaults, ...agentUserItems]
  const topLevelAgents = allAgents.filter((a) => !a.subagent)

  const fetchCommandsRef = useRef(fetchCommands)
  const fetchAgentsRef = useRef(fetchAgents)
  const fetchCommandRef = useRef(fetchCommand)
  const fetchDefaultContentRef = useRef(fetchDefaultContent)
  const initialEditIdRef = useRef(initialEditId)
  const setViewRef = useRef(setView)
  const setEditingIdRef = useRef(setEditingId)
  const setFormErrorRef = useRef(setFormError)
  const clearConfirmRef = useRef(clearConfirm)

  useEffect(() => {
    fetchCommandsRef.current = fetchCommands
    fetchAgentsRef.current = fetchAgents
    fetchCommandRef.current = fetchCommand
    fetchDefaultContentRef.current = fetchDefaultContent
    initialEditIdRef.current = initialEditId
    setViewRef.current = setView
    setEditingIdRef.current = setEditingId
    setFormErrorRef.current = setFormError
    clearConfirmRef.current = clearConfirm
  })

  useEffect(() => {
    if (isOpen) {
      fetchCommandsRef.current()
      fetchAgentsRef.current()
      if (!clearConfirmCalled.current) {
        clearConfirmRef.current()
        clearConfirmCalled.current = true
      }
      if (initialEditIdRef.current) {
        const isDefaultItem = defaults.some(d => d.id === initialEditIdRef.current)
        setViewRef.current('edit')
        setEditingIdRef.current(initialEditIdRef.current)
        setFormErrorRef.current('')
        if (isDefaultItem) {
          fetchDefaultContentRef.current(initialEditIdRef.current).then(content => {
            if (!content) return
            setFormData({
              name: content.metadata.name + ' (copy)',
              id: `${initialEditIdRef.current}-copy-${Date.now()}`,
              prompt: content.prompt,
              agentMode: content.metadata.agentMode ?? '',
              isDefault: true,
            })
          })
        } else {
          fetchCommandRef.current(initialEditIdRef.current).then(command => {
            if (!command) return
            setFormData({
              name: command.metadata.name,
              id: command.metadata.id,
              prompt: command.prompt,
              agentMode: command.metadata.agentMode ?? '',
              isDefault: false,
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
    const content = await fetchDefaultContent(commandId)
    setDefaultContent(content?.prompt ?? null)
  }

  const handleDuplicate = async (commandId: string) => {
    const isDefault = defaults.some(d => d.id === commandId)
    if (isDefault) {
      const content = await fetchDefaultContent(commandId)
      if (content) {
        setEditingId(null)
        setFormData({
          name: `${content.metadata.name} (copy)`,
          id: `${commandId}-copy-${Date.now()}`,
          prompt: content.prompt,
          agentMode: content.metadata.agentMode ?? '',
          isDefault: true,
        })
        setFormError('')
        setView('edit')
      }
    } else {
      const command = await fetchCommand(commandId)
      if (command) {
        setEditingId(null)
        setFormData({
          name: `${command.metadata.name} (copy)`,
          id: `${commandId}-copy-${Date.now()}`,
          prompt: command.prompt,
          agentMode: command.metadata.agentMode ?? '',
          isDefault: false,
        })
        setFormError('')
        setView('edit')
      }
    }
  }

  const handleNew = () => {
    setFormData({ name: '', id: '', prompt: '', agentMode: '', isDefault: false })
    setEditingId(null)
    setView('edit')
  }

  const handleEdit = async (commandId: string) => {
    const command = await fetchCommand(commandId)
    if (!command) return
    setEditingId(commandId)
    setFormData({
      name: command.metadata.name,
      id: command.metadata.id,
      prompt: command.prompt,
      agentMode: command.metadata.agentMode ?? '',
      isDefault: false,
    })
    setFormError('')
    setView('edit')
  }

  const handleDelete = async (commandId: string) => {
    await deleteCommandAction(commandId)
    clearConfirm()
  }

  const handleSave = async () => {
    const id = editingId ?? formData.id
    if (!id || !formData.name || !formData.prompt) {
      setFormError('Name and message are required.')
      return
    }

    setSaving(true)
    setFormError('')

    const command: CommandFull = {
      metadata: { id, name: formData.name, ...(formData.agentMode ? { agentMode: formData.agentMode } : {}) },
      prompt: formData.prompt,
    }

    const result = editingId
      ? await updateCommand(editingId, command)
      : await createCommand(command)

    setSaving(false)

    if (!result.success) {
      setFormError(result.error ?? 'Failed to save command.')
      return
    }

    initialEditId ? onClose() : setView('list')
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
    setFormData(prev => ({ ...prev, name }))
    if (!editingId || formData.isDefault) {
      setFormData(prev => ({ ...prev, id: toSlug(name) }))
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
    setEditingId(viewingDefaultId)
    fetchDefaultContent(viewingDefaultId).then(content => {
      if (!content) return
      setFormData({
        name: `${content.metadata.name} (copy)`,
        id: `${viewingDefaultId}-copy-${Date.now()}`,
        prompt: content.prompt,
        agentMode: content.metadata.agentMode ?? '',
        isDefault: true,
      })
    })
  }

  if (viewingDefaultId) {
    const defaultItem = defaults.find(d => d.id === viewingDefaultId)
    return (
      <Modal isOpen={isOpen} onClose={handleViewClose} title={`Default: ${defaultItem?.name ?? viewingDefaultId}`} size="xl">
        <div className="flex flex-col h-full">
          <div className="space-y-3 mb-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">Built-in</span>
              <span className="font-mono">{viewingDefaultId}</span>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Name</label>
              <div className="px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm">{defaultItem?.name}</div>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Agent Mode</label>
              <div className="px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-muted">
                {defaultItem?.agentMode || 'None'}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-[120px] border-t border-border pt-3 flex flex-col">
            <label className="block text-xs text-text-secondary mb-1">Message</label>
            <textarea
              value={defaultContent ?? ''}
              readOnly
              placeholder="..."
              className="flex-1 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none opacity-60"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border flex-shrink-0">
            <Button variant="secondary" onClick={handleViewClose}>Close</Button>
            <Button variant="primary" onClick={handleDuplicateFromView}>
              Duplicate & Customize
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={handleCancel} title={editingId ? 'Edit Command' : 'New Command'} size="xl">
        <div className="flex flex-col h-full">
          {formError && <ErrorBanner message={formError} />}

          <div className="space-y-3 mb-3">
            <NameIdFields
              name={formData.name}
              id={formData.id}
              nameLabel="Name"
              idLabel="ID"
              namePlaceholder="My Command"
              idPlaceholder="my-command"
              readOnlyId={!!editingId && !formData.isDefault}
              onNameChange={handleNameChange}
              onIdChange={id => setFormData(prev => ({ ...prev, id }))}
            />

            <div>
              <label className="block text-xs text-text-secondary mb-1">Agent Mode <span className="text-text-muted">(optional)</span></label>
              <select
                value={formData.agentMode}
                onChange={e => setFormData(prev => ({ ...prev, agentMode: e.target.value }))}
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                <option value="">None (keep current mode)</option>
                {topLevelAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 min-h-[120px] border-t border-border pt-3 flex flex-col">
            <label className="block text-xs text-text-secondary mb-1">Message</label>
            <textarea
              value={formData.prompt}
              onChange={e => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
              placeholder="The message that will be sent when this command is triggered..."
              className="flex-1 w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border flex-shrink-0">
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !formData.name || !formData.prompt}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Commands" size="lg">
      <CRUDListHeader
        description="Commands are pre-defined messages you can send with a single click."
        onNew={handleNew}
      />

      <CRUDListView
        loading={loading}
        hasItems={defaults.length > 0 || userItems.length > 0}
        loadingLabel="Loading commands..."
        emptyLabel="No commands created yet."
      >
        {defaults.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Built-in</h3>
            <div className="space-y-2">
              {defaults.map(command => (
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
            </div>
          </div>
        )}

        {userItems.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Custom</h3>
            <div className="space-y-2">
              {userItems.map(command => (
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
              ))}
            </div>
          </div>
        )}
      </CRUDListView>
    </Modal>
  )
}