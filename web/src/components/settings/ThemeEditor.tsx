import { useState, useEffect } from 'react'
import { useThemeStore, THEME_PRESETS, THEME_TOKENS, ThemeToken, UserThemePreset } from '../../stores/theme'
import type { ThemePreset } from '../../stores/theme'
import { XCloseIcon } from '../shared/icons'
import { Modal } from '../shared/Modal'

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
  const parts = rgb.split(' ').map((p) => parseInt(p, 10))
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return `#${parts.map((p) => (p ?? 0).toString(16).padStart(2, '0')).join('')}`
  }
  return rgb
}

interface ThemeEditorModalProps {
  isOpen: boolean
  isNew: boolean
  presetIndex: number
  basePresetId: string
  presetName: string
  mode: 'dark' | 'light'
  initialTokens: Record<string, string>
  onClose: () => void
  onSave: (name: string, tokens: Record<string, string>, mode: 'dark' | 'light') => void
}

function ThemeEditorModal({
  isOpen,
  isNew,
  basePresetId,
  presetName: defaultName,
  mode: initialMode,
  initialTokens,
  onClose,
  onSave,
}: ThemeEditorModalProps) {
  const [localTokens, setLocalTokens] = useState(initialTokens)
  const [name, setName] = useState(defaultName)
  const [mode, setMode] = useState<'dark' | 'light'>(initialMode)

  useEffect(() => {
    setLocalTokens(initialTokens)
    setName(defaultName)
  }, [initialTokens, defaultName])

  const handleTokenChange = (key: string, value: string) => {
    const rgbValue = value.startsWith('#') ? hexToRgb(value) : value
    setLocalTokens((prev) => ({ ...prev, [key]: rgbValue }))
  }

  const handleSave = () => {
    onSave(name.trim() || 'Untitled', { ...localTokens }, mode)
  }

  const groupedTokens = THEME_TOKENS.reduce(
    (acc, token) => {
      const cat = token.category
      if (!acc[cat]) acc[cat] = []
      acc[cat]!.push(token)
      return acc
    },
    {} as Record<string, ThemeToken[]>,
  )

  const categoryLabels: Record<string, string> = {
    background: 'Backgrounds',
    surface: 'Surfaces',
    text: 'Text',
    accent: 'Accents',
    border: 'Border',
  }

  const basePreset = THEME_PRESETS.find((p) => p.id === basePresetId)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={isNew ? 'New Theme' : 'Edit Theme'}
      closeOnBackdropClick={true}
      closeOnEscape={true}
      footer={
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border rounded text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-accent-primary text-white rounded hover:bg-accent-primary/80 transition-colors text-sm"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-xs text-text-muted block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">Mode</label>
            <div className="flex rounded overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => setMode('dark')}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  mode === 'dark'
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
              >
                Dark
              </button>
              <button
                type="button"
                onClick={() => setMode('light')}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  mode === 'light'
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
              >
                Light
              </button>
            </div>
          </div>
        </div>
        {!isNew && (
          <div className="text-xs text-text-muted">
            Based on <span className="text-text-primary">{basePreset?.name}</span>
          </div>
        )}

        {Object.entries(groupedTokens).map(([category, tokens]) => (
          <div key={category} className="space-y-3">
            <h4 className="text-xs font-medium text-text-muted uppercase">{categoryLabels[category] ?? category}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tokens.map((token) => (
                <div key={token.key} className="flex flex-col gap-1">
                  <label htmlFor={token.key} className="text-xs text-text-muted">
                    {token.label}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      id={token.key}
                      value={rgbToHex(localTokens[token.key] ?? token.defaultValue)}
                      onChange={(e) => handleTokenChange(token.key, e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent flex-shrink-0"
                    />
                    <input
                      type="text"
                      value={localTokens[token.key] ?? token.defaultValue}
                      onChange={(e) => handleTokenChange(token.key, e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

interface ThemeEditorState {
  type: 'new' | 'edit'
  presetIndex: number
  basePresetId: string
  presetName: string
  mode: 'dark' | 'light'
  tokens: Record<string, string>
}

function PresetButton({
  preset,
  isActive,
  isUnderlying,
  onClick,
  onNewFrom,
  onEdit,
  onDelete,
}: {
  preset: ThemePreset
  isActive: boolean
  isUnderlying?: boolean
  onClick: () => void
  onNewFrom?: () => void
  onEdit?: () => void
  onDelete?: (e: React.MouseEvent) => void
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`flex flex-col items-center gap-2 px-3 py-3 rounded-lg border transition-colors min-w-[80px] ${
          isActive
            ? 'border-accent-primary bg-bg-tertiary text-text-primary'
            : isUnderlying
              ? 'border-dashed border-accent-primary/50 bg-bg-tertiary/50 text-text-primary'
              : 'border-border bg-bg-secondary text-text-muted hover:border-text-muted'
        }`}
      >
        <div
          className="w-8 h-8 rounded border flex items-center justify-center"
          style={{
            backgroundColor:
              preset.id === 'system' ? 'transparent' : rgbToHex(preset.tokens['color-bg-primary'] ?? '#000'),
            borderColor: rgbToHex(preset.tokens['color-border'] ?? '#000'),
          }}
        >
          {preset.id === 'system' ? (
            <div
              className="w-4 h-4 rounded-full"
              style={{
                background: 'linear-gradient(135deg, #000 50%, #fff 50%)',
              }}
            />
          ) : (
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: rgbToHex(preset.tokens['color-text-primary'] ?? '#fff') }}
            />
          )}
        </div>
        <span className="text-xs">{preset.name}</span>
      </button>
      {onNewFrom && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNewFrom()
          }}
          className="absolute top-1 right-1 w-6 h-6 rounded bg-bg-tertiary border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:border-text-muted"
          title="Create custom theme based on this"
        >
          <span className="text-xs">✎</span>
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="absolute top-1 right-1 w-6 h-6 rounded bg-bg-tertiary border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:border-text-muted"
          title="Edit"
        >
          <span className="text-xs">✎</span>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => onDelete(e)}
          className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-accent-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
        >
          <XCloseIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

export function ThemeEditor() {
  const [editorState, setEditorState] = useState<ThemeEditorState | null>(null)

  const currentPreset = useThemeStore((state) => state.currentPreset)
  const isCustom = useThemeStore((state) => state.isCustom)
  const basePreset = useThemeStore((state) => state.basePreset)
  const isSystem = useThemeStore((state) => state.isSystem)
  const systemDarkPreset = useThemeStore((state) => state.systemDarkPreset)
  const systemLightPreset = useThemeStore((state) => state.systemLightPreset)
  const applyPreset = useThemeStore((state) => state.applyPreset)
  const applyUserPreset = useThemeStore((state) => state.applyUserPreset)
  const deleteUserPreset = useThemeStore((state) => state.deleteUserPreset)
  const saveTheme = useThemeStore((state) => state.saveTheme)
  const setSystemDarkPreset = useThemeStore((state) => state.setSystemDarkPreset)
  const setSystemLightPreset = useThemeStore((state) => state.setSystemLightPreset)
  const activeUserPresetId = useThemeStore((state) => state.activeUserPresetId)
  const userPresets = useThemeStore((state) => state.userPresets)

  const darkPresets = THEME_PRESETS.filter((p) => p.mode === 'dark')
  const lightPresets = THEME_PRESETS.filter((p) => p.mode === 'light')

  const handleUserPresetSelect = (index: number) => {
    if (isSystem) {
      // In system mode, set the system preference instead of applying directly
      const preset = userPresets[index]
      if (!preset) return
      const effectiveMode = preset.mode ?? THEME_PRESETS.find((bp) => bp.id === preset.basePreset)?.mode
      if (effectiveMode === 'dark') {
        setSystemDarkPreset(preset.id)
      } else if (effectiveMode === 'light') {
        setSystemLightPreset(preset.id)
      }
    } else {
      applyUserPreset(index)
    }
  }

  const handleNewFromPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setEditorState({
      type: 'new',
      presetIndex: userPresets.length,
      basePresetId: presetId,
      presetName: preset.name + ' Copy',
      mode: preset.mode ?? 'dark',
      tokens: { ...preset.tokens },
    })
  }

  const handleEditPreset = (index: number) => {
    const preset = userPresets[index]
    if (!preset) return
    const base = THEME_PRESETS.find((p) => p.id === preset.basePreset)
    const tokens = base ? { ...base.tokens, ...preset.tokens } : preset.tokens
    setEditorState({
      type: 'edit',
      presetIndex: index,
      basePresetId: preset.basePreset,
      presetName: preset.name,
      mode: preset.mode ?? 'dark',
      tokens,
    })
  }

  const handleSavePreset = (name: string, tokens: Record<string, string>, mode: 'dark' | 'light') => {
    if (!editorState) return
    const updated = [...userPresets]
    if (editorState.type === 'new') {
      const preset: UserThemePreset = {
        id: 'custom-' + Date.now(),
        name,
        basePreset: editorState.basePresetId,
        mode,
        tokens,
      }
      updated.push(preset)
      const index = updated.length - 1
      useThemeStore.setState({ userPresets: updated })
      useThemeStore.getState().saveUserPresets()
      useThemeStore.getState().applyUserPreset(index)
    } else {
      const existing = updated[editorState.presetIndex]
      if (existing) {
        updated[editorState.presetIndex] = {
          ...existing,
          name,
          mode,
          tokens,
        }
      }
      useThemeStore.setState({ userPresets: updated })
      useThemeStore.getState().saveUserPresets()
      useThemeStore.getState().applyUserPreset(editorState.presetIndex)
    }
    setEditorState(null)
  }

  const handleCancel = () => {
    setEditorState(null)
  }

  const handleDeleteUserPreset = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    deleteUserPreset(index)
  }

  const activePresetId = isSystem ? 'system' : isCustom ? basePreset : currentPreset

  const handleSystemToggle = () => {
    if (isSystem) {
      // Exit system mode — apply the currently active theme directly
      applyPreset(currentPreset)
      saveTheme(JSON.stringify({ preset: currentPreset })).catch(() => {})
    } else {
      // Enter system mode
      applyPreset('system')
      saveTheme(JSON.stringify({ preset: 'system' })).catch(() => {})
    }
  }

  const handlePresetClick = (presetId: string) => {
    if (isSystem) {
      const preset = THEME_PRESETS.find((p) => p.id === presetId)
      if (preset?.mode === 'dark') {
        setSystemDarkPreset(presetId)
      } else if (preset?.mode === 'light') {
        setSystemLightPreset(presetId)
      }
    } else {
      applyPreset(presetId)
      saveTheme(JSON.stringify({ preset: presetId })).catch(() => {})
    }
  }

  const getUserPresetTokens = (preset: UserThemePreset): Record<string, string> => {
    const base = THEME_PRESETS.find((p) => p.id === preset.basePreset)
    return base ? { ...base.tokens, ...preset.tokens } : preset.tokens
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-text-primary">Theme</h3>

      {/* System theme toggle */}
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="text-sm text-text-primary font-medium">Follow system theme</span>
        <button
          type="button"
          onClick={handleSystemToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            isSystem ? 'bg-accent-primary' : 'bg-bg-tertiary'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isSystem ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </label>

      {[
        { title: 'Dark Themes', mode: 'dark' as const },
        { title: 'Light Themes', mode: 'light' as const },
      ].map(({ title, mode }) => {
        const builtins = mode === 'dark' ? darkPresets : lightPresets
        const users = userPresets.filter((p) => {
          const effectiveMode = p.mode ?? THEME_PRESETS.find((bp) => bp.id === p.basePreset)?.mode
          return effectiveMode === mode
        })
        return (
          <div key={title}>
            <h4 className="text-xs font-medium text-text-muted uppercase mb-2">{title}</h4>
            <div className="flex flex-wrap gap-2">
              {builtins.map((preset) => (
                <PresetButton
                  key={preset.id}
                  preset={preset}
                  isActive={preset.id === activePresetId && !isCustom}
                  isUnderlying={isSystem && (preset.id === systemDarkPreset || preset.id === systemLightPreset)}
                  onClick={() => handlePresetClick(preset.id)}
                  onNewFrom={() => handleNewFromPreset(preset.id)}
                />
              ))}
              {users.map((preset) => {
                const userIndex = userPresets.indexOf(preset)
                const tokens = getUserPresetTokens(preset)
                return (
                  <PresetButton
                    key={preset.id}
                    preset={{ id: preset.id, name: preset.name, tokens }}
                    isActive={activeUserPresetId === preset.id}
                    isUnderlying={isSystem && (preset.id === systemDarkPreset || preset.id === systemLightPreset)}
                    onClick={() => handleUserPresetSelect(userIndex)}
                    onEdit={() => handleEditPreset(userIndex)}
                    onDelete={(e) => handleDeleteUserPreset(e, userIndex)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {editorState && (
        <ThemeEditorModal
          isOpen={true}
          isNew={editorState.type === 'new'}
          presetIndex={editorState.presetIndex}
          basePresetId={editorState.basePresetId}
          presetName={editorState.presetName}
          mode={editorState.mode}
          initialTokens={editorState.tokens}
          onClose={handleCancel}
          onSave={handleSavePreset}
        />
      )}
    </div>
  )
}
