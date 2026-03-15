import { useState, useEffect } from 'react'
import type { Project } from '@openfox/shared'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { useProjectStore } from '../../stores/project'

interface ProjectSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
}

export function ProjectSettingsModal({ isOpen, onClose, project }: ProjectSettingsModalProps) {
  const updateProject = useProjectStore(state => state.updateProject)
  
  const [localValue, setLocalValue] = useState(project.customInstructions ?? '')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Sync local value when project changes
  useEffect(() => {
    setLocalValue(project.customInstructions ?? '')
    setIsDirty(false)
  }, [project.customInstructions])
  
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value)
    setIsDirty(true)
  }
  
  const handleSave = () => {
    setSaving(true)
    updateProject(project.id, { 
      customInstructions: localValue || null 
    })
    // Note: In a real app, we'd wait for the server response
    // For now, just close after a short delay
    setTimeout(() => {
      setSaving(false)
      setIsDirty(false)
      onClose()
    }, 100)
  }
  
  const handleCancel = () => {
    setLocalValue(project.customInstructions ?? '')
    setIsDirty(false)
    onClose()
  }
  
  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={`${project.name} Settings`} size="lg">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Project Instructions
          </label>
          <p className="text-xs text-text-muted mb-2">
            These instructions are injected into prompts when working in this project.
            They are applied after global instructions but before AGENTS.md files.
          </p>
          <textarea
            value={localValue}
            onChange={handleChange}
            placeholder="Enter project-specific instructions..."
            className="w-full h-64 px-3 py-2 bg-bg-tertiary border border-border rounded text-text-primary placeholder-text-muted text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={saving}
          />
        </div>
        
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
