import { useState, useEffect } from 'react'
import type { Project, DangerLevel } from '@shared/types.js'
import { Modal } from '../shared/SelfContainedModal'
import { ModalFooter } from '../shared/ModalFooter'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceConfigStore } from '../../stores/workspace-config'
import { wsClient } from '../../lib/ws'

interface ProjectSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
}

export function ProjectSettingsModal({ isOpen, onClose, project }: ProjectSettingsModalProps) {
  const updateProject = useProjectStore((state) => state.updateProject)
  const wsConfig = useWorkspaceConfigStore((s) => s.config)
  const wsLoading = useWorkspaceConfigStore((s) => s.loading)
  const fetchWsConfig = useWorkspaceConfigStore((s) => s.fetchConfig)
  const saveWsConfig = useWorkspaceConfigStore((s) => s.saveConfig)

  const handleClose = () => {
    try {
      wsClient.send('context.checkDynamic', {})
    } catch {
      // WS might not be connected
    }
    onClose()
  }

  const [customInstructions, setCustomInstructions] = useState(project.customInstructions ?? '')
  const [dangerLevel, setDangerLevel] = useState<DangerLevel | ''>(project.dangerLevel ?? '')
  const [instructionsDirty, setInstructionsDirty] = useState(false)
  const [dangerLevelDirty, setDangerLevelDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [setupCmd, setSetupCmd] = useState('')
  const [setupDirty, setSetupDirty] = useState(false)

  const isDirty = instructionsDirty || dangerLevelDirty || setupDirty

  useEffect(() => {
    if (isOpen) {
      setCustomInstructions(project.customInstructions ?? '')
      setDangerLevel(project.dangerLevel ?? '')
      setInstructionsDirty(false)
      setDangerLevelDirty(false)
      setSetupDirty(false)
      fetchWsConfig(project.workdir)
    }
  }, [isOpen, project, fetchWsConfig])

  useEffect(() => {
    if (wsConfig?.setup && wsConfig.setup.length > 0) {
      setSetupCmd(wsConfig.setup.join(' && '))
    } else {
      setSetupCmd('')
    }
  }, [wsConfig])

  const handleInstructionsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCustomInstructions(e.target.value)
    setInstructionsDirty(true)
  }

  const handleDangerLevelChange = (value: DangerLevel | '') => {
    setDangerLevel(value)
    setDangerLevelDirty(true)
  }

  const handleSetupCmdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSetupCmd(e.target.value)
    setSetupDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const dangerLevelValue = dangerLevel === '' ? null : dangerLevel
      await updateProject(project.id, {
        customInstructions: customInstructions || null,
        dangerLevel: dangerLevelValue,
      })
      if (setupDirty) {
        const setup = setupCmd.trim()
          ? setupCmd
              .split('&&')
              .map((s) => s.trim())
              .filter(Boolean)
          : []
        await saveWsConfig(project.workdir, { setup: setup.length > 0 ? setup : undefined })
      }
      setInstructionsDirty(false)
      setDangerLevelDirty(false)
      setSetupDirty(false)
      handleClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setCustomInstructions(project.customInstructions ?? '')
    setDangerLevel(project.dangerLevel ?? '')
    setInstructionsDirty(false)
    setDangerLevelDirty(false)
    setSetupDirty(false)
    handleClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={`${project.name} Settings`}
      size="lg"
      footer={
        <ModalFooter onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!isDirty || saving} />
      }
    >
      <div className="flex flex-col gap-5 -mt-1">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">Default Danger Level</label>
          <p className="text-sm text-text-muted mb-3">
            Default danger level for new sessions in this project. Existing sessions are not affected.
          </p>
          <div className="flex items-center gap-1 px-1.5 py-1 rounded bg-bg-tertiary/50 w-fit">
            <button
              type="button"
              onClick={() => handleDangerLevelChange('')}
              className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                dangerLevel === ''
                  ? 'bg-bg-tertiary text-text-primary border border-border'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              title="Use global default (Normal)"
            >
              Default
            </button>
            <button
              type="button"
              onClick={() => handleDangerLevelChange('normal')}
              className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                dangerLevel === 'normal'
                  ? 'bg-accent-success/20 text-accent-success border border-accent-success/30'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              title="Normal mode - requires path confirmation"
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => handleDangerLevelChange('dangerous')}
              className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                dangerLevel === 'dangerous'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              title="Dangerous mode - bypasses all confirmations"
            >
              Dangerous
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">Project Path</label>
          <p className="text-sm text-text-muted font-mono">{project.workdir}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">Project Instructions</label>
          <p className="text-sm text-text-muted mb-3 flex-shrink-0">
            These instructions are injected into prompts when working in this project. They are applied after global
            instructions but before AGENTS.md files.
          </p>
          <textarea
            value={customInstructions}
            onChange={handleInstructionsChange}
            placeholder="Enter project-specific instructions..."
            className="w-full h-32 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={saving}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">
            Workspace Setup Command
          </label>
          <p className="text-sm text-text-muted mb-3">
            Command(s) to run after creating a workspace (shared clone). Use{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">&amp;&amp;</code> to chain multiple commands. Example:{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">npm install --prefer-offline</code>
          </p>

          {wsLoading && <div className="text-xs text-text-muted mb-2">Loading config...</div>}

          <input
            type="text"
            value={setupCmd}
            onChange={handleSetupCmdChange}
            placeholder="npm install --prefer-offline"
            className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={saving}
          />
        </div>

        {saveError && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
            {saveError}
          </div>
        )}
      </div>
    </Modal>
  )
}
