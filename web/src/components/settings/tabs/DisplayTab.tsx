import { useState, useEffect, useMemo } from 'react'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
import { ThemeEditor } from '../ThemeEditor'
import {
  detectAvailableFonts,
  extractPrimaryFamily,
  toFontFamilyValue,
  resolveDefaultFamily,
  DEFAULT_TERMINAL_FONT,
} from '../../../lib/fonts'

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

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">Scrollbar / Custom CSS</h3>
        <p className="text-xs text-text-muted mb-3">
          Scrollbars are quite finicky, so there is no CSS for them in OpenFox. You can add your own below or select one
          of the options and see if they match your browser needs.
        </p>
        <CustomCssEditor />
      </div>

      <div className="border-t border-border pt-4">
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

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">Terminal</h3>
        <TerminalFontEditor />
      </div>
    </div>
  )
}

const FONT_PREVIEW_TEXT = '~/project \ue0b0 git status \u2713 \u2717 \u2192 0123 iIlL1 |\u2500\u2524'

function TerminalFontEditor() {
  const { settings, getSetting, setSetting } = useSettingsStoreState()
  const savedValue = settings[SETTINGS_KEYS.DISPLAY_TERMINAL_FONT] ?? DEFAULT_TERMINAL_FONT
  const [localValue, setLocalValue] = useState(savedValue)

  const availableFonts = useMemo(() => detectAvailableFonts(), [])
  const resolvedDefault = useMemo(() => resolveDefaultFamily(), [])

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_TERMINAL_FONT)
  }, [getSetting])

  useEffect(() => {
    setLocalValue(savedValue)
  }, [savedValue])

  // The default is a fallback stack, so its first family may not be installed:
  // show the one the browser actually resolves to instead of a phantom entry.
  const isDefaultStack = savedValue === DEFAULT_TERMINAL_FONT
  const primaryFamily = isDefaultStack ? resolvedDefault : extractPrimaryFamily(savedValue)
  const isCustom = primaryFamily !== '' && !availableFonts.includes(primaryFamily)

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const family = e.target.value
    if (!family) return
    setSetting(SETTINGS_KEYS.DISPLAY_TERMINAL_FONT, toFontFamilyValue(family))
  }

  const saveCustom = () => {
    setSetting(SETTINGS_KEYS.DISPLAY_TERMINAL_FONT, localValue.trim() || DEFAULT_TERMINAL_FONT)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        Only monospace fonts detected on this machine are listed. Oh My Zsh themes need a Nerd Font for icons and
        powerline separators to render correctly.
      </p>

      <select
        value={isCustom ? '' : primaryFamily}
        onChange={handleSelect}
        className="w-full px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
      >
        {isCustom && <option value="">{`Custom: ${primaryFamily}`}</option>}
        {availableFonts.length === 0 && <option value="">No monospace font detected</option>}
        {availableFonts.map((font) => (
          <option key={font} value={font} style={{ fontFamily: `"${font}", monospace` }}>
            {font}
          </option>
        ))}
      </select>

      <div
        className="px-3 py-2 text-sm text-text-primary bg-bg-tertiary border border-border rounded overflow-x-auto whitespace-nowrap"
        style={{ fontFamily: savedValue }}
      >
        {FONT_PREVIEW_TEXT}
      </div>

      <div>
        <div className="text-xs text-text-muted mb-1">
          Not listed? Enter a CSS font-family manually (e.g. &quot;My Font&quot;, monospace)
        </div>
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={saveCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveCustom()
          }}
          className="w-full px-2 py-1 text-xs font-mono text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

const SCROLLBAR_PRESETS = [
  { label: 'None (browser default)', css: '' },
  {
    label: 'Thin scrollbars',
    css: [
      '/* Thin scrollbars for Chrome/Safari/Edge */',
      '::-webkit-scrollbar { width: 6px; height: 6px; }',
      '::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.4); border-radius: 3px; }',
      '',
      '/* Thin scrollbars for Firefox */',
      '@-moz-document url-prefix() {',
      '  * { scrollbar-width: thin; }',
      '}',
    ].join('\n'),
  },
  {
    label: 'Stable gutter (prevent layout shift)',
    css: [
      '/* Reserve scrollbar space so content does not jump when scrollbar appears */',
      '.scrollbar-stable { scrollbar-gutter: stable; }',
    ].join('\n'),
  },
  {
    label: 'Balanced gutter (stable + symmetrical)',
    css: [
      '/* Reserve space on both sides — keeps content centered */',
      '/* Note: Chrome has a bug where both-edges reserves space but the scrollbar',
      '   may not occupy it properly. Test in your browser. */',
      '.scrollbar-stable { scrollbar-gutter: stable both-edges; }',
    ].join('\n'),
  },
  {
    label: 'Always visible scrollbar',
    css: [
      '/* Force scrollbar to always show — no layout shift, no surprises */',
      '.scrollbar-stable { overflow-y: scroll; }',
    ].join('\n'),
  },
  {
    label: 'Custom colors',
    css: [
      '/* Chrome/Safari/Edge */',
      '::-webkit-scrollbar { width: 8px; height: 8px; }',
      '::-webkit-scrollbar-track { background: transparent; }',
      '::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }',
      '::-webkit-scrollbar-thumb:hover { background: #555; }',
      '',
      '/* Firefox */',
      '* { scrollbar-color: #888 transparent; }',
    ].join('\n'),
  },
] as const

function CustomCssEditor() {
  const { settings, getSetting, setSetting } = useSettingsStoreState()
  const savedCss = settings[SETTINGS_KEYS.DISPLAY_CUSTOM_CSS] ?? ''
  const [localCss, setLocalCss] = useState(savedCss)
  const [selectedPreset, setSelectedPreset] = useState('')

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_CUSTOM_CSS)
  }, [getSetting])

  useEffect(() => {
    setLocalCss(savedCss)
  }, [savedCss])

  const handleSave = () => {
    setSetting(SETTINGS_KEYS.DISPLAY_CUSTOM_CSS, localCss)
  }

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const preset = SCROLLBAR_PRESETS.find((p) => p.label === e.target.value)
    if (preset) {
      setSelectedPreset(preset.label)
      setLocalCss(preset.css)
      setSetting(SETTINGS_KEYS.DISPLAY_CUSTOM_CSS, preset.css)
    }
  }

  return (
    <div className="space-y-2">
      <select
        value={selectedPreset}
        onChange={handlePresetChange}
        className="w-full px-2 py-1.5 text-xs text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
      >
        <option value="">Try a preset…</option>
        {SCROLLBAR_PRESETS.map((preset) => (
          <option key={preset.label} value={preset.label}>
            {preset.label}
          </option>
        ))}
      </select>
      <textarea
        value={localCss}
        onChange={(e) => setLocalCss(e.target.value)}
        onBlur={handleSave}
        placeholder={`/* Paste or edit your custom CSS here */
/* Example: make Firefox scrollbar thicker */
@-moz-document url-prefix() {
  * { scrollbar-width: auto; }
}`}
        className="w-full h-32 px-3 py-2 text-xs font-mono text-text-primary bg-bg-tertiary border border-border rounded resize-y focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
        spellCheck={false}
      />
    </div>
  )
}
