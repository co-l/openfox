// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePageVisible } from './usePageVisible'

let hidden = false
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })

function setHidden(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePageVisible', () => {
  afterEach(() => setHidden(false))

  it('follows the page visibility', () => {
    const { result } = renderHook(() => usePageVisible())
    expect(result.current).toBe(true)
    act(() => setHidden(true))
    expect(result.current).toBe(false)
    act(() => setHidden(false))
    expect(result.current).toBe(true)
  })
})
