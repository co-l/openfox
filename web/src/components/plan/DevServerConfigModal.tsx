import { useState, useEffect } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { useT } from '../../hooks/useT'
import { useDevServerStore } from '../../stores/dev-server'
import { useDevServer } from '../../hooks/useDevServer'

interface DevServerConfigModalProps {
  isOpen: boolean
  onClose: () => void
  /** Workdir whose dev server config this modal edits (required in split view). */
  workdir?: string
}

export function DevServerConfigModal({ isOpen, onClose, workdir }: DevServerConfigModalProps) {
  const t = useT()
  const { config } = useDevServer(workdir)
  const saveConfig = useDevServerStore((s) => s.saveConfig)

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
    if (!workdir || !command.trim() || !url.trim()) return
    setSaving(true)
    await saveConfig(workdir, { command: command.trim(), url: url.trim(), hotReload, disableInspect })
    setSaving(false)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t({ en: 'Dev Server Config', fr: 'Configuration du serveur de dev' })}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !command.trim() || !url.trim()}>
            {saving ? t({ en: 'Saving...', fr: 'Enregistrement…' }) : t({ en: 'Save', fr: 'Enregistrer' })}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Command', fr: 'Commande' })}</label>
          <input
            className="input w-full"
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npm run dev"
          />
        </div>

        <div>
          <label className="block text-xs text-text-secondary mb-1">{t({ en: 'Dev URL', fr: 'URL de dev' })}</label>
          <input
            className="input w-full"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="hotReload"
            checked={hotReload}
            onChange={(e) => setHotReload(e.target.checked)}
            className="rounded border-border bg-bg-tertiary"
          />
          <label htmlFor="hotReload" className="text-xs text-text-secondary">
            {t({ en: 'Hot Reload', fr: 'Rechargement à chaud' })}
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="disableInspect"
            checked={disableInspect}
            onChange={(e) => setDisableInspect(e.target.checked)}
            className="rounded border-border bg-bg-tertiary"
          />
          <label htmlFor="disableInspect" className="text-xs text-text-secondary">
            {t({ en: 'Disable inspect feedback', fr: 'Désactiver le retour d’inspection' })}
          </label>
        </div>
      </div>
    </Modal>
  )
}
