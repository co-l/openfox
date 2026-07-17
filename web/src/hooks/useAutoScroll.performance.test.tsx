// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useAutoScroll } from './useAutoScroll'

const observe = vi.fn()
const disconnect = vi.fn()

class FakeMutationObserver {
  observe = observe
  disconnect = disconnect
}

function Harness({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useAutoScroll(ref, null, enabled)
  return <div ref={ref}>content</div>
}

beforeEach(() => {
  observe.mockClear()
  disconnect.mockClear()
  vi.stubGlobal('MutationObserver', FakeMutationObserver)
  vi.spyOn(window, 'setInterval')
  vi.spyOn(window, 'clearInterval')
  vi.spyOn(HTMLElement.prototype, 'addEventListener')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useAutoScroll performance lifecycle', () => {
  it('does not attach observers, listeners, or intervals while disabled', () => {
    render(<Harness enabled={false} />)

    expect(observe).not.toHaveBeenCalled()
    expect(window.setInterval).not.toHaveBeenCalled()
    const ownListenerCalls = vi.mocked(HTMLElement.prototype.addEventListener).mock.calls.filter(
      ([type, _listener, options]) =>
        ['wheel', 'touchstart', 'touchmove'].includes(String(type)) &&
        typeof options === 'object' &&
        options !== null &&
        'passive' in options,
    )
    expect(ownListenerCalls).toHaveLength(0)
  })

  it('attaches while enabled and fully disconnects when disabled', () => {
    const view = render(<Harness enabled={true} />)

    expect(observe).toHaveBeenCalledTimes(1)
    expect(window.setInterval).toHaveBeenCalledTimes(1)

    view.rerender(<Harness enabled={false} />)

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(window.clearInterval).toHaveBeenCalledTimes(1)
  })
})
