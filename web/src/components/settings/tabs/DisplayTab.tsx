import { useState, useEffect } from 'react'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
import { ThemeEditor } from '../ThemeEditor'

function ThemePicker() {
  return <ThemeEditor />
}

export function DisplayTab() {
  const { settings, loading, getSetting, setSetting } = useSettingsStoreState()
  const isLoading = loading[SETTINGS_KEYS.DISPLAY_SHOW_THINKING] ?? false

  const maxItemsStr = settings[SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS] ?? '300'
  const [maxItemsLocal, setMaxItemsLocal] = useState(maxItemsStr)

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS)
  }, [getSetting])

  useEffect(() => {
    setMaxItemsLocal(maxItemsStr)
  }, [maxItemsStr])

  const saveMaxItems = () => {
    const num = parseInt(maxItemsLocal, 10)
    const clamped = isNaN(num) || num < 0 ? 0 : Math.min(num, 9999)
    setMaxItemsLocal(String(clamped))
    setSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS, String(clamped))
  }

  const toggles = [
    {
      key: SETTINGS_KEYS.DISPLAY_SHOW_THINKING,
      label: 'Show thinking blocks',
      description: 'Display AI reasoning content in the feed',
    },
    {
      key: SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT,
      label: 'Show expanded tool output',
      description: 'Always show full tool call details instead of compact view',
    },
    {
      key: SETTINGS_KEYS.DISPLAY_SHOW_STATS,
      label: 'Show stats bar',
      description: 'Display model, tokens, and timing information',
    },
    {
      key: SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS,
      label: 'Show agent definitions',
      description: 'Display agent definition injections in the feed',
    },
    {
      key: SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS,
      label: 'Show workflow bars',
      description: 'Display workflow start and end markers',
    },
    {
      key: SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING,
      label: 'Show syntax highlighting',
      description: 'Nicer formatting, but costly - applies to code blocks, diffs, and file previews',
    },
  ] as const

  const localValues = Object.fromEntries(toggles.map((t) => [t.key, settings[t.key] ?? 'true'])) as Record<
    (typeof toggles)[number]['key'],
    string
  >
  const [local, setLocal] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggles.map((t) => [t.key, localValues[t.key] === 'true'])),
  )

  useEffect(() => {
    toggles.forEach((t) => getSetting(t.key))
  }, [getSetting])

  useEffect(() => {
    setLocal(Object.fromEntries(toggles.map((t) => [t.key, localValues[t.key] === 'true'])))
  }, [JSON.stringify(localValues)])

  const handleToggle = async (key: string) => {
    const newValue = String(!local[key as keyof typeof local])
    setLocal((prev) => ({ ...prev, [key]: !prev[key as keyof typeof local] }))
    await setSetting(key, newValue)
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <ThemePicker />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Feed Display</h3>
        <div className="space-y-4">
          {toggles.map(({ key, label, description }) => (
            <label key={key} className="flex items-start justify-between gap-3 cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary font-medium">{label}</div>
                <div className="text-xs text-text-muted mt-0.5">{description}</div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(key)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                  local[key] ? 'bg-accent-primary' : 'bg-bg-tertiary'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    local[key] ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary font-medium">Max visible items</div>
            <div className="text-xs text-text-muted mt-0.5">
              Keep only the last N items in the feed. Set to 0 to show all.
            </div>
          </div>
          <input
            type="number"
            min={0}
            max={9999}
            value={maxItemsLocal}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9]/g, '')
              setMaxItemsLocal(cleaned)
            }}
            onBlur={saveMaxItems}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveMaxItems()
            }}
            className="w-20 px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded text-right"
          />
        </label>
      </div>
    </div>
  )
}
