import { useState, useEffect } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { useDevServerStore } from '../../stores/dev-server'

interface DevServerConfigModalProps {
  isOpen: boolean
  onClose: () => void
}

export function DevServerConfigModal({ isOpen, onClose }: DevServerConfigModalProps) {
  const config = useDevServerStore(s => s.config)
  const saveConfig = useDevServerStore(s => s.saveConfig)

  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [hotReload, setHotReload] = useState(false)
  const [disableInspect, setDisableInspect] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setCommand(config?.command ?? '')
      setUrl(config?.url ?? '')
      setHotReload(config?.hotReload ?? false)
      setDisableInspect(config?.disableInspect ?? false)
    }
  }, [isOpen, config])

  const handleSave = async () => {
    if (!command.trim() || !url.trim()) return
    setSaving(true)
    await saveConfig({ command: command.trim(), url: url.trim(), hotReload, disableInspect })
    setSaving(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dev Server Config" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-text-secondary mb-1">Command</label>
          <input
            className="input w-full"
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            placeholder="npm run dev"
          />
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">Dev URL</label>
          <input
            className="input w-full"
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="hotReload"
            checked={hotReload}
            onChange={e => setHotReload(e.target.checked)}
            className="rounded border-border bg-bg-tertiary"
          />
          <label htmlFor="hotReload" className="text-xs text-text-secondary">
            Hot Reload
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="disableInspect"
            checked={disableInspect}
            onChange={e => setDisableInspect(e.target.checked)}
            className="rounded border-border bg-bg-tertiary"
          />
          <label htmlFor="disableInspect" className="text-xs text-text-secondary">
            Disable inspect feedback
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !command.trim() || !url.trim()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
