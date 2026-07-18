import { useEffect, useState, useCallback } from 'react'
import { useLocation } from 'wouter'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
import { RetryPatternsEditor, type RetryPatternsValue } from '../RetryPatternsEditor'

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
  const [overloadCooldown, setOverloadCooldown] = useState('20')
  const [transientCooldown, setTransientCooldown] = useState('2')
  const [cooldownError, setCooldownError] = useState('')

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
    getSetting(SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS)
    getSetting(SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS)
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
    const rawOverload = settings[SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS]
    const rawTransient = settings[SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS]
    const overload = Number(rawOverload)
    const transient = Number(rawTransient)
    if (rawOverload?.trim() && Number.isFinite(overload) && overload >= 0)
      setOverloadCooldown(String(overload / 60_000))
    if (rawTransient?.trim() && Number.isFinite(transient) && transient >= 0)
      setTransientCooldown(String(transient / 60_000))
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

  const saveCooldown = async (key: string, value: string) => {
    const minutes = Number(value)
    if (!value.trim() || !Number.isFinite(minutes) || minutes < 0) {
      setCooldownError('Enter a non-negative number of minutes.')
      return
    }
    const result = await setSetting(key, String(minutes * 60_000))
    setCooldownError(result.success ? '' : (result.error ?? 'Failed to save cooldown.'))
  }

  function handleLaunchOnboarding() {
    onClose()
    navigate('/onboarding')
  }

  return (
    <div className="space-y-6">
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
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Model Cascade Cooldowns</h3>
        <p className="text-xs text-text-muted mb-3">
          Unavailable models are skipped across all sessions until their cooldown expires.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-text-secondary">
            Quota / overload (minutes)
            <input
              type="number"
              min="0"
              step="1"
              value={overloadCooldown}
              onChange={(event) => setOverloadCooldown(event.target.value)}
              onBlur={() => saveCooldown(SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS, overloadCooldown)}
              className="mt-1 w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded"
            />
          </label>
          <label className="text-xs text-text-secondary">
            Network / timeout / 5xx (minutes)
            <input
              type="number"
              min="0"
              step="0.5"
              value={transientCooldown}
              onChange={(event) => setTransientCooldown(event.target.value)}
              onBlur={() => saveCooldown(SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS, transientCooldown)}
              className="mt-1 w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded"
            />
          </label>
        </div>
        {cooldownError && (
          <p role="alert" className="mt-2 text-xs text-error">
            {cooldownError}
          </p>
        )}
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Integrations</h3>
        <SettingsToggle
          title='Show "Open in VSCode" links'
          description="Display a link on file reads to open the file directly in VS Code."
          enabled={localToggles.openInEditor}
          onToggle={handleToggleOpenInEditor}
        />
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Onboarding</h3>
        <p className="text-sm text-text-muted mb-4">
          Reset your OpenFox setup and go through the initial configuration again.
        </p>
        <Button variant="secondary" onClick={handleLaunchOnboarding}>
          Launch Onboarding
        </Button>
      </div>
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
