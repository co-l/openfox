import { useState, useEffect } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
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
  
  const [localValue, setLocalValue] = useState(globalInstructions)
  const [isDirty, setIsDirty] = useState(false)
  
  // Fetch current value when modal opens
  useEffect(() => {
    if (isOpen) {
      getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)
    }
  }, [isOpen, getSetting])
  
  // Sync local value when settings change
  useEffect(() => {
    setLocalValue(globalInstructions)
    setIsDirty(false)
  }, [globalInstructions])
  
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value)
    setIsDirty(true)
  }
  
  const handleSave = () => {
    setSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS, localValue)
    setIsDirty(false)
    onClose()
  }
  
  const handleCancel = () => {
    setLocalValue(globalInstructions)
    setIsDirty(false)
    onClose()
  }
  
  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Global Settings" size="lg">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Global Instructions
          </label>
          <p className="text-xs text-text-muted mb-2">
            These instructions are injected into every prompt, regardless of project.
          </p>
          <textarea
            value={localValue}
            onChange={handleChange}
            placeholder="Enter global instructions that apply to all projects..."
            className="w-full h-64 px-3 py-2 bg-bg-tertiary border border-border rounded text-text-primary placeholder-text-muted text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={isLoading}
          />
        </div>
        
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSave}
            disabled={!isDirty || isLoading}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
