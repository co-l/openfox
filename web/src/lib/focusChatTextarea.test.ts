// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { focusChatTextarea, CHAT_TEXTAREA_ID } from './focusChatTextarea'

describe('focusChatTextarea', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('calls element.focus() without preventScroll when called with no arguments', () => {
    const textarea = document.createElement('textarea')
    textarea.id = CHAT_TEXTAREA_ID
    document.body.appendChild(textarea)
    const focusSpy = vi.spyOn(textarea, 'focus')

    focusChatTextarea()

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalledWith()
  })

  it('calls element.focus({ preventScroll: true }) when called with true', () => {
    const textarea = document.createElement('textarea')
    textarea.id = CHAT_TEXTAREA_ID
    document.body.appendChild(textarea)
    const focusSpy = vi.spyOn(textarea, 'focus')

    focusChatTextarea(true)

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('calls element.focus({ preventScroll: false }) when called with false', () => {
    const textarea = document.createElement('textarea')
    textarea.id = CHAT_TEXTAREA_ID
    document.body.appendChild(textarea)
    const focusSpy = vi.spyOn(textarea, 'focus')

    focusChatTextarea(false)

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: false })
  })

  it('silently does nothing when textarea element does not exist', () => {
    expect(() => focusChatTextarea()).not.toThrow()
    expect(() => focusChatTextarea(true)).not.toThrow()
    expect(() => focusChatTextarea(false)).not.toThrow()
  })
})
