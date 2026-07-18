import { describe, it, expect } from 'vitest'
import { parseKeybindings, DEFAULT_KEYBINDINGS } from './keybindings'

describe('parseKeybindings', () => {
  it('returns defaults for empty or invalid input', () => {
    expect(parseKeybindings(undefined)).toEqual(DEFAULT_KEYBINDINGS)
    expect(parseKeybindings('not json')).toEqual(DEFAULT_KEYBINDINGS)
  })

  it('falls back to defaults for missing keys', () => {
    const config = parseKeybindings('{}')
    expect(config.terminalToggle).toEqual(DEFAULT_KEYBINDINGS.terminalToggle)
    expect(config.quickAction).toEqual(DEFAULT_KEYBINDINGS.quickAction)
  })

  it('preserves explicit null (disabled shortcut) instead of restoring defaults', () => {
    const config = parseKeybindings(JSON.stringify({ terminalToggle: null, quickAction: null }))
    expect(config.terminalToggle).toBeNull()
    expect(config.quickAction).toBeNull()
    expect(config.agentSwitching).toEqual(DEFAULT_KEYBINDINGS.agentSwitching)
  })

  it('preserves null entries in agentSwitching', () => {
    const config = parseKeybindings(
      JSON.stringify({ agentSwitching: [null, { type: 'chord', key: '2', modifiers: ['ctrl'] }] }),
    )
    expect(config.agentSwitching[0]).toBeNull()
    expect(config.agentSwitching[1]).toEqual({ type: 'chord', key: '2', modifiers: ['ctrl'] })
  })
})
