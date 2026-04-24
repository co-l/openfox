import { useState } from 'react'
import { useThemeStore, THEME_PRESETS, THEME_TOKENS, ThemeToken } from '../../stores/theme'

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (result) {
    const r = parseInt(result[1] ?? '0', 16)
    const g = parseInt(result[2] ?? '0', 16)
    const b = parseInt(result[3] ?? '0', 16)
    return `${r} ${g} ${b}`
  }
  return hex
}

function rgbToHex(rgb: string): string {
  const parts = rgb.split(' ').map(p => parseInt(p, 10))
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    return `#${parts.map(p => (p ?? 0).toString(16).padStart(2, '0')).join('')}`
  }
  return rgb
}

export { rgbToHex }

export function ThemeEditor() {
  const [showCustom, setShowCustom] = useState(false)
  const [localTokens, setLocalTokens] = useState<Record<string, string>>({})

  const currentPreset = useThemeStore(state => state.currentPreset)
  const isCustom = useThemeStore(state => state.isCustom)
  const applyPreset = useThemeStore(state => state.applyPreset)
  const applyTokens = useThemeStore(state => state.applyTokens)
  const saveTheme = useThemeStore(state => state.saveTheme)
  const getActiveTheme = useThemeStore(state => state.getActiveTheme)

  const handlePresetSelect = (presetId: string) => {
    applyPreset(presetId)
    saveTheme(JSON.stringify({ preset: presetId }))
  }

  const handleCustomizeClick = () => {
    if (!showCustom) {
      setLocalTokens(getActiveTheme())
    }
    setShowCustom(!showCustom)
  }

  const handleTokenChange = (key: string, value: string) => {
    const rgbValue = value.startsWith('#') ? hexToRgb(value) : value
    const updated = { ...localTokens, [key]: rgbValue }
    setLocalTokens(updated)
    applyTokens(updated)
  }

  const handleSaveCustom = () => {
    applyTokens(localTokens)
    saveTheme(JSON.stringify({ tokens: localTokens }))
    setShowCustom(false)
  }

  const handleResetToPreset = () => {
    setShowCustom(false)
    setLocalTokens({})
    if (currentPreset) {
      applyPreset(currentPreset)
    }
  }

  const groupedTokens = THEME_TOKENS.reduce((acc, token) => {
    const cat = token.category
    if (!acc[cat]) acc[cat] = []
    acc[cat]!.push(token)
    return acc
  }, {} as Record<string, ThemeToken[]>)

  const categoryLabels: Record<string, string> = {
    background: 'Backgrounds',
    surface: 'Surfaces',
    text: 'Text',
    accent: 'Accents',
    border: 'Border',
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-text-primary">Theme</h3>

      <div className="grid grid-cols-5 gap-2">
        {THEME_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handlePresetSelect(preset.id)}
            className={`flex flex-col items-center gap-2 px-3 py-3 rounded-lg border transition-colors ${
              currentPreset === preset.id && !isCustom
                ? 'border-accent-primary bg-bg-tertiary text-text-primary'
                : 'border-border bg-bg-secondary text-text-muted hover:border-text-muted'
            }`}
          >
            <div
              className="w-8 h-8 rounded border flex items-center justify-center"
              style={{
                backgroundColor: rgbToHex(preset.tokens['color-bg-primary'] ?? '#000'),
                borderColor: rgbToHex(preset.tokens['color-border'] ?? '#000'),
              }}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: rgbToHex(preset.tokens['color-text-primary'] ?? '#fff') }}
              />
            </div>
            <span className="text-xs">{preset.name}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={handleCustomizeClick}
        className="flex items-center gap-2 text-sm text-accent-primary hover:underline"
      >
        {showCustom ? 'Hide' : 'Customize'}
      </button>

      {showCustom && (
        <div className="space-y-4 p-4 bg-bg-secondary rounded-lg border border-border">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-text-primary">Custom Theme</span>
            {isCustom && currentPreset && (
              <button
                type="button"
                onClick={handleResetToPreset}
                className="text-xs text-accent-primary hover:underline"
              >
                Reset to {THEME_PRESETS.find(p => p.id === currentPreset)?.name}
              </button>
            )}
          </div>

          {Object.entries(groupedTokens).map(([category, tokens]) => (
            <div key={category} className="space-y-3">
              <h4 className="text-xs font-medium text-text-muted uppercase">
                {categoryLabels[category] ?? category}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {tokens.map(token => (
                  <div key={token.key} className="flex flex-col gap-1">
                    <label
                      htmlFor={token.key}
                      className="text-xs text-text-muted"
                    >
                      {token.label}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id={token.key}
                        value={rgbToHex(localTokens[token.key] ?? token.defaultValue)}
                        onChange={(e) => handleTokenChange(token.key, e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent"
                      />
                      <input
                        type="text"
                        value={localTokens[token.key] ?? token.defaultValue}
                        onChange={(e) => handleTokenChange(token.key, e.target.value)}
                        className="flex-1 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleSaveCustom}
            className="px-4 py-2 bg-accent-primary text-white rounded hover:bg-accent-primary/80 transition-colors text-sm"
          >
            Save Custom Theme
          </button>
        </div>
      )}
    </div>
  )
}