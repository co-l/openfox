export type DoublePressBinding = {
  type: 'double-press'
  key: string
  threshold?: number
}

export type ChordBinding = {
  type: 'chord'
  key: string
  modifiers: ('ctrl' | 'meta' | 'alt' | 'shift')[]
}

export type KeyBinding = DoublePressBinding | ChordBinding

// null = shortcut explicitly disabled by the user
export interface KeybindingsConfig {
  terminalToggle: KeyBinding | null
  quickAction: KeyBinding | null
  agentSwitching: (KeyBinding | null)[]
}

export const KEYBINDINGS_SETTING_KEY = 'keybindings'

export const DEFAULT_KEYBINDINGS: KeybindingsConfig = {
  terminalToggle: { type: 'double-press', key: 'Control', threshold: 300 },
  quickAction: { type: 'double-press', key: 'Shift', threshold: 300 },
  agentSwitching: [
    { type: 'chord', key: '1', modifiers: ['ctrl'] },
    { type: 'chord', key: '2', modifiers: ['ctrl'] },
    { type: 'chord', key: '3', modifiers: ['ctrl'] },
    { type: 'chord', key: '4', modifiers: ['ctrl'] },
  ],
}

export function parseKeybindings(json: string | undefined | null): KeybindingsConfig {
  if (!json) return structuredClone(DEFAULT_KEYBINDINGS)
  try {
    const parsed = JSON.parse(json) as Partial<KeybindingsConfig>
    // explicit null = disabled shortcut, only undefined falls back to defaults
    const orDefault = <K extends keyof KeybindingsConfig>(key: K): KeybindingsConfig[K] =>
      parsed[key] === undefined ? structuredClone(DEFAULT_KEYBINDINGS[key]) : parsed[key]
    return {
      terminalToggle: orDefault('terminalToggle'),
      quickAction: orDefault('quickAction'),
      agentSwitching: orDefault('agentSwitching'),
    }
  } catch {
    return structuredClone(DEFAULT_KEYBINDINGS)
  }
}

export function getKeyFromEvent(e: KeyboardEvent): string {
  if (e.code.startsWith('Digit')) return e.code.slice(-1)
  if (e.code.startsWith('Key')) return e.code.slice(3).toLowerCase()
  return e.key
}

export function formatKeybinding(binding: KeyBinding): string {
  if (binding.type === 'double-press') {
    const keyName =
      binding.key === 'Control'
        ? 'Ctrl'
        : binding.key === 'Shift'
          ? 'Shift'
          : binding.key === 'Alt'
            ? 'Alt'
            : binding.key === 'Meta'
              ? 'Meta'
              : binding.key
    return `Double ${keyName}`
  }
  const mods = binding.modifiers.map((m) => {
    switch (m) {
      case 'ctrl':
        return 'Ctrl'
      case 'meta':
        return '⌘'
      case 'alt':
        return 'Alt'
      case 'shift':
        return 'Shift'
    }
  })
  const keyLabel = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key
  return [...mods, keyLabel].join('+')
}
