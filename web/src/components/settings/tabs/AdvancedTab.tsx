import { useEffect, useState, useCallback } from 'react'
import { useLocation } from 'wouter'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
import { RetryPatternsEditor, type RetryPatternsValue } from '../RetryPatternsEditor'
import { useConfigStore } from '../../../stores/config'
import { useSessionStore } from '../../../stores/session'
import { useUpdateStore } from '../../../stores/update'
import { AutoUpdateModal } from '../../AutoUpdateModal'
import { ModelCompactionControl } from '../../shared/ModelCompactionControl'

export function AdvancedTab({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation()
  const { settings, getSetting, setSetting } = useSettingsStoreState()

  const showOpenInEditor = settings[SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR] === 'true'
  const dynamicSystemPrompt = settings[SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT] === 'true'
  const cacheWarming = settings[SETTINGS_KEYS.CACHE_WARMING] === 'true'

  const [localToggles, setLocalToggles] = useState({
    openInEditor: showOpenInEditor,
    dynamicPrompt: dynamicSystemPrompt,
    cacheWarming,
  })

  const [retryPatterns, setRetryPatterns] = useState<RetryPatternsValue>({ patterns: [], maxRetriesPerTurn: 10 })
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const version = useConfigStore((state) => state.version)
  const defaultModelSelection = useConfigStore((state) => state.defaultModelSelection)
  const providers = useConfigStore((state) => state.providers)
  const currentSession = useSessionStore((state) => state.currentSession)
  const contextState = useSessionStore((state) => state.contextState)
  const updateStatus = useUpdateStore((state) => state.status)
  const latestVersion = useUpdateStore((state) => state.latest)
  const checkForUpdate = useUpdateStore((state) => state.check)
  const versionInfo = version && latestVersion ? { current: version, latest: latestVersion } : null
  // "Up to date" only answers a manual check; the background check on app
  // load may be hours old by the time this tab is opened.
  const [manuallyChecked, setManuallyChecked] = useState(false)
  const sessionProviderId = currentSession?.providerId ?? undefined
  const sessionModelId = currentSession?.providerModel ?? undefined
  const defaultSlash = defaultModelSelection?.indexOf('/') ?? -1
  const providerId = sessionProviderId ?? (defaultSlash > 0 ? defaultModelSelection!.slice(0, defaultSlash) : undefined)
  const modelId = sessionModelId ?? (defaultSlash > 0 ? defaultModelSelection!.slice(defaultSlash + 1) : undefined)
  const selectedModel = providers
    .find((provider) => provider.id === providerId)
    ?.models.find((model) => model.id === modelId)
  const modelContext = contextState?.maxTokens ?? selectedModel?.contextWindow

  useEffect(() => {
    setLocalToggles({
      openInEditor: showOpenInEditor,
      dynamicPrompt: dynamicSystemPrompt,
      cacheWarming,
    })
  }, [showOpenInEditor, dynamicSystemPrompt, cacheWarming])

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR)
    getSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT)
    getSetting(SETTINGS_KEYS.CACHE_WARMING)
    getSetting(SETTINGS_KEYS.RETRY_PATTERNS)
  }, [getSetting])

  useEffect(() => {
    const raw = settings[SETTINGS_KEYS.RETRY_PATTERNS]
    if (raw) {
      try {
        setRetryPatterns(JSON.parse(raw))
      } catch {
        // ignore parse errors
      }
    }
  }, [settings])

  const handleRetryPatternsChange = useCallback(
    (value: RetryPatternsValue) => {
      setRetryPatterns(value)
      setSetting(SETTINGS_KEYS.RETRY_PATTERNS, JSON.stringify(value))
    },
    [setSetting],
  )

  const handleToggleOpenInEditor = () => {
    const newValue = !localToggles.openInEditor
    setLocalToggles((prev) => ({ ...prev, openInEditor: newValue }))
    setSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR, String(newValue))
  }

  const handleToggleDynamicSystemPrompt = () => {
    const newValue = !localToggles.dynamicPrompt
    setLocalToggles((prev) => ({ ...prev, dynamicPrompt: newValue }))
    setSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT, String(newValue))
  }

  const handleToggleCacheWarming = () => {
    const newValue = !localToggles.cacheWarming
    setLocalToggles((prev) => ({ ...prev, cacheWarming: newValue }))
    setSetting(SETTINGS_KEYS.CACHE_WARMING, String(newValue))
  }

  function handleLaunchOnboarding() {
    onClose()
    navigate('/onboarding')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">
          {updateStatus === 'available' && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-primary mr-1.5 align-middle" />
          )}
          Updates
        </h3>
        <p className="text-sm text-text-muted mb-4">
          {version ? (
            <>
              Current version: <span className="font-mono">v{version}</span>
            </>
          ) : (
            'Check for a new OpenFox version.'
          )}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setManuallyChecked(true)
              checkForUpdate()
            }}
            disabled={updateStatus === 'checking'}
          >
            {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
          </Button>
          {manuallyChecked && updateStatus === 'upToDate' && (
            <span className="text-sm text-text-muted">Up to date</span>
          )}
          {updateStatus === 'error' && <span className="text-sm text-text-muted">Update check failed</span>}
          {updateStatus === 'available' && (
            <button onClick={() => setShowUpdateModal(true)} className="text-sm text-accent-primary hover:underline">
              Update to v{latestVersion} →
            </button>
          )}
        </div>
      </div>
      <AutoUpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} versionInfo={versionInfo} />
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Onboarding</h3>
        <p className="text-sm text-text-muted mb-4">Manage providers, workdir and vision fallback.</p>
        <Button variant="secondary" onClick={handleLaunchOnboarding}>
          Launch Onboarding
        </Button>
      </div>
      <hr className="border-border" />
      <div>
        <SettingsToggle
          title='Show "Open in VSCode" links'
          description="Display a link on file reads to open the file directly in VS Code."
          enabled={localToggles.openInEditor}
          onToggle={handleToggleOpenInEditor}
        />
      </div>
      <hr className="border-border" />
      <SettingsToggle
        title="Speculative Cache Warming"
        description="On first keystroke in an empty session, prefill the LLM KV cache to reduce time-to-first-token."
        enabled={localToggles.cacheWarming}
        onToggle={handleToggleCacheWarming}
        boldTitle
      />
      {providerId && modelId && modelContext && (
        <>
          <hr className="border-border" />
          <ModelCompactionControl providerId={providerId} modelId={modelId} maxTokens={modelContext} />
        </>
      )}
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Auto-Retry Patterns</h3>
        <p className="text-sm text-text-muted mb-3">
          Define regex patterns that, when matched against LLM responses mid-stream, trigger an automatic retry with a
          "continue" prompt. The content that triggered the match is preserved in the chat feed.
        </p>
        <RetryPatternsEditor value={retryPatterns} onChange={handleRetryPatternsChange} />
      </div>
      <hr className="border-border" />
      <SettingsToggle
        title="Dynamic System Prompt"
        description="Rebuild the system prompt on every turn. Recommended value: off."
        enabled={localToggles.dynamicPrompt}
        onToggle={handleToggleDynamicSystemPrompt}
        boldTitle
      />
    </div>
  )
}

function SettingsToggle({
  title,
  description,
  enabled,
  onToggle,
  boldTitle,
}: {
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
  boldTitle?: boolean
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${boldTitle ? 'font-medium' : ''} text-text-primary`}>{title}</div>
        <div className="text-sm text-text-muted mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">
        <Toggle enabled={enabled} onClick={onToggle} />
      </div>
    </label>
  )
}
