import { useState, useEffect, useCallback } from 'react'
import type { Project, DangerLevel } from '@shared/types.js'
import { Modal } from '../shared/SelfContainedModal'
import { ModalCrumbTitle } from '../shared/ModalCrumbTitle'
import { McpServerCard } from './McpServerCard'
import { ModalFooter } from '../shared/ModalFooter'
import { useProjectStore } from '../../stores/project'
import { useResource } from '../../hooks/useResource'
import {
  agentsResource,
  mcpServersResource,
  workspaceConfigResource,
  saveWorkspaceConfig,
  type WorkspaceConfigResponse,
} from '../../lib/resources'
import { SETTINGS_KEYS } from '../../lib/resources'
import { useSetting } from '../../hooks/useSetting'
import { mcpStatusColor, mcpStatusDot } from '../../lib/mcp-utils'
import { wsClient } from '../../lib/ws'
import { authFetch } from '../../lib/api'
import { formatRootDir, getRootDirBlockReason, suggestRootDirChild } from '@shared/workspace.js'
import { dedupById } from '../../lib/modal-utils'
import { useWorkflows } from '../../hooks/useWorkflows'
import { SCOPE_LABELS } from '../../lib/workflow-scope'
import { useT } from '../../hooks/useT'

interface ProjectSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
}

export function ProjectSettingsModal({ isOpen, onClose, project }: ProjectSettingsModalProps) {
  const t = useT()
  const updateProject = useProjectStore((state) => state.updateProject)
  const autoActionTimeoutSetting = useSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, '90').value
  const autoActionSeconds = /^\d+$/.test(autoActionTimeoutSetting) ? autoActionTimeoutSetting : '90'
  const { data: wsConfig, loading: wsLoading } = useResource(workspaceConfigResource, project.workdir)
  const { data } = useResource(agentsResource, project.workdir)
  const defaultAgents = data?.defaults ?? []
  const userAgents = data?.userItems ?? []
  const projectAgents = data?.projectItems ?? []
  const topLevelByScope = {
    builtin: defaultAgents.filter((a) => !a.subagent),
    user: userAgents.filter((a) => !a.subagent),
    project: projectAgents.filter((a) => !a.subagent),
  }
  const topLevelAgents = dedupById(dedupById(topLevelByScope.builtin, topLevelByScope.user), topLevelByScope.project)
  const { workflows: scopedWorkflows } = useWorkflows(project.workdir)
  // Dedup by id keeping the LAST entry (defaults → user → project), mirroring
  // the server's effective catalog: for a favorite stored by id, the orchestrator
  // launches the project definition when one exists (project > user > builtin).
  const workflows = Array.from(new Map(scopedWorkflows.map((w) => [w.id, w])).values())
  const scopeOrder = [
    { label: 'Project', agents: topLevelByScope.project },
    { label: 'User', agents: topLevelByScope.user },
    { label: 'Built-in', agents: topLevelByScope.builtin },
  ]
  const groupedAgents = scopeOrder.map((scope) => ({
    label: scope.label,
    agents: scope.agents.filter(
      (agent) =>
        !scopeOrder
          .slice(0, scopeOrder.indexOf(scope))
          .some((higher) => higher.agents.some((candidate) => candidate.id === agent.id)),
    ),
  }))

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
  const [defaultAgent, setDefaultAgent] = useState(project.defaultAgent ?? '')
  const [favoriteWorkflow, setFavoriteWorkflow] = useState(project.favoriteWorkflowId ?? '')
  const [autoAnswer, setAutoAnswer] = useState<'inherit' | 'true' | 'false'>(
    project.autoAnswerQuestions === undefined ? 'inherit' : project.autoAnswerQuestions ? 'true' : 'false',
  )
  const [autoActionTimeout, setAutoActionTimeout] = useState(
    project.autoActionTimeoutSeconds === undefined ? '' : String(project.autoActionTimeoutSeconds),
  )
  const [instructionsDirty, setInstructionsDirty] = useState(false)
  const [dangerLevelDirty, setDangerLevelDirty] = useState(false)
  const [defaultAgentDirty, setDefaultAgentDirty] = useState(false)
  const [favoriteWorkflowDirty, setFavoriteWorkflowDirty] = useState(false)
  const [autoAnswerDirty, setAutoAnswerDirty] = useState(false)
  const [autoActionTimeoutDirty, setAutoActionTimeoutDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const currentAgentMissing = defaultAgent !== '' && !topLevelAgents.some((a) => a.id === defaultAgent)
  const currentFavoriteMissing = favoriteWorkflow !== '' && !workflows.some((w) => w.id === favoriteWorkflow)
  const showAutoActionTimeout = favoriteWorkflow !== '' || autoAnswer !== 'inherit'

  const [setupCmd, setSetupCmd] = useState('')
  const [setupDirty, setSetupDirty] = useState(false)
  const [rootDir, setRootDir] = useState('')
  const [rootDirDirty, setRootDirDirty] = useState(false)

  const [pendingRootDir, setPendingRootDir] = useState('')
  const [showCreateDirModal, setShowCreateDirModal] = useState(false)
  const [showMigrationWarning, setShowMigrationWarning] = useState(false)
  const [pendingWorkspaces, setPendingWorkspaces] = useState<{ name: string }[]>([])
  const [resolvedPath, setResolvedPath] = useState('')

  const [mcpOverrides, setMcpOverrides] = useState<Record<string, { disabled?: boolean; disabledTools?: string[] }>>({})
  const [mcpDirty, setMcpDirty] = useState(false)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())

  const isDirty =
    instructionsDirty ||
    dangerLevelDirty ||
    defaultAgentDirty ||
    favoriteWorkflowDirty ||
    autoAnswerDirty ||
    autoActionTimeoutDirty ||
    setupDirty ||
    rootDirDirty ||
    mcpDirty

  const resetForm = useCallback(() => {
    setCustomInstructions(project.customInstructions ?? '')
    setDangerLevel(project.dangerLevel ?? '')
    setDefaultAgent(project.defaultAgent ?? '')
    setFavoriteWorkflow(project.favoriteWorkflowId ?? '')
    setAutoAnswer(
      project.autoAnswerQuestions === undefined ? 'inherit' : project.autoAnswerQuestions ? 'true' : 'false',
    )
    setAutoActionTimeout(project.autoActionTimeoutSeconds === undefined ? '' : String(project.autoActionTimeoutSeconds))
    setInstructionsDirty(false)
    setDangerLevelDirty(false)
    setDefaultAgentDirty(false)
    setFavoriteWorkflowDirty(false)
    setAutoAnswerDirty(false)
    setAutoActionTimeoutDirty(false)
    setSetupDirty(false)
    setRootDirDirty(false)
  }, [project])

  useEffect(() => {
    if (isOpen) {
      resetForm()
      setMcpDirty(false)
      setExpandedServers(new Set())
    }
  }, [isOpen, project, resetForm])

  useEffect(() => {
    if (wsConfig?.setup && wsConfig.setup.length > 0) {
      setSetupCmd(wsConfig.setup.join(' && '))
    } else {
      setSetupCmd('')
    }
    setRootDir(wsConfig?.rootDir ?? '')
    setMcpOverrides(wsConfig?.mcpOverrides ?? {})
  }, [wsConfig])

  const mcpServers = useResource(mcpServersResource).data ?? []

  const getServerOverride = (name: string) => mcpOverrides[name] ?? {}
  const isServerDisabled = (name: string) => {
    const override = getServerOverride(name)
    if (override.disabled !== undefined) return override.disabled
    const server = mcpServers.find((s) => s.name === name)
    return !!server?.config?.disabled
  }
  const isToolDisabled = (serverName: string, toolName: string) => {
    const override = getServerOverride(serverName)
    return override.disabledTools?.includes(toolName) ?? false
  }
  const toggleServer = (name: string) => {
    setMcpOverrides((prev) => ({
      ...prev,
      [name]: { ...prev[name], disabled: !isServerDisabled(name) },
    }))
    setMcpDirty(true)
  }
  const toggleTool = (serverName: string, toolName: string) => {
    setMcpOverrides((prev) => {
      const override = prev[serverName] ?? {}
      const currentDisabled = override.disabledTools ?? []
      const newDisabled = currentDisabled.includes(toolName)
        ? currentDisabled.filter((t) => t !== toolName)
        : [...currentDisabled, toolName]
      return {
        ...prev,
        [serverName]: { ...override, disabledTools: newDisabled.length > 0 ? newDisabled : undefined },
      }
    })
    setMcpDirty(true)
  }
  const toggleExpand = (name: string) => {
    setExpandedServers((prev) => {
      if (prev.has(name)) {
        const n = new Set(prev)
        n.delete(name)
        return n
      }
      const n = new Set(prev)
      n.add(name)
      return n
    })
  }

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
    const projectUpdates: {
      customInstructions: string | null
      dangerLevel: DangerLevel | null
      defaultAgent?: string | null
      favoriteWorkflowId?: string | null
      autoAnswerQuestions?: boolean | null
      autoActionTimeoutSeconds?: number | null
    } = {
      customInstructions: customInstructions || null,
      dangerLevel: dangerLevelValue,
    }
    if (defaultAgentDirty) {
      projectUpdates.defaultAgent = defaultAgent === '' ? null : defaultAgent
    }
    if (favoriteWorkflowDirty) {
      projectUpdates.favoriteWorkflowId = favoriteWorkflow === '' ? null : favoriteWorkflow
    }
    if (autoAnswerDirty) {
      projectUpdates.autoAnswerQuestions = autoAnswer === 'inherit' ? null : autoAnswer === 'true'
    }
    if (autoActionTimeoutDirty) {
      const trimmed = autoActionTimeout.trim()
      const parsed = Number(trimmed)
      projectUpdates.autoActionTimeoutSeconds =
        trimmed === '' ? null : Number.isInteger(parsed) && parsed >= 1 ? parsed : null
    }
    await updateProject(project.id, projectUpdates)
    if (setupDirty || rootDirDirty || mcpDirty) {
      const setup = setupCmd.trim()
        ? setupCmd
            .split('&&')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      const wsConfigPayload: WorkspaceConfigResponse = {}
      if (setupDirty) wsConfigPayload.setup = setup
      if (rootDirDirty) wsConfigPayload.rootDir = rootDir.trim()
      if (mcpDirty) wsConfigPayload.mcpOverrides = mcpOverrides
      await saveWorkspaceConfig(project.workdir, wsConfigPayload)
    }
    setInstructionsDirty(false)
    setDangerLevelDirty(false)
    setDefaultAgentDirty(false)
    setFavoriteWorkflowDirty(false)
    setAutoAnswerDirty(false)
    setAutoActionTimeoutDirty(false)
    setSetupDirty(false)
    setRootDirDirty(false)
    setMcpDirty(false)
    handleClose()
  }, [
    project.id,
    dangerLevel,
    customInstructions,
    defaultAgent,
    defaultAgentDirty,
    favoriteWorkflow,
    favoriteWorkflowDirty,
    autoAnswer,
    autoAnswerDirty,
    autoActionTimeout,
    autoActionTimeoutDirty,
    setupCmd,
    rootDir,
    mcpOverrides,
    setupDirty,
    rootDirDirty,
    mcpDirty,
    updateProject,
    project.workdir,
    handleClose,
  ])

  const saveSettings = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await persistSettings()
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : t({ en: 'Failed to save settings', fr: 'Échec de l’enregistrement des paramètres' }),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const trimmedRootDir = rootDir.trim()
    const prevRootDir = wsConfig?.rootDir ?? ''

    if (trimmedRootDir) {
      const blockReason = getRootDirBlockReason(trimmedRootDir)
      if (blockReason === 'exact') {
        const displayPath = formatRootDir(trimmedRootDir)
        setSaveError(
          t(
            {
              en: 'Cannot use "{{path}}" directly as workspace root. Use a subdirectory like "{{suggestion}}" instead.',
              fr: 'Impossible d’utiliser « {{path}} » directement comme racine du workspace. Utilisez plutôt un sous-dossier comme « {{suggestion}} ».',
            },
            { path: displayPath, suggestion: suggestRootDirChild(trimmedRootDir, project.name) },
          ),
        )
        return
      }
      if (blockReason === 'virtual_fs') {
        setSaveError(
          t(
            {
              en: 'Cannot use paths under "{{path}}" for workspaces.',
              fr: 'Impossible d’utiliser les chemins sous « {{path}} » pour les workspaces.',
            },
            { path: trimmedRootDir },
          ),
        )
        return
      }
    }

    if (!rootDirDirty || !trimmedRootDir || trimmedRootDir === prevRootDir) {
      await saveSettings()
      return
    }

    setPendingRootDir(trimmedRootDir)
    setSaving(true)
    setSaveError(null)

    try {
      const res = await authFetch(`/api/workspace/config/validate?workdir=${encodeURIComponent(project.workdir)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootDir: trimmedRootDir,
          workdir: project.workdir,
          projectName: project.name,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(
          data?.error ??
            t({
              en: 'Failed to validate workspace root directory',
              fr: 'Échec de la validation du dossier racine du workspace',
            }),
        )
        return
      }

      const data = await res.json()

      if (!data.exists) {
        setResolvedPath(data.resolvedPath)
        setShowCreateDirModal(true)
        return
      }

      if (data.workspaces && data.workspaces.length > 0) {
        setPendingWorkspaces(data.workspaces)
        setShowMigrationWarning(true)
        return
      }

      setSaveError(null)
      await persistSettings()
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : t({ en: 'Failed to validate settings', fr: 'Échec de la validation des paramètres' }),
      )
    } finally {
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
        body: JSON.stringify({
          rootDir: pendingRootDir,
          workdir: project.workdir,
          projectName: project.name,
          createIfMissing: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data?.error ?? t({ en: 'Failed to create directory', fr: 'Échec de la création du dossier' }))
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
      setSaveError(
        err instanceof Error
          ? err.message
          : t({ en: 'Failed to create directory', fr: 'Échec de la création du dossier' }),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmMigration = async () => {
    setShowMigrationWarning(false)
    await saveSettings()
  }

  const handleCancel = () => {
    setShowCreateDirModal(false)
    setShowMigrationWarning(false)
    resetForm()
    handleClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={<ModalCrumbTitle projectName={project.name}>{t({ en: 'Settings', fr: 'Paramètres' })}</ModalCrumbTitle>}
      size="lg"
      footer={
        <ModalFooter onCancel={handleCancel} onSave={handleSave} saving={saving} saveDisabled={!isDirty || saving} />
      }
    >
      <div className="flex flex-col gap-5 -mt-1">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">
            {t({ en: 'Default Danger Level', fr: 'Niveau de danger par défaut' })}
          </label>
          <p className="text-sm text-text-muted mb-3">
            {t({
              en: 'Default danger level for new sessions in this project. Existing sessions are not affected.',
              fr: 'Niveau de danger par défaut pour les nouvelles sessions de ce projet. Les sessions existantes ne sont pas affectées.',
            })}
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
              title={t({ en: 'Use global default (Normal)', fr: 'Utiliser le défaut global (Normal)' })}
            >
              {t({ en: 'Default', fr: 'Défaut' })}
            </button>
            <button
              type="button"
              onClick={() => handleDangerLevelChange('normal')}
              className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                dangerLevel === 'normal'
                  ? 'bg-accent-success/20 text-accent-success border border-accent-success/30'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              title={t({
                en: 'Normal mode - requires path confirmation',
                fr: 'Mode normal - nécessite une confirmation du chemin',
              })}
            >
              {t({ en: 'Normal', fr: 'Normal' })}
            </button>
            <button
              type="button"
              onClick={() => handleDangerLevelChange('dangerous')}
              className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                dangerLevel === 'dangerous'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              title={t({
                en: 'Dangerous mode - bypasses all confirmations',
                fr: 'Mode dangereux - contourne toutes les confirmations',
              })}
            >
              {t({ en: 'Dangerous', fr: 'Dangereux' })}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="project-default-agent"
            className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0"
          >
            {t({ en: 'Default Agent', fr: 'Agent par défaut' })}
          </label>
          <p className="text-sm text-text-muted mb-3">
            {t({
              en: 'Default agent for new sessions in this project. Choose "Use system default" to follow the global default agent. Existing sessions are not affected.',
              fr: 'Agent par défaut pour les nouvelles sessions de ce projet. Choisissez « Utiliser le défaut système » pour suivre l’agent global par défaut. Les sessions existantes ne sont pas affectées.',
            })}
          </p>
          <select
            id="project-default-agent"
            value={defaultAgent}
            onChange={(e) => {
              setDefaultAgent(e.target.value)
              setDefaultAgentDirty(true)
            }}
            className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            disabled={saving}
          >
            <option value="">{t({ en: 'Use system default', fr: 'Utiliser le défaut système' })}</option>
            {currentAgentMissing && (
              <option value={defaultAgent}>
                {defaultAgent} {t({ en: '(missing agent)', fr: '(agent manquant)' })}
              </option>
            )}
            {groupedAgents.map(
              ({ label, agents }) =>
                agents.length > 0 && (
                  <optgroup key={label} label={label}>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </optgroup>
                ),
            )}
          </select>
          {currentAgentMissing && (
            <p className="text-xs text-red-400 mt-1">
              {t(
                {
                  en: 'The stored default agent "{{agent}}" no longer exists. Pick another agent to restore a valid default.',
                  fr: 'L’agent par défaut enregistré « {{agent}} » n’existe plus. Choisissez un autre agent pour restaurer un défaut valide.',
                },
                { agent: defaultAgent },
              )}
            </p>
          )}
          {topLevelAgents.length === 0 && (
            <p className="text-xs text-text-muted mt-1">
              {t({
                en: 'No agents available. Create one in the Agents modal.',
                fr: 'Aucun agent disponible. Créez-en un dans la fenêtre Agents.',
              })}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="project-favorite-workflow"
            className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0"
          >
            {t({ en: 'Favorite Workflow', fr: 'Workflow favori' })}
          </label>
          <p className="text-sm text-text-muted mb-3">
            {t(
              {
                en: 'When a task finishes planning, this workflow auto-launches after a {{seconds}}s countdown instead of waiting for you to choose. Choose "Use system default" to follow the global favorite workflow; "No favorite" to always pick manually. Existing sessions are not affected.',
                fr: 'Quand une tâche termine son plan, ce workflow se lance automatiquement après un compte à rebours de {{seconds}} s au lieu d’attendre votre choix. Choisissez « Utiliser le défaut système » pour suivre le workflow favori global ; « Aucun favori » pour choisir manuellement. Les sessions existantes ne sont pas affectées.',
              },
              { seconds: autoActionSeconds },
            )}
          </p>
          <select
            id="project-favorite-workflow"
            value={favoriteWorkflow}
            onChange={(e) => {
              setFavoriteWorkflow(e.target.value)
              setFavoriteWorkflowDirty(true)
            }}
            className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            disabled={saving}
          >
            <option value="">{t({ en: 'Use system default', fr: 'Utiliser le défaut système' })}</option>
            {currentFavoriteMissing && (
              <option value={favoriteWorkflow}>
                {favoriteWorkflow} {t({ en: '(missing workflow)', fr: '(workflow manquant)' })}
              </option>
            )}
            {workflows.map((w) => (
              <option key={`${w.id}-${w.scope}`} value={w.id}>
                {w.name} — {SCOPE_LABELS[w.scope]}
              </option>
            ))}
          </select>
          {currentFavoriteMissing && (
            <p className="text-xs text-red-400 mt-1">
              {t(
                {
                  en: 'The stored favorite workflow "{{workflow}}" no longer exists. Pick another workflow to restore a valid favorite.',
                  fr: 'Le workflow favori enregistré « {{workflow}} » n’existe plus. Choisissez un autre workflow pour restaurer un favori valide.',
                },
                { workflow: favoriteWorkflow },
              )}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="project-auto-answer"
            className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0"
          >
            {t({ en: 'Auto-answer Agent Questions', fr: 'Réponse automatique aux questions de l\u2019agent' })}
          </label>
          <p className="text-sm text-text-muted mb-3">
            {t(
              {
                en: 'When the agent asks a choice or confirmation question, the recommended answer (the first option, or "Yes") is applied automatically after a {{seconds}}s countdown. Choose "Use system default" to follow the global setting. Free-text questions are disabled while this mode is on. Applies from the next question onward, including in running sessions.',
                fr: 'Quand l’agent pose une question à choix ou de confirmation, la réponse recommandée (la première option, ou « Oui ») est appliquée automatiquement après un compte à rebours de {{seconds}} s. Choisissez « Utiliser le défaut système » pour suivre le réglage global. Les questions texte libres sont désactivées quand ce mode est activé. S’applique dès la question suivante, y compris dans les sessions en cours.',
              },
              { seconds: autoActionSeconds },
            )}
          </p>
          <select
            id="project-auto-answer"
            value={autoAnswer}
            onChange={(e) => {
              setAutoAnswer(e.target.value as 'inherit' | 'true' | 'false')
              setAutoAnswerDirty(true)
            }}
            className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            disabled={saving}
          >
            <option value="inherit">{t({ en: 'Use system default', fr: 'Utiliser le défaut système' })}</option>
            <option value="true">{t({ en: 'Enabled for this project', fr: 'Activé pour ce projet' })}</option>
            <option value="false">{t({ en: 'Disabled for this project', fr: 'Désactivé pour ce projet' })}</option>
          </select>
        </div>

        {showAutoActionTimeout && (
          <div>
            <label
              htmlFor="project-auto-action-timeout"
              className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0"
            >
              {t({ en: 'Automatic Actions Timeout', fr: 'Timeout des actions automatiques' })}
            </label>
            <p className="text-sm text-text-muted mb-3">
              {t({
                en: 'Seconds before the automatic behaviors fire: favorite-workflow auto-launch and question auto-answer. Leave empty to follow the global setting (default 90).',
                fr: 'Secondes avant le déclenchement des comportements automatiques : lancement automatique du workflow favori et réponse automatique aux questions. Laissez vide pour suivre le réglage global (par défaut 90).',
              })}
            </p>
            <input
              id="project-auto-action-timeout"
              type="number"
              min={1}
              step={1}
              value={autoActionTimeout}
              onChange={(e) => {
                setAutoActionTimeout(e.target.value)
                setAutoActionTimeoutDirty(true)
              }}
              placeholder={t(
                { en: 'Use system default ({{seconds}})', fr: 'Défaut système ({{seconds}})' },
                { seconds: autoActionTimeoutSetting || '90' },
              )}
              className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
              disabled={saving}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">
            {t({ en: 'Project Path', fr: 'Chemin du projet' })}
          </label>
          <p className="text-sm text-text-muted font-mono">{project.workdir}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">
            {t({ en: 'Project Instructions', fr: 'Instructions du projet' })}
          </label>
          <p className="text-sm text-text-muted mb-3 flex-shrink-0">
            {t({
              en: 'These instructions are injected into prompts when working in this project. They are applied after global instructions but before AGENTS.md files.',
              fr: 'Ces instructions sont injectées dans les invites lorsque vous travaillez dans ce projet. Elles sont appliquées après les instructions globales mais avant les fichiers AGENTS.md.',
            })}
          </p>
          <textarea
            value={customInstructions}
            onChange={handleInstructionsChange}
            placeholder={t({
              en: 'Enter project-specific instructions...',
              fr: 'Saisissez des instructions spécifiques au projet...',
            })}
            className="w-full h-32 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={saving}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">
            {t({ en: 'Workspace Setup Command', fr: 'Commande de configuration du workspace' })}
          </label>
          <p className="text-sm text-text-muted mb-3">
            {t({
              en: 'Command(s) to run after creating a workspace (shared clone). Use',
              fr: 'Commande(s) à exécuter après la création d’un workspace (clone partagé). Utilisez',
            })}{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">&amp;&amp;</code>{' '}
            {t({ en: 'to chain multiple commands. Example:', fr: 'pour enchaîner plusieurs commandes. Exemple :' })}{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">npm install --prefer-offline</code>
          </p>

          {wsLoading && (
            <div className="text-xs text-text-muted mb-2">
              {t({ en: 'Loading config…', fr: 'Chargement de la configuration…' })}
            </div>
          )}

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
            {t({ en: 'Workspace Root Directory', fr: 'Dossier racine du workspace' })}
          </label>
          <p className="text-sm text-text-muted mb-3">
            {t({
              en: 'Override the default workspace location. Leave empty to use the global directory',
              fr: 'Remplacez l’emplacement par défaut du workspace. Laissez vide pour utiliser le dossier global',
            })}{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">~/.local/share/openfox/workspaces/</code>.{' '}
            {t({
              en: 'Supports absolute paths or paths relative to the project.',
              fr: 'Accepte les chemins absolus ou relatifs au projet.',
            })}
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

        {mcpServers.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1 flex-shrink-0">MCP Servers</label>
            <p className="text-sm text-text-muted mb-3">
              {t({
                en: 'Override MCP server availability for this project. These overrides apply to new conversations in this project and can be further overridden per conversation from the chat MCP selector.',
                fr: 'Remplacez la disponibilité des serveurs MCP pour ce projet. Ces remplacements s’appliquent aux nouvelles conversations de ce projet et peuvent être redéfinis par conversation depuis le sélecteur MCP du chat.',
              })}
            </p>
            <div className="space-y-2">
              {mcpServers.map((server) => {
                const effectiveDisabled = isServerDisabled(server.name)
                return (
                  <McpServerCard
                    key={server.name}
                    server={server}
                    expanded={expandedServers.has(server.name)}
                    onToggleExpand={toggleExpand}
                    serverToggleEnabled={!effectiveDisabled}
                    onServerToggle={() => toggleServer(server.name)}
                    tools={server.tools.map((t) => ({ ...t, enabled: !isToolDisabled(server.name, t.name) }))}
                    onToolToggle={(toolName) => toggleTool(server.name, toolName)}
                    statusDot={mcpStatusDot(effectiveDisabled ? 'disabled' : server.status)}
                    statusColor={mcpStatusColor(effectiveDisabled ? 'disabled' : server.status)}
                  />
                )
              })}
            </div>
          </div>
        )}

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
          title={t({ en: 'Directory not found', fr: 'Dossier introuvable' })}
          size="md"
          footer={
            <FooterButtons
              onCancel={() => setShowCreateDirModal(false)}
              onConfirm={handleCreateDirectory}
              confirmLabel={t({ en: 'Create', fr: 'Créer' })}
              confirmClassName="bg-accent-primary"
            />
          }
        >
          <p className="text-sm text-text-primary">
            {t({ en: 'The directory', fr: 'Le dossier' })}{' '}
            <code className="text-xs bg-bg-tertiary px-1 rounded">{resolvedPath}</code>{' '}
            {t({ en: 'does not exist.', fr: "n'existe pas." })}
          </p>
          <p className="text-sm text-text-muted mt-2">
            {t({ en: 'Would you like to create it?', fr: 'Souhaitez-vous le créer ?' })}
          </p>
        </Modal>
      )}

      {showMigrationWarning && (
        <Modal
          isOpen={showMigrationWarning}
          onClose={() => setShowMigrationWarning(false)}
          title={t({ en: 'Orphaned workspaces', fr: 'Workspaces orphelins' })}
          size="md"
          footer={
            <FooterButtons
              onCancel={() => setShowMigrationWarning(false)}
              onConfirm={handleConfirmMigration}
              confirmLabel={t({ en: 'Confirm change', fr: 'Confirmer le changement' })}
              confirmClassName="bg-red-500"
            />
          }
        >
          <p className="text-sm text-text-primary">
            {t(
              {
                en: {
                  one: '{{count}} existing workspace will not be migrated and will become inaccessible:',
                  other: '{{count}} existing workspaces will not be migrated and will become inaccessible:',
                },
                fr: {
                  one: '{{count}} workspace existant ne sera pas migré et deviendra inaccessible :',
                  other: '{{count}} workspaces existants ne seront pas migrés et deviendront inaccessibles :',
                },
              },
              { count: pendingWorkspaces.length },
            )}
          </p>
          <ul className="mt-2 space-y-1">
            {pendingWorkspaces.map((ws) => (
              <li key={ws.name} className="text-sm font-mono text-text-muted">
                {ws.name}
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-muted mt-3">
            {t({
              en: 'Existing workspaces will remain in the old location but will no longer be accessible from this project.',
              fr: 'Les workspaces existants resteront dans leur ancien emplacement mais ne seront plus accessibles depuis ce projet.',
            })}
          </p>
        </Modal>
      )}
    </Modal>
  )
}

function FooterButtons({
  onCancel,
  onConfirm,
  confirmLabel,
  confirmClassName,
}: {
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
  confirmClassName: string
}) {
  const t = useT()
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 text-sm font-medium rounded bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
      >
        {t({ en: 'Cancel', fr: 'Annuler' })}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className={`px-4 py-2 text-sm font-medium rounded text-white hover:opacity-90 transition-colors ${confirmClassName}`}
      >
        {confirmLabel}
      </button>
    </div>
  )
}
