import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { useCommandsStore, type CommandFull } from '../../stores/commands'

interface CommandsModalProps {
  isOpen: boolean
  onClose: () => void
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function CommandsModal({ isOpen, onClose }: CommandsModalProps) {
  const commands = useCommandsStore(state => state.commands)
  const loading = useCommandsStore(state => state.loading)
  const fetchCommands = useCommandsStore(state => state.fetchCommands)
  const fetchCommand = useCommandsStore(state => state.fetchCommand)
  const createCommand = useCommandsStore(state => state.createCommand)
  const updateCommand = useCommandsStore(state => state.updateCommand)
  const deleteCommandAction = useCommandsStore(state => state.deleteCommand)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchCommands()
      setView('list')
      setEditingId(null)
      setConfirmDeleteId(null)
    }
  }, [isOpen, fetchCommands])

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormPrompt('')
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
    setFormError('')
    setView('edit')
  }

  const handleDelete = async (commandId: string) => {
    await deleteCommandAction(commandId)
    setConfirmDeleteId(null)
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
      metadata: { id, name: formName },
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
      <Modal isOpen={isOpen} onClose={handleCancel} title={editingId ? 'Edit Command' : 'New Command'} size="lg">
        <div className="space-y-3">
          {formError && (
            <div className="text-accent-error text-sm px-3 py-2 bg-accent-error/10 rounded">{formError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Name</label>
              <input
                value={formName}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="My Command"
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">ID {editingId && <span className="text-text-muted">(read-only)</span>}</label>
              <input
                value={formId}
                onChange={e => !editingId && setFormId(e.target.value)}
                readOnly={!!editingId}
                placeholder="my-command"
                className={`w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary ${editingId ? 'opacity-60' : ''}`}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Message</label>
            <textarea
              value={formPrompt}
              onChange={e => setFormPrompt(e.target.value)}
              placeholder="The message that will be sent when this command is triggered..."
              className="w-full h-64 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !formName || !formPrompt}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Commands" size="md">
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Commands are pre-defined messages you can send with a single click.
        </p>
        <Button variant="primary" size="sm" onClick={handleNew} className="flex-shrink-0 ml-3">
          + New
        </Button>
      </div>

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
                <span className="text-text-primary text-sm font-medium">{command.name}</span>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleEdit(command.id)}
                  className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors"
                  title="Edit command"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>

                {confirmDeleteId === command.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(command.id)}
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
                    onClick={() => setConfirmDeleteId(command.id)}
                    className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-accent-error transition-colors"
                    title="Delete command"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
