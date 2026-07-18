import { useEffect, useRef } from 'react'
import { useSettingsStore, SETTINGS_KEYS } from '../stores/settings'
import {
  parseKeybindings,
  type KeybindingsConfig,
  type KeyBinding,
  type DoublePressBinding,
  type ChordBinding,
} from '../lib/keybindings'

function isDoublePress(binding: KeyBinding): binding is DoublePressBinding {
  return binding.type === 'double-press'
}

function isChord(binding: KeyBinding): binding is ChordBinding {
  return binding.type === 'chord'
}

function keyEventMatches(e: KeyboardEvent, key: string): boolean {
  if (key.length === 1 && /^[a-z]$/i.test(key)) {
    return e.code === `Key${key.toUpperCase()}`
  }
  if (key.length === 1 && /^[0-9]$/.test(key)) {
    return e.code === `Digit${key}`
  }
  return e.key.toLowerCase() === key.toLowerCase()
}

function matchChord(e: KeyboardEvent, binding: ChordBinding): boolean {
  const hasCtrl = binding.modifiers.includes('ctrl')
  const hasMeta = binding.modifiers.includes('meta')
  const hasAlt = binding.modifiers.includes('alt')
  const hasShift = binding.modifiers.includes('shift')

  return (
    keyEventMatches(e, binding.key) &&
    e.ctrlKey === hasCtrl &&
    e.metaKey === hasMeta &&
    e.altKey === hasAlt &&
    e.shiftKey === hasShift
  )
}

export function useKeybindings(): KeybindingsConfig {
  const raw = useSettingsStore((s) => s.settings[SETTINGS_KEYS.KEYBINDINGS])
  return parseKeybindings(raw)
}

export function useDoublePressBinding(
  binding: DoublePressBinding | undefined,
  onActivate: () => void,
  options?: { capture?: boolean },
) {
  const lastPressRef = useRef<number>(0)
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    if (!binding) return

    const threshold = binding.threshold ?? 300

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== binding.key) return

      const skipCtrl = binding.key === 'Control'
      const skipShift = binding.key === 'Shift'
      const skipAlt = binding.key === 'Alt'
      const skipMeta = binding.key === 'Meta'

      if (!skipCtrl && e.ctrlKey) return
      if (!skipShift && e.shiftKey) return
      if (!skipAlt && e.altKey) return
      if (!skipMeta && e.metaKey) return

      const now = Date.now()
      if (now - lastPressRef.current < threshold) {
        e.preventDefault()
        e.stopPropagation()
        onActivateRef.current()
        lastPressRef.current = 0
      } else {
        lastPressRef.current = now
      }
    }

    window.addEventListener('keydown', handleKeyDown, options?.capture ? true : undefined)
    return () => window.removeEventListener('keydown', handleKeyDown, options?.capture ? true : undefined)
  }, [binding, options?.capture])
}

export function useChordBinding(binding: ChordBinding | undefined, onActivate: () => void) {
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    if (!binding) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchChord(e, binding)) {
        e.preventDefault()
        onActivateRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [binding])
}

export function useBinding(
  binding: KeyBinding | null | undefined,
  onActivate: () => void,
  options?: { capture?: boolean },
) {
  useDoublePressBinding(binding && isDoublePress(binding) ? binding : undefined, onActivate, options)
  useChordBinding(binding && isChord(binding) ? binding : undefined, onActivate)
}

export function useAgentSwitchingBindings(
  bindings: (KeyBinding | null)[],
  agents: Array<{ id: string }>,
  onSwitch: (agentId: string) => void,
) {
  const onSwitchRef = useRef(onSwitch)
  onSwitchRef.current = onSwitch

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i]
        if (!binding) continue
        const agent = agents[i]
        if (!agent) continue

        if (isChord(binding) && matchChord(e, binding)) {
          e.preventDefault()
          onSwitchRef.current(agent.id)
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bindings, agents])
}
