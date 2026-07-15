// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { shouldCaptureMessageSearchShortcut } from './message-search-shortcut'

describe('PlanPanel Ctrl+F shortcut', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('leaves browser search untouched while Settings is open', () => {
    document.body.innerHTML = '<div data-global-settings></div>'
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })
    expect(shouldCaptureMessageSearchShortcut(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })
})
