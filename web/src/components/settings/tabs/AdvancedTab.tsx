import { useEffect, useState, useCallback } from 'react'
import { useLocation } from 'wouter'
import { authFetch } from '../../../lib/api'
import { Button } from '../../shared/Button'
import { Input } from '../../shared/Input'
import { Toggle } from '../../shared/Toggle'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
import { useTestButton } from '../../../hooks/useTestButton'
import { RetryPatternsEditor, type RetryPatternsValue } from '../RetryPatternsEditor'
import { useConfigStore } from '../../../stores/config'
import { useUpdateStore } from '../../../stores/update'
import { AutoUpdateModal } from '../../AutoUpdateModal'
import { ChangelogModal } from '../../ChangelogModal'
import { useAgentsStore } from '../../../stores/agents'

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
  const [proxyUrl, setProxyUrl] = useState('')
  const [defaultAgent, setDefaultAgent] = useState('')
  const [defaultAgentLoaded, setDefaultAgentLoaded] = useState(false)
  const [proxyTestText, proxyTestError, proxyTestSuccess, testProxy] = useTestButton()
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showChangelogModal, setShowChangelogModal] = useState(false)
  const version = useConfigStore((state) => state.version)
  const updateStatus = useUpdateStore((state) => state.status)
  const latestVersion = useUpdateStore((state) => state.latest)
  const checkForUpdate = useUpdateStore((state) => state.check)
  const versionInfo = version && latestVersion ? { current: version, latest: latestVersion } : null
  // "Up to date" only answers a manual check; the background check on app
  // load may be hours old by the time this tab is opened.
  const [manuallyChecked, setManuallyChecked] = useState(false)
  const defaults = useAgentsStore((state) => state.defaults)
  const userItems = useAgentsStore((state) => state.userItems)
  const fetchAgents = useAgentsStore((state) => state.fetchAgents)
  const topLevelAgents = [...defaults, ...userItems].filter((a) => !a.subagent)

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
    getSetting(SETTINGS_KEYS.PROXY_URL)
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

  useEffect(() => {
    const raw = settings[SETTINGS_KEYS.PROXY_URL]
    if (raw !== undefined) {
      setProxyUrl(raw)
    }
  }, [settings])

  useEffect(() => {
    fetchAgents().catch(() => {})
  }, [fetchAgents])

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DEFAULT_AGENT)
  }, [getSetting])

  useEffect(() => {
    const val = settings[SETTINGS_KEYS.DEFAULT_AGENT]
    if (val !== undefined) {
      setDefaultAgent(val)
      setDefaultAgentLoaded(true)
    }
  }, [settings])

  const handleRetryPatternsChange = useCallback(
    (value: RetryPatternsValue) => {
      setRetryPatterns(value)
      setSetting(SETTINGS_KEYS.RETRY_PATTERNS, JSON.stringify(value))
    },
    [setSetting],
  )

  const handleProxyUrlChange = (value: string) => {
    setProxyUrl(value)
    setSetting(SETTINGS_KEYS.PROXY_URL, value)
  }

  function handleTestProxy() {
    testProxy(async () => {
      const res = await authFetch('/api/proxy/test', { method: 'POST' })
      return res.json()
    })
  }

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
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => setShowChangelogModal(true)} className="text-sm text-accent-primary hover:underline">
          View Changelog →
        </button>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-text-muted">Show on update</span>
          <Toggle
            enabled={(settings[SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE] ?? 'true') === 'true'}
            onClick={() => {
              const current = settings[SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE] ?? 'true'
              const newValue = current === 'true' ? 'false' : 'true'
              setSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, newValue)
            }}
          />
        </label>
      </div>
      <ChangelogModal isOpen={showChangelogModal} onClose={() => setShowChangelogModal(false)} />
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Default Agent</h3>
        <p className="text-sm text-text-muted mb-3">
          Choose which agent is used by default for new sessions. The stock Planner is read-only; custom agents can have
          broader capabilities.
        </p>
        <select
          value={defaultAgentLoaded ? defaultAgent : ''}
          onChange={(e) => {
            const val = e.target.value
            setDefaultAgent(val)
            setSetting(SETTINGS_KEYS.DEFAULT_AGENT, val)
          }}
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
        >
          {!defaultAgentLoaded && <option value="">Loading…</option>}
          {defaultAgentLoaded && <option value="">System default (planner)</option>}
          {topLevelAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        {topLevelAgents.length === 0 && defaultAgentLoaded && (
          <p className="text-xs text-text-muted mt-1">No agents available. Create one in the Agents modal.</p>
        )}
      </div>
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
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">HTTP Proxy</h3>
        <p className="text-sm text-text-muted mb-3">
          Proxy server for LLM API requests. Leave empty for direct connection.
        </p>
        <div className="flex gap-2 items-center">
          <Input
            type="text"
            value={proxyUrl}
            onChange={(e) => handleProxyUrlChange(e.target.value)}
            placeholder="http://proxy:8080"
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={handleTestProxy}
            style={proxyTestSuccess ? { color: 'rgb(63, 185, 80)' } : undefined}
          >
            {proxyTestText}
          </Button>
        </div>
        {proxyTestError && <p className="text-xs text-red-500 mt-1">{proxyTestError}</p>}
      </div>
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
