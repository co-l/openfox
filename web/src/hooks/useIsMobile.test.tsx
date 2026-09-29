// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useIsMobile, MOBILE_BREAKPOINT } from './useIsMobile'

function renderProbe() {
  const seen: boolean[] = []
  function Probe() {
    seen.push(useIsMobile())
    return null
  }
  render(<Probe />)
  return seen
}

function resizeTo(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

describe('useIsMobile', () => {
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
  })

  it('is true below the breakpoint and false at or above it', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    expect(renderProbe().at(-1)).toBe(true)

    cleanup()
    Object.defineProperty(window, 'innerWidth', { value: MOBILE_BREAKPOINT, configurable: true })
    expect(renderProbe().at(-1)).toBe(false)
  })

  it('reacts to viewport resizes in both directions', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const seen = renderProbe()
    expect(seen.at(-1)).toBe(true)

    resizeTo(1280)
    expect(seen.at(-1)).toBe(false)

    resizeTo(360)
    expect(seen.at(-1)).toBe(true)
  })
})
