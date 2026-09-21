import { useState, useEffect, useCallback } from 'react'
import { Modal } from './shared/Modal'
import { Markdown } from './shared/Markdown'
import { Toggle } from './shared/Toggle'
import { useT } from '../hooks/useT'
import { changelogResource, SETTINGS_KEYS, setSetting } from '../lib/resources'
import { useSetting } from '../hooks/useSetting'

interface ChangelogModalProps {
  isOpen: boolean
  onClose: () => void
  since?: string
}

export function ChangelogModal({ isOpen, onClose, since }: ChangelogModalProps) {
  const t = useT()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const showOnUpdate = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, 'true', isOpen).value !== 'false'

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    const fallback = t({
      en: '# Changelog\n\nFailed to load changelog.',
      fr: '# Journal des modifications\n\nÉchec du chargement du journal.',
    })
    changelogResource
      .refresh(since)
      .then((data) => setContent(data ?? fallback))
      .catch(() => setContent(fallback))
      .finally(() => setLoading(false))
  }, [isOpen, since, t])

  const handleToggleShowOnUpdate = useCallback(() => {
    const newValue = showOnUpdate ? 'false' : 'true'
    void setSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, newValue)
  }, [showOnUpdate])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t({ en: "What's New in OpenFox", fr: 'Nouveautés d’OpenFox' })}
      size="xl"
      closeOnBackdropClick
      showCloseButton
      footer={
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle enabled={showOnUpdate} onClick={handleToggleShowOnUpdate} />
          <span className="text-sm text-text-muted">
            {t({ en: 'Show changelog on future updates', fr: 'Afficher le journal lors des prochaines mises à jour' })}
          </span>
        </label>
      }
    >
      <div className="flex flex-col gap-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown content={content ?? ''} />
          </div>
        )}
      </div>
    </Modal>
  )
}
