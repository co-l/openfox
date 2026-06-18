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

  const [localToggles, setLocalToggles] = useState({
    openInEditor: showOpenInEditor,
    dynamicPrompt: dynamicSystemPrompt,
  })

  const [retryPatterns, setRetryPatterns] = useState<RetryPatternsValue>({ patterns: [], maxRetriesPerTurn: 10 })

  useEffect(() => {
    setLocalToggles({
      openInEditor: showOpenInEditor,
      dynamicPrompt: dynamicSystemPrompt,
    })
  }, [showOpenInEditor, dynamicSystemPrompt])

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR)
    getSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT)
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

  function handleLaunchOnboarding() {
    onClose()
    navigate('/onboarding')
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="flex items-start justify-between gap-3 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary">Dynamic System Prompt</div>
            <div className="text-xs text-text-muted mt-0.5">
              Rebuild the system prompt on every turn. When disabled, changes are applied on demand via the context
              header for better cache performance.
            </div>
          </div>
          <div className="flex-shrink-0">
            <Toggle enabled={localToggles.dynamicPrompt} onClick={handleToggleDynamicSystemPrompt} />
          </div>
        </label>
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Auto-Retry Patterns</h3>
        <p className="text-xs text-text-muted mb-3">
          Define regex patterns that, when matched against LLM responses mid-stream, trigger an automatic retry with a
          "continue" prompt. The content that triggered the match is preserved in the chat feed.
        </p>
        <RetryPatternsEditor value={retryPatterns} onChange={handleRetryPatternsChange} />
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Integrations</h3>
        <label className="flex items-start justify-between gap-3 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Show "Open in VSCode" links</div>
            <div className="text-xs text-text-muted mt-0.5">
              Display a link on file reads to open the file directly in VS Code.
            </div>
          </div>
          <div className="flex-shrink-0">
            <Toggle enabled={localToggles.openInEditor} onClick={handleToggleOpenInEditor} />
          </div>
        </label>
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
