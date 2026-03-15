import type { Project } from '@openfox/shared'
import { InstructionsModal } from './InstructionsModal'
import { useProjectStore } from '../../stores/project'

interface ProjectSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
}

export function ProjectSettingsModal({ isOpen, onClose, project }: ProjectSettingsModalProps) {
  const updateProject = useProjectStore(state => state.updateProject)

  const handleSave = async (value: string) => {
    updateProject(project.id, {
      customInstructions: value || null,
    })
    // Small delay to feel responsive
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return (
    <InstructionsModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${project.name} Settings`}
      label="Project Instructions"
      description="These instructions are injected into prompts when working in this project. They are applied after global instructions but before AGENTS.md files."
      placeholder="Enter project-specific instructions..."
      value={project.customInstructions ?? ''}
      onSave={handleSave}
    />
  )
}
