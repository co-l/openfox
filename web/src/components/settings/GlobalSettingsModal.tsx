import { useEffect } from 'react'
import { InstructionsModal } from './InstructionsModal'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const settings = useSettingsStore(state => state.settings)
  const loading = useSettingsStore(state => state.loading)
  const getSetting = useSettingsStore(state => state.getSetting)
  const setSetting = useSettingsStore(state => state.setSetting)

  const globalInstructions = settings[SETTINGS_KEYS.GLOBAL_INSTRUCTIONS] ?? ''
  const isLoading = loading[SETTINGS_KEYS.GLOBAL_INSTRUCTIONS] ?? false

  // Fetch current value when modal opens
  useEffect(() => {
    if (isOpen) {
      getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)
    }
  }, [isOpen, getSetting])

  const handleSave = (value: string) => {
    setSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS, value)
  }

  return (
    <InstructionsModal
      isOpen={isOpen}
      onClose={onClose}
      title="Global Settings"
      label="Global Instructions"
      description="These instructions are injected into every prompt, regardless of project."
      placeholder="Enter global instructions that apply to all projects..."
      value={globalInstructions}
      isLoading={isLoading}
      onSave={handleSave}
    />
  )
}
