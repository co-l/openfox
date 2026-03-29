import { useState, useEffect } from 'react'
import { useConfigStore } from '../../stores/config'

interface ModelConfig {
  id: string
  contextWindow: number
  source: 'backend' | 'user' | 'default'
}

interface ModelPropertiesModalProps {
  isOpen: boolean
  onClose: () => void
  providerId: string
  model: ModelConfig
}

export function ModelPropertiesModal({ isOpen, onClose, providerId, model }: ModelPropertiesModalProps) {
  const [contextWindow, setContextWindow] = useState(model.contextWindow)
  const [saving, setSaving] = useState(false)
  const updateModelContext = useConfigStore(state => state.updateModelContext)
  
  useEffect(() => {
    setContextWindow(model.contextWindow)
  }, [model])
  
  if (!isOpen) return null
  
  const handleSave = async () => {
    if (contextWindow < 1024 || contextWindow > 10000000) {
      return
    }
    
    setSaving(true)
    await updateModelContext(providerId, model.id, contextWindow)
    setSaving(false)
    onClose()
  }
  
  const handleCancel = () => {
    setContextWindow(model.contextWindow)
    onClose()
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary rounded-lg shadow-xl max-w-md w-full mx-4 border border-border">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-medium text-text-primary">Model Properties</h3>
        </div>
        
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Model Name
            </label>
            <p className="text-text-primary bg-bg-tertiary px-3 py-2 rounded">
              {model.id}
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Context Window
            </label>
            <input
              type="number"
              min={1024}
              max={10000000}
              value={contextWindow}
              onChange={(e) => setContextWindow(parseInt(e.target.value) || 0)}
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-accent-primary"
            />
            <p className="text-xs text-text-muted mt-1">
              Range: 1,024 - 10,000,000 tokens
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Source
            </label>
            <p className="text-text-primary bg-bg-tertiary px-3 py-2 rounded">
              {model.source === 'backend' && 'Auto-detected from backend'}
              {model.source === 'user' && 'Manually set'}
              {model.source === 'default' && 'Default value'}
            </p>
          </div>
        </div>
        
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || contextWindow < 1024 || contextWindow > 10000000}
            className="px-4 py-2 bg-accent-primary text-white rounded hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
