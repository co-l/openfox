import { useState, useEffect, useCallback } from 'react'
import type { Project, DangerLevel } from '@shared/types.js'
import { Modal } from '../shared/SelfContainedModal'
import { ModalFooter } from '../shared/ModalFooter'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceConfigStore } from '../../stores/workspace-config'
import { wsClient } from '../../lib/ws'
import { authFetch } from '../../lib/api'

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
  const [rootDir, setRootDir] = useState('')
  const [rootDirDirty, setRootDirDirty] = useState(false)

  const [pendingRootDir, setPendingRootDir] = useState('')
  const [showCreateDirModal, setShowCreateDirModal] = useState(false)
  const [showMigrationWarning, setShowMigrationWarning] = useState(false)
  const [pendingWorkspaces, setPendingWorkspaces] = useState<{ name: string }[]>([])
  const [resolvedPath, setResolvedPath] = useState('')

  const isDirty = instructionsDirty || dangerLevelDirty || setupDirty || rootDirDirty

  useEffect(() => {
    if (isOpen) {
      setCustomInstructions(project.customInstructions ?? '')
      setDangerLevel(project.dangerLevel ?? '')
      setInstructionsDirty(false)
      setDangerLevelDirty(false)
      setSetupDirty(false)
      setRootDirDirty(false)
      fetchWsConfig(project.workdir)
    }
  }, [isOpen, project, fetchWsConfig])

  useEffect(() => {
    if (wsConfig?.setup && wsConfig.setup.length > 0) {
      setSetupCmd(wsConfig.setup.join(' && '))
    } else {
      setSetupCmd('')
    }
    setRootDir(wsConfig?.rootDir ?? '')
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

  const handleRootDirChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRootDir(e.target.value)
    setRootDirDirty(true)
  }

  const persistSettings = useCallback(async () => {
    const dangerLevelValue = dangerLevel === '' ? null : dangerLevel
    await updateProject(project.id, {
      customInstructions: customInstructions || null,
      dangerLevel: dangerLevelValue,
    })
    const setup = setupCmd.trim()
      ? setupCmd
          .split('&&')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    await saveWsConfig(project.workdir, {
      ...(setup.length > 0 ? { setup } : {}),
      ...(rootDir.trim() ? { rootDir: rootDir.trim() } : {}),
    })
    setInstructionsDirty(false)
    setDangerLevelDirty(false)
    setSetupDirty(false)
    setRootDirDirty(false)
    handleClose()
  }, [
    project.id,
    dangerLevel,
    customInstructions,
    setupCmd,
    rootDir,
    updateProject,
    saveWsConfig,
    project.workdir,
    handleClose,
  ])

  const DANGEROUS_PATHS = [
    '/',
    '/etc',
    '/dev',
    '/proc',
    '/sys',
    '/boot',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/usr',
    '/var',
    '/opt',
    '/root',
    '/run',
    '/tmp',
    '/home',
    '/mnt',
    '/media',
    '/lost+found',
  ]

  const isValidRootDir = (path: string): boolean => {
    const normalized = path.replace(/\/+$/, '') || '/'
    return !DANGEROUS_PATHS.includes(normalized)
  }

  const handleSave = async () => {
    const trimmedRootDir = rootDir.trim()
    const prevRootDir = wsConfig?.rootDir ?? ''

    if (trimmedRootDir && !isValidRootDir(trimmedRootDir)) {
      setSaveError('Invalid workspace root directory: cannot use system-critical paths')
      return
    }

    if (!rootDirDirty || !trimmedRootDir || trimmedRootDir === prevRootDir) {
      setSaving(true)
      setSaveError(null)
      try {
        await persistSettings()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
      } finally {
        setSaving(false)
      }
      return
    }

    setPendingRootDir(trimmedRootDir)
    setSaving(true)
    setSaveError(null)

    try {
      const res = await authFetch(`/api/workspace/config/validate?workdir=${encodeURIComponent(project.workdir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: trimmedRootDir, workdir: project.workdir }),
      })

      if (!res.ok) {
        setSaveError('Failed to validate workspace root directory')
        setSaving(false)
        return
      }

      const data = await res.json()

      if (!data.exists) {
        setResolvedPath(data.resolvedPath)
        setSaving(false)
        setShowCreateDirModal(true)
        return
      }

      if (data.workspaces && data.workspaces.length > 0) {
        setPendingWorkspaces(data.workspaces)
        setSaving(false)
        setShowMigrationWarning(true)
        return
      }

      setSaveError(null)
      await persistSettings()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to validate settings')
      setSaving(false)
    }
  }

  const handleCreateDirectory = async () => {
    setShowCreateDirModal(false)
    setSaving(true)
    try {
      const res = await authFetch(`/api/workspace/config/validate?workdir=${encodeURIComponent(project.workdir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: pendingRootDir, workdir: project.workdir, createIfMissing: true }),
      })

      if (!res.ok) {
        setSaveError('Failed to create directory')
        setSaving(false)
        return
      }

      const data = await res.json()

      if (data.workspaces && data.workspaces.length > 0) {
        setPendingWorkspaces(data.workspaces)
        setShowMigrationWarning(true)
        setSaving(false)
        return
      }

      await persistSettings()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to create directory')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmMigration = async () => {
    setShowMigrationWarning(false)
    setSaving(true)
    setSaveError(null)
    try {
      await persistSettings()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setShowCreateDirModal(false)
    setShowMigrationWarning(false)
    setCustomInstructions(project.customInstructions ?? '')
    setDangerLevel(project.dangerLevel ?? '')
    setInstructionsDirty(false)
    setDangerLevelDirty(false)
    setSetupDirty(false)
    setRootDirDirty(false)
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
            disabled={wsLoading || saving}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">
            Workspace Root Directory
          </label>
          <p className="text-sm text-text-muted mb-3">
            Override the default workspace location. Leave empty to use the global directory{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">~/.local/share/openfox/workspaces/</code>. Supports
            absolute paths or paths relative to the project.
          </p>
          <input
            type="text"
            value={rootDir}
            onChange={handleRootDirChange}
            placeholder="/absolute/or/relative/path"
            className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={wsLoading || saving}
          />
        </div>

        {saveError && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
            {saveError}
          </div>
        )}
      </div>

      {showCreateDirModal && (
        <Modal
          isOpen={showCreateDirModal}
          onClose={() => setShowCreateDirModal(false)}
          title="Dossier introuvable"
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateDirModal(false)}
                className="px-4 py-2 text-sm font-medium rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCreateDirectory}
                className="px-4 py-2 text-sm font-medium rounded bg-accent-primary text-white hover:opacity-90 transition-colors"
              >
                Créer
              </button>
            </div>
          }
        >
          <p className="text-sm text-text-primary">
            Le dossier <code className="text-xs bg-bg-tertiary px-1 rounded">{resolvedPath}</code> n&apos;existe pas.
          </p>
          <p className="text-sm text-text-muted mt-2">Voulez-vous le créer ?</p>
        </Modal>
      )}

      {showMigrationWarning && (
        <Modal
          isOpen={showMigrationWarning}
          onClose={() => setShowMigrationWarning(false)}
          title="Workspaces orphelins"
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMigrationWarning(false)}
                className="px-4 py-2 text-sm font-medium rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmMigration}
                className="px-4 py-2 text-sm font-medium rounded bg-red-500 text-white hover:opacity-90 transition-colors"
              >
                Confirmer le changement
              </button>
            </div>
          }
        >
          <p className="text-sm text-text-primary">
            {pendingWorkspaces.length} workspace(s) existant(s) ne seront pas migrés et deviendront inutilisables :
          </p>
          <ul className="mt-2 space-y-1">
            {pendingWorkspaces.map((ws) => (
              <li key={ws.name} className="text-sm font-mono text-text-muted">
                {ws.name}
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-muted mt-3">
            Les workspaces existants resteront dans l&apos;ancien emplacement mais ne seront plus accessibles depuis ce
            projet.
          </p>
        </Modal>
      )}
    </Modal>
  )
}
