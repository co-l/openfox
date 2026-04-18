import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { EditButton } from '../shared/IconButton'
import { useCommandsStore, type CommandFull } from '../../stores/commands'
import { useAgentsStore } from '../../stores/agents'
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

interface CommandsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
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

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formAgentMode, setFormAgentMode] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

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
          setFormName(command.metadata.name)
          setFormId(command.metadata.id)
          setFormPrompt(command.prompt)
          setFormAgentMode(command.metadata.agentMode ?? '')
        })
      } else {
        setView('list')
        setEditingId(null)
      }
    }
  }, [isOpen, fetchCommands, fetchAgents, fetchCommand, initialEditId, clearConfirm])

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormPrompt('')
    setFormAgentMode('')
    setFormError('')
    setView('edit')
  }

  const handleEdit = async (commandId: string) => {
    const command = await fetchCommand(commandId)
    if (!command) return
    setEditingId(commandId)
    setFormName(command.metadata.name)
    setFormId(command.metadata.id)
    setFormPrompt(command.prompt)
    setFormAgentMode(command.metadata.agentMode ?? '')
    setFormError('')
    setView('edit')
  }

  const handleDelete = async (commandId: string) => {
    await deleteCommandAction(commandId)
    clearConfirm()
  }

  const handleSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName || !formPrompt) {
      setFormError('Name and message are required.')
      return
    }

    setSaving(true)
    setFormError('')

    const command: CommandFull = {
      metadata: { id, name: formName, ...(formAgentMode ? { agentMode: formAgentMode } : {}) },
      prompt: formPrompt,
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
    setFormName(name)
    if (!editingId) {
      setFormId(toSlug(name))
    }
  }

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={handleCancel} title={editingId ? 'Edit Command' : 'New Command'} size="xl">
        <div className="space-y-3">
          {formError && <ErrorBanner message={formError} />}

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Name"
              value={formName}
              onChange={handleNameChange}
              placeholder="My Command"
            />
            <FormField
              label="ID"
              value={formId}
              onChange={setFormId}
              readOnly={!!editingId}
              placeholder="my-command"
              hint={editingId ? '(read-only)' : undefined}
              mono
            />
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Agent Mode <span className="text-text-muted">(optional)</span></label>
            <select
              value={formAgentMode}
              onChange={e => setFormAgentMode(e.target.value)}
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
            value={formPrompt}
            onChange={setFormPrompt}
            placeholder="The message that will be sent when this command is triggered..."
            className="h-64"
          />

          <ModalActions onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!formName || !formPrompt} />
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