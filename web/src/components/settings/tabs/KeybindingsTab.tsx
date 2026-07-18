import { useState, useEffect, useCallback, useRef } from 'react'
import { XCloseSmallIcon, ReloadIcon } from '../../shared/icons'
import { SETTINGS_KEYS } from '../../../stores/settings'
import { useSettingsStoreState } from '../useSettingsStore'
import {
  parseKeybindings,
  formatKeybinding,
  getKeyFromEvent,
  DEFAULT_KEYBINDINGS,
  type KeyBinding,
} from '../../../lib/keybindings'

function isDefaultBinding(binding: KeyBinding | null, defaultBinding: KeyBinding | null): boolean {
  if (binding === null && defaultBinding === null) return true
  if (binding === null || defaultBinding === null) return false
  return JSON.stringify(binding) === JSON.stringify(defaultBinding)
}

function KeybindingRow({
  label,
  binding,
  defaultBinding,
  isRecording,
  onStartRecording,
  onBindingRecorded,
  onClear,
  onReset,
  onCancelRecording,
}: {
  label: string
  binding: KeyBinding | null
  defaultBinding: KeyBinding | null
  isRecording: boolean
  onStartRecording: () => void
  onBindingRecorded: (binding: KeyBinding) => void
  onClear: () => void
  onReset: () => void
  onCancelRecording: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lastPressRef = useRef<number>(0)
  const lastKeyRef = useRef<string>('')

  useEffect(() => {
    if (!isRecording) return

    const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
    let pendingModifiers: Array<'ctrl' | 'meta' | 'alt' | 'shift'> = []

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        onCancelRecording()
        return
      }

      if (MODIFIERS.has(e.key)) {
        const now = Date.now()
        if (e.key === lastKeyRef.current && now - lastPressRef.current < 400) {
          onBindingRecorded({ type: 'double-press', key: e.key, threshold: 300 })
          return
        }
        lastPressRef.current = now
        lastKeyRef.current = e.key

        if (e.ctrlKey && !pendingModifiers.includes('ctrl')) pendingModifiers.push('ctrl')
        if (e.metaKey && !pendingModifiers.includes('meta')) pendingModifiers.push('meta')
        if (e.altKey && !pendingModifiers.includes('alt')) pendingModifiers.push('alt')
        if (e.shiftKey && !pendingModifiers.includes('shift')) pendingModifiers.push('shift')
        return
      }

      if (pendingModifiers.length > 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
        const modifiers: Array<'ctrl' | 'meta' | 'alt' | 'shift'> = [...pendingModifiers]
        if (e.ctrlKey && !modifiers.includes('ctrl')) modifiers.push('ctrl')
        if (e.metaKey && !modifiers.includes('meta')) modifiers.push('meta')
        if (e.altKey && !modifiers.includes('alt')) modifiers.push('alt')
        if (e.shiftKey && !modifiers.includes('shift')) modifiers.push('shift')

        onBindingRecorded({ type: 'chord', key: getKeyFromEvent(e), modifiers })
        return
      }

      const now = Date.now()
      const recordedKey = getKeyFromEvent(e)
      if (recordedKey === lastKeyRef.current && now - lastPressRef.current < 400) {
        onBindingRecorded({ type: 'double-press', key: recordedKey, threshold: 300 })
        return
      }

      lastPressRef.current = now
      lastKeyRef.current = recordedKey
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') pendingModifiers = pendingModifiers.filter((m) => m !== 'ctrl')
      if (e.key === 'Shift') pendingModifiers = pendingModifiers.filter((m) => m !== 'shift')
      if (e.key === 'Alt') pendingModifiers = pendingModifiers.filter((m) => m !== 'alt')
      if (e.key === 'Meta') pendingModifiers = pendingModifiers.filter((m) => m !== 'meta')
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [isRecording, onBindingRecorded, onCancelRecording])

  return (
    <div
      ref={ref}
      className={`flex items-center justify-between px-3 py-2 rounded transition-colors ${
        isRecording ? 'bg-accent-primary/10 ring-1 ring-accent-primary' : 'hover:bg-bg-tertiary'
      }`}
    >
      <span className="text-sm text-text-primary">{label}</span>
      <div className="flex items-center gap-2">
        {isRecording ? (
          <span className="text-xs text-accent-primary font-medium animate-pulse">Press shortcut...</span>
        ) : (
          <>
            <button
              type="button"
              onClick={onStartRecording}
              className="px-2 py-0.5 text-xs font-mono bg-bg-tertiary text-text-secondary rounded border border-border hover:border-accent-primary hover:text-accent-primary transition-colors"
            >
              {binding ? formatKeybinding(binding) : 'None'}
            </button>
            {binding && (
              <button
                type="button"
                onClick={onClear}
                title="Remove shortcut"
                aria-label={`Remove shortcut for ${label}`}
                className="p-1 text-text-muted rounded hover:text-accent-error hover:bg-bg-tertiary transition-colors"
              >
                <XCloseSmallIcon className="w-3.5 h-3.5" />
              </button>
            )}
            {!isDefaultBinding(binding, defaultBinding) && (
              <button
                type="button"
                onClick={onReset}
                title="Reset to default"
                aria-label={`Reset ${label} to default`}
                className="p-1 text-text-muted rounded hover:text-accent-primary hover:bg-bg-tertiary transition-colors"
              >
                <ReloadIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function KeybindingsTab() {
  const { settings, loading, setSetting } = useSettingsStoreState()
  const raw = settings[SETTINGS_KEYS.KEYBINDINGS]
  const isLoading = loading[SETTINGS_KEYS.KEYBINDINGS] ?? false
  const config = parseKeybindings(raw)
  const [recording, setRecording] = useState<string | null>(null)

  const actions: Array<{ id: string; label: string; binding: KeyBinding | null; defaultBinding: KeyBinding | null }> = [
    {
      id: 'terminalToggle',
      label: 'Toggle Terminal',
      binding: config.terminalToggle,
      defaultBinding: DEFAULT_KEYBINDINGS.terminalToggle,
    },
    {
      id: 'quickAction',
      label: 'Quick Action',
      binding: config.quickAction,
      defaultBinding: DEFAULT_KEYBINDINGS.quickAction,
    },
    ...config.agentSwitching.map((b, i) => ({
      id: `agentSwitching.${i}`,
      label: `Switch to Agent ${i + 1}`,
      binding: b,
      defaultBinding: DEFAULT_KEYBINDINGS.agentSwitching[i] ?? null,
    })),
  ]

  const handleStartRecording = (id: string) => {
    setRecording(id)
  }

  const updateBinding = useCallback(
    (id: string, value: KeyBinding | null) => {
      const updated = parseKeybindings(raw)

      if (id.startsWith('agentSwitching.')) {
        const index = parseInt(id.split('.')[1]!, 10)
        updated.agentSwitching[index] = value
      } else if (id === 'terminalToggle') {
        updated.terminalToggle = value
      } else if (id === 'quickAction') {
        updated.quickAction = value
      }

      setSetting(SETTINGS_KEYS.KEYBINDINGS, JSON.stringify(updated))
    },
    [raw, setSetting],
  )

  const handleBindingRecorded = useCallback(
    (newBinding: KeyBinding) => {
      if (!recording) return
      setRecording(null)
      updateBinding(recording, newBinding)
    },
    [recording, updateBinding],
  )

  const handleReset = () => {
    setSetting(SETTINGS_KEYS.KEYBINDINGS, JSON.stringify(DEFAULT_KEYBINDINGS))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text-primary">Keyboard Shortcuts</h3>
        <button
          type="button"
          onClick={handleReset}
          disabled={isLoading}
          className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-bg-tertiary transition-colors disabled:opacity-30"
        >
          Reset to defaults
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-text-muted">Loading...</div>
      ) : (
        <div className="space-y-1">
          {actions.map((action) => (
            <KeybindingRow
              key={action.id}
              label={action.label}
              binding={action.binding}
              defaultBinding={action.defaultBinding}
              isRecording={recording === action.id}
              onStartRecording={() => handleStartRecording(action.id)}
              onBindingRecorded={handleBindingRecorded}
              onClear={() => updateBinding(action.id, null)}
              onReset={() => updateBinding(action.id, action.defaultBinding)}
              onCancelRecording={() => setRecording(null)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
