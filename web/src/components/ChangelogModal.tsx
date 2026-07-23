import { useState, useEffect, useCallback } from 'react'
import { Modal } from './shared/Modal'
import { Markdown } from './shared/Markdown'
import { Toggle } from './shared/Toggle'
import { authFetch } from '../lib/api'
import { useSettingsStoreState } from './settings/useSettingsStore'
import { SETTINGS_KEYS } from '../stores/settings'

interface ChangelogModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { settings, getSetting, setSetting } = useSettingsStoreState()
  const showOnUpdate = settings[SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE] !== 'false'

  useEffect(() => {
    if (!isOpen) return
    getSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE)
  }, [isOpen, getSetting])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    authFetch('/api/changelog')
      .then((res) => res.json())
      .then((data) => {
        setContent(data.content as string)
      })
      .catch(() => {
        setContent('# Changelog\n\nFailed to load changelog.')
      })
      .finally(() => setLoading(false))
  }, [isOpen])

  const handleToggleShowOnUpdate = useCallback(() => {
    const newValue = showOnUpdate ? 'false' : 'true'
    setSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, newValue)
  }, [showOnUpdate, setSetting])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="What's New in OpenFox"
      size="xl"
      closeOnBackdropClick
      showCloseButton
      footer={
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle enabled={showOnUpdate} onClick={handleToggleShowOnUpdate} />
          <span className="text-sm text-text-muted">Show changelog on future updates</span>
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
