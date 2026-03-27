import { useState, useEffect } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'
import { NotificationSettings } from './NotificationSettings'
import { SkillsContent } from './SkillsModal'

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type Tab = 'instructions' | 'skills' | 'notifications'

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('instructions')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="lg">
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="flex border-b border-border mb-4 -mt-1">
          <TabButton
            label="Instructions"
            active={activeTab === 'instructions'}
            onClick={() => setActiveTab('instructions')}
          />
          <TabButton
            label="Skills"
            active={activeTab === 'skills'}
            onClick={() => setActiveTab('skills')}
          />
          <TabButton
            label="Notifications"
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
          />
        </div>

        {/* Tab content */}
        {activeTab === 'instructions' && <InstructionsTab isOpen={isOpen} />}
        {activeTab === 'skills' && <SkillsContent isOpen={isOpen} />}
        {activeTab === 'notifications' && <NotificationSettings />}
      </div>
    </Modal>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-accent-primary text-accent-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border'
      }`}
    >
      {label}
    </button>
  )
}

function InstructionsTab({ isOpen }: { isOpen: boolean }) {
  const settings = useSettingsStore(state => state.settings)
  const loading = useSettingsStore(state => state.loading)
  const getSetting = useSettingsStore(state => state.getSetting)
  const setSetting = useSettingsStore(state => state.setSetting)

  const globalInstructions = settings[SETTINGS_KEYS.GLOBAL_INSTRUCTIONS] ?? ''
  const isLoading = loading[SETTINGS_KEYS.GLOBAL_INSTRUCTIONS] ?? false

  const [localValue, setLocalValue] = useState(globalInstructions)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)
    }
  }, [isOpen, getSetting])

  useEffect(() => {
    setLocalValue(globalInstructions)
    setIsDirty(false)
  }, [globalInstructions])

  const handleSave = async () => {
    setSaving(true)
    setSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS, localValue)
    setSaving(false)
    setIsDirty(false)
  }

  const handleDiscard = () => {
    setLocalValue(globalInstructions)
    setIsDirty(false)
  }

  const isBusy = isLoading || saving

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Global Instructions
        </label>
        <p className="text-sm text-text-muted mb-2">
          These instructions are injected into every prompt, regardless of project.
        </p>
        <textarea
          value={localValue}
          onChange={(e) => { setLocalValue(e.target.value); setIsDirty(true) }}
          placeholder="Enter global instructions that apply to all projects..."
          className="w-full h-64 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
          disabled={isBusy}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty}>
          Discard
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!isDirty || isBusy}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
