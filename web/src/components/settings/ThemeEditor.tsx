import { useState, useEffect } from 'react'
import { useThemeStore, THEME_PRESETS, THEME_TOKENS, ThemeToken, UserThemePreset } from '../../stores/theme'
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
  initialTokens: Record<string, string>
  onClose: () => void
  onSave: (name: string, tokens: Record<string, string>) => void
}

function ThemeEditorModal({
  isOpen,
  isNew,
  basePresetId,
  presetName: defaultName,
  initialTokens,
  onClose,
  onSave,
}: ThemeEditorModalProps) {
  const [localTokens, setLocalTokens] = useState(initialTokens)
  const [name, setName] = useState(defaultName)

  useEffect(() => {
    setLocalTokens(initialTokens)
    setName(defaultName)
  }, [initialTokens, defaultName])

  const handleTokenChange = (key: string, value: string) => {
    const rgbValue = value.startsWith('#') ? hexToRgb(value) : value
    setLocalTokens((prev) => ({ ...prev, [key]: rgbValue }))
  }

  const handleSave = () => {
    onSave(name.trim() || 'Untitled', { ...localTokens })
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
        <div>
          <label className="text-xs text-text-muted block mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>
        {!isNew && (
          <div className="text-xs text-text-muted">
            Based on <span className="text-text-primary">{basePreset?.name}</span>
          </div>
        )}

        {Object.entries(groupedTokens).map(([category, tokens]) => (
          <div key={category} className="space-y-3">
            <h4 className="text-xs font-medium text-text-muted uppercase">{categoryLabels[category] ?? category}</h4>
            <div className="grid grid-cols-2 gap-3">
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
      </div>
    </Modal>
  )
}

interface ThemeEditorState {
  type: 'new' | 'edit'
  presetIndex: number
  basePresetId: string
  presetName: string
  tokens: Record<string, string>
}

export function ThemeEditor() {
  const [editorState, setEditorState] = useState<ThemeEditorState | null>(null)

  const currentPreset = useThemeStore((state) => state.currentPreset)
  const isCustom = useThemeStore((state) => state.isCustom)
  const basePreset = useThemeStore((state) => state.basePreset)
  const userPresets = useThemeStore((state) => state.userPresets)
  const applyPreset = useThemeStore((state) => state.applyPreset)
  const applyUserPreset = useThemeStore((state) => state.applyUserPreset)
  const deleteUserPreset = useThemeStore((state) => state.deleteUserPreset)
  const saveTheme = useThemeStore((state) => state.saveTheme)

  const handlePresetSelect = (presetId: string) => {
    applyPreset(presetId)
    saveTheme(JSON.stringify({ preset: presetId })).catch(() => {})
  }

  const handleUserPresetSelect = (index: number) => {
    applyUserPreset(index)
  }

  const handleNewFromPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setEditorState({
      type: 'new',
      presetIndex: userPresets.length,
      basePresetId: presetId,
      presetName: preset.name + ' Copy',
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
      tokens,
    })
  }

  const handleSavePreset = (name: string, tokens: Record<string, string>) => {
    if (!editorState) return
    const updated = [...userPresets]
    if (editorState.type === 'new') {
      const preset: UserThemePreset = {
        id: 'custom-' + Date.now(),
        name,
        basePreset: editorState.basePresetId,
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

  const activePresetId = isCustom ? basePreset : currentPreset

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-text-primary">Theme</h3>

      <div className="grid grid-cols-5 gap-2">
        {THEME_PRESETS.map((preset) => (
          <div key={preset.id} className="relative group">
            <button
              type="button"
              onClick={() => handlePresetSelect(preset.id)}
              className={`w-full flex flex-col items-center gap-2 px-3 py-3 rounded-lg border transition-colors ${
                activePresetId === preset.id && !isCustom
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
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleNewFromPreset(preset.id)
              }}
              className="absolute top-1 right-1 w-6 h-6 rounded bg-bg-tertiary border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:border-text-muted"
              title="Create custom theme based on this"
            >
              <span className="text-xs">✎</span>
            </button>
          </div>
        ))}
      </div>

      {userPresets.length > 0 && (
        <>
          <h4 className="text-xs font-medium text-text-muted uppercase">My Themes</h4>
          <div className="grid grid-cols-5 gap-2">
            {userPresets.map((preset, index) => {
              const base = THEME_PRESETS.find((p) => p.id === preset.basePreset)
              const tokens = base ? { ...base.tokens, ...preset.tokens } : preset.tokens
              return (
                <div key={preset.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => handleUserPresetSelect(index)}
                    className={`w-full flex flex-col items-center gap-2 px-3 py-3 rounded-lg border transition-colors ${
                      isCustom && basePreset === preset.basePreset && activePresetId === preset.basePreset
                        ? 'border-accent-primary bg-bg-tertiary text-text-primary'
                        : 'border-border bg-bg-secondary text-text-muted hover:border-text-muted'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded border flex items-center justify-center"
                      style={{
                        backgroundColor: rgbToHex(tokens['color-bg-primary'] ?? '#000'),
                        borderColor: rgbToHex(tokens['color-border'] ?? '#000'),
                      }}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: rgbToHex(tokens['color-text-primary'] ?? '#fff') }}
                      />
                    </div>
                    <span className="text-xs truncate w-full text-center">{preset.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditPreset(index)
                    }}
                    className="absolute top-1 right-1 w-6 h-6 rounded bg-bg-tertiary border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:border-text-muted"
                    title="Edit"
                  >
                    <span className="text-xs">✎</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteUserPreset(e, index)}
                    className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-accent-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20"
                  >
                    <XCloseIcon className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {editorState && (
        <ThemeEditorModal
          isOpen={true}
          isNew={editorState.type === 'new'}
          presetIndex={editorState.presetIndex}
          basePresetId={editorState.basePresetId}
          presetName={editorState.presetName}
          initialTokens={editorState.tokens}
          onClose={handleCancel}
          onSave={handleSavePreset}
        />
      )}
    </div>
  )
}
