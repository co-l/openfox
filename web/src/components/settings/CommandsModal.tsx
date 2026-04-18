import { useEffect } from 'react'
import { Modal } from '../shared/Modal'
import { EditButton } from '../shared/IconButton'
import { useCommandsStore, type CommandFull } from '../../stores/commands'
import { useAgentsStore } from '../../stores/agents'
import {
  useConfirmDialog,
  ConfirmButton,
  DeleteIcon,
  RestoreIcon,
  FormTextArea,
  ModalActions,
  ErrorBanner,
} from './CRUDModal'
import { CRUDListHeader } from './CRUDListHeader'
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
  [key: string]: unknown
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function CommandsModal({ isOpen, onClose, initialEditId }: CommandsModalProps) {
  const commands = useCommandsStore(state => state.commands)
  const modifiedIds = useCommandsStore(state => state.modifiedIds)
  const loading = useCommandsStore(state => state.loading)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)
  const fetchCommand = useCommandsStore(state => state.fetchCommand)
  const createCommand = useCommandsStore(state => state.createCommand)
  const updateCommand = useCommandsStore(state => state.updateCommand)
  const deleteCommandAction = useCommandsStore(state => state.deleteCommand)
  const restoreDefault = useCommandsStore(state => state.restoreDefault)

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

  const { requestDelete, requestRestore, requestRestoreAll, clearConfirm, isConfirming, isConfirmingRestoreAll } = useConfirmDialog()

  const agents = useAgentsStore(state => state.agents)
  const fetchAgents = useAgentsStore(state => state.fetchAgents)
  const topLevelAgents = agents.filter(a => !a.subagent)

  useEffect(() => {
    if (isOpen) {
      fetchCommands()
      fetchAgents()
      clearConfirm()
      if (initialEditId) {
        setView('edit')
        setEditingId(initialEditId)
        setFormError('')
        fetchCommand(initialEditId).then(command => {
          if (!command) return
          setFormData({
            name: command.metadata.name,
            id: command.metadata.id,
            prompt: command.prompt,
            agentMode: command.metadata.agentMode ?? '',
          })
        })
      } else {
        setView('list')
        setEditingId(null)
      }
    }
  }, [isOpen, fetchCommands, fetchAgents, fetchCommand, initialEditId, clearConfirm])

  const handleNew = () => {
    setFormData({ name: '', id: '', prompt: '', agentMode: '' })
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
    }
  }

  const handleNameChange = (name: string) => {
    setFormData(prev => ({ ...prev, name }))
    if (!editingId) {
      setFormData(prev => ({ ...prev, id: toSlug(name) }))
    }
  }

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={handleCancel} title={editingId ? 'Edit Command' : 'New Command'} size="xl">
        <div className="space-y-3">
          {formError && <ErrorBanner message={formError} />}

          <NameIdFields
            name={formData.name}
            id={formData.id}
            nameLabel="Name"
            idLabel="ID"
            namePlaceholder="My Command"
            idPlaceholder="my-command"
            readOnlyId={!!editingId}
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
              {topLevelAgents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>

          <FormTextArea
            label="Message"
            value={formData.prompt}
            onChange={prompt => setFormData(prev => ({ ...prev, prompt }))}
            placeholder="The message that will be sent when this command is triggered..."
            className="h-64"
          />

          <ModalActions onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!formData.name || !formData.prompt} />
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Commands" size="lg">
      <CRUDListHeader
        description="Commands are pre-defined messages you can send with a single click."
        modifiedCount={modifiedIds.length}
        onRestoreAll={requestRestoreAll}
        isConfirmingRestoreAll={isConfirmingRestoreAll()}
        onCancelRestoreAll={clearConfirm}
        onNew={handleNew}
      />

      {loading && commands.length === 0 ? (
        <div className="text-text-muted text-sm">Loading commands...</div>
      ) : commands.length === 0 ? (
        <div className="text-text-muted text-sm">No commands created yet.</div>
      ) : (
        <div className="space-y-2">
          {commands.map(command => (
            <div
              key={command.id}
              className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
            >
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2">
                  <span className="text-text-primary text-sm font-medium">{command.name}</span>
                  {modifiedIds.includes(command.id) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400">modified</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {modifiedIds.includes(command.id) && (
                  isConfirming(command.id, 'restore') ? (
                    <ConfirmButton type="restore" onConfirm={() => restoreDefault(command.id).then(clearConfirm)} onCancel={clearConfirm} />
                  ) : (
                    <RestoreIcon onClick={() => requestRestore(command.id)} />
                  )
                )}

                <EditButton onClick={() => handleEdit(command.id)} />

                {isConfirming(command.id, 'delete') ? (
                  <ConfirmButton type="delete" onConfirm={() => handleDelete(command.id)} onCancel={clearConfirm} />
                ) : (
                  <DeleteIcon onClick={() => requestDelete(command.id)} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}