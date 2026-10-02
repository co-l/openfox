// @vitest-environment happy-dom
import { render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { RunCommandView } from './RunCommandView'

const wsSendMock = vi.fn().mockReturnValue('mock-msg-id')
let wsConnected = true
const wsSubscribers = new Set<(m: { id?: string; type: string; payload: unknown }) => void>()
vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: (...args: unknown[]) => {
      if (!wsConnected) throw new Error('WebSocket not connected')
      return wsSendMock(...args)
    },
    subscribe: (handler: (m: { id?: string; type: string; payload: unknown }) => void) => {
      wsSubscribers.add(handler)
      return () => wsSubscribers.delete(handler)
    },
    get isConnected() {
      return wsConnected
    },
  },
}))

function dispatchWsMessage(message: { id?: string; type: string; payload: unknown }) {
  for (const handler of wsSubscribers) handler(message)
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
  wsSendMock.mockClear()
  wsConnected = true
  wsSubscribers.clear()
})

interface ScrollMetrics {
  scrollHeight: number
  offsetHeight: number
}

// Grab the mocked ScrollArea (renders a plain div) that wraps the output, then
// instrument scrollHeight/offsetHeight/scrollTop so scroll following is asserted
// deterministically without relying on happy-dom layout.
function instrumentOutputViewport(container: HTMLElement, metrics: ScrollMetrics) {
  const viewport = container.querySelector('.max-h-64') as HTMLElement | null
  if (!viewport) throw new Error('output ScrollArea not found')
  let scrollTop = 0
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
  Object.defineProperty(viewport, 'offsetHeight', { configurable: true, get: () => metrics.offsetHeight })
  Object.defineProperty(viewport, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
  })
  return { viewport, getScrollTop: () => scrollTop, setScrollTop: (v: number) => (scrollTop = v) }
}

// Like instrumentOutputViewport but patches the element prototypes BEFORE render,
// so scroll writes performed during the mount effect are also captured.
function installMountScrollCapture(metrics: ScrollMetrics) {
  const findOwner = (key: string): object | null => {
    let cur: object | null = HTMLElement.prototype
    while (cur) {
      if (Object.getOwnPropertyDescriptor(cur, key)) return cur
      cur = Object.getPrototypeOf(cur)
    }
    return null
  }
  const owners = {
    scrollHeight: findOwner('scrollHeight'),
    offsetHeight: findOwner('offsetHeight'),
    scrollTop: findOwner('scrollTop'),
  }
  const originals = {
    scrollHeight: owners.scrollHeight
      ? Object.getOwnPropertyDescriptor(owners.scrollHeight, 'scrollHeight')
      : undefined,
    offsetHeight: owners.offsetHeight
      ? Object.getOwnPropertyDescriptor(owners.offsetHeight, 'offsetHeight')
      : undefined,
    scrollTop: owners.scrollTop ? Object.getOwnPropertyDescriptor(owners.scrollTop, 'scrollTop') : undefined,
  }

  let captured = 0
  const isTarget = (el: unknown): el is HTMLElement =>
    el instanceof HTMLElement && typeof el.classList?.contains === 'function' && el.classList.contains('max-h-64')

  const patch = (key: string, desc: PropertyDescriptor) => {
    const owner = owners[key as keyof typeof owners]
    if (owner) Object.defineProperty(owner, key, desc)
  }

  patch('scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (isTarget(this)) return metrics.scrollHeight
      return originals.scrollHeight?.get?.call(this)
    },
  })
  patch('offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (isTarget(this)) return metrics.offsetHeight
      return originals.offsetHeight?.get?.call(this)
    },
  })
  patch('scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      if (isTarget(this)) return captured
      return originals.scrollTop?.get?.call(this)
    },
    set(this: HTMLElement, v: number) {
      if (isTarget(this)) {
        captured = v
        return
      }
      originals.scrollTop?.set?.call(this, v)
    },
  })

  return {
    getScrollTop: () => captured,
    restore: () => {
      if (owners.scrollHeight && originals.scrollHeight) {
        Object.defineProperty(owners.scrollHeight, 'scrollHeight', originals.scrollHeight)
      }
      if (owners.offsetHeight && originals.offsetHeight) {
        Object.defineProperty(owners.offsetHeight, 'offsetHeight', originals.offsetHeight)
      }
      if (owners.scrollTop && originals.scrollTop) {
        Object.defineProperty(owners.scrollTop, 'scrollTop', originals.scrollTop)
      }
    },
  }
}

function renderPending(output: string[], command = 'echo hello') {
  return render(
    <RunCommandView
      command={command}
      timeout={10_000}
      status="pending"
      startedAt={Date.now()}
      streamingOutput={output.map((content) => ({ stream: 'stdout' as const, content }))}
    />,
  )
}

describe('RunCommandView auto-scroll', () => {
  it('follows streaming output to the bottom while the command is pending', async () => {
    const { container, rerender } = renderPending(['first line\n'])

    const metrics: ScrollMetrics = { scrollHeight: 342, offsetHeight: 306 }
    const { getScrollTop } = instrumentOutputViewport(container, metrics)

    // More output arrives -> scroll height grows and the viewport must follow.
    metrics.scrollHeight = 966
    rerender(
      <RunCommandView
        command="echo hello"
        timeout={10_000}
        status="pending"
        startedAt={Date.now()}
        streamingOutput={[
          { stream: 'stdout', content: 'first line\n' },
          { stream: 'stdout', content: 'second line of output\n' },
          { stream: 'stdout', content: 'third line of output\n' },
        ]}
      />,
    )

    await waitFor(() => expect(getScrollTop()).toBe(metrics.scrollHeight))
  })

  it('restores the output tail when a streaming command finishes', async () => {
    const { container, rerender } = renderPending(['one line\n'])

    const metrics: ScrollMetrics = { scrollHeight: 311, offsetHeight: 277 }
    const { getScrollTop } = instrumentOutputViewport(container, metrics)

    metrics.scrollHeight = 917
    rerender(
      <RunCommandView
        command="echo hello"
        timeout={10_000}
        status="success"
        startedAt={Date.now()}
        durationMs={860}
        result={`${'final tail line\n'.repeat(30)}`}
      />,
    )

    // The completed re-render swaps the content wholesale (resetting the viewport
    // to the top); it must settle back at the tail the user was following.
    await waitFor(() => expect(getScrollTop()).toBe(metrics.scrollHeight))
  })

  it('lands freshly-mounted completed output at the bottom tail', () => {
    const capture = installMountScrollCapture({ scrollHeight: 9326, offsetHeight: 418 })
    try {
      render(
        <RunCommandView
          command="echo hello"
          timeout={10_000}
          status="success"
          startedAt={Date.now()}
          durationMs={1280}
          result={`${'finished line\n'.repeat(430)}`}
        />,
      )
      // The mount effect must settle a completed command at the tail immediately.
      expect(capture.getScrollTop()).toBe(9326)
    } finally {
      capture.restore()
    }
  })

  it('lets the user escape auto-scroll while pending (no re-enable on timer re-renders)', () => {
    vi.useFakeTimers()
    try {
      const { container } = renderPending(['one\n', 'two\n'])

      const metrics: ScrollMetrics = { scrollHeight: 1317, offsetHeight: 203 }
      const { viewport, getScrollTop, setScrollTop } = instrumentOutputViewport(container, metrics)

      // User scrolls up out of the follow zone, after the follow-guard window.
      act(() => {
        vi.setSystemTime(Date.now() + 3040)
      })
      setScrollTop(146)
      act(() => {
        viewport.dispatchEvent(new Event('scroll'))
      })

      // Let the 100ms elapsed timer re-render several times. Re-renders alone
      // must never re-engage the follow and yank the user back to the bottom.
      act(() => {
        vi.advanceTimersByTime(670)
      })
      expect(getScrollTop()).toBe(146)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RunCommandView fast-forward button', () => {
  it('renders the button while pending and advances the elapsed by +60s per click without extending the total', () => {
    vi.useFakeTimers()
    try {
      const startedAt = Date.now()
      const { container } = render(
        <RunCommandView
          command="echo hello"
          timeout={600_000}
          status="pending"
          startedAt={startedAt}
          callId="call-123"
          streamingOutput={[{ stream: 'stdout', content: 'out\n' }]}
        />,
      )

      const counter = () => container.textContent?.match(/(\d+\.\d)s \/ (\d+)s/)?.[0]
      expect(counter()).toBe('0.0s / 600s')

      const button = container.querySelector('button')
      expect(button).toBeTruthy()
      expect(button?.textContent).toBe('Skip timeout')

      // One click advances the elapsed by 60s; the total stays at 600s and no
      // fast-forward is sent because 60s < 600s.
      act(() => {
        button?.click()
      })
      expect(counter()).toBe('60.0s / 600s')
      expect(wsSendMock).not.toHaveBeenCalled()
      // Confirmation feedback is shown briefly after the click
      expect(button?.textContent).toBe('✓ +60 s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends command.fastForward with the callId when the fast-forwarded elapsed reaches the total', () => {
    vi.useFakeTimers()
    try {
      const startedAt = Date.now()
      const { container } = render(
        <RunCommandView
          command="echo hello"
          timeout={600_000}
          status="pending"
          startedAt={startedAt}
          callId="call-123"
          streamingOutput={[{ stream: 'stdout', content: 'out\n' }]}
        />,
      )

      const counter = () => container.textContent?.match(/(\d+\.\d)s \/ (\d+)s/)?.[0]

      // ~10 clicks of +60s reach the 600s total; the fast-forward is sent only
      // on the click that crosses the threshold.
      for (let i = 0; i < 9; i++) {
        act(() => {
          container.querySelector('button')?.click()
        })
      }
      expect(counter()).toBe('540.0s / 600s')
      expect(wsSendMock).not.toHaveBeenCalled()

      act(() => {
        container.querySelector('button')?.click()
      })
      expect(counter()).toBe('600.0s / 600s')
      expect(wsSendMock).toHaveBeenCalledWith('command.fastForward', { toolCallId: 'call-123' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries the fast-forward send while the socket is down, then sends once it is back', () => {
    vi.useFakeTimers()
    try {
      wsConnected = false
      const startedAt = Date.now()
      const { container } = render(
        <RunCommandView
          command="echo hello"
          timeout={60_000}
          status="pending"
          startedAt={startedAt}
          callId="call-123"
          streamingOutput={[{ stream: 'stdout', content: 'out\n' }]}
        />,
      )

      const button = container.querySelector('button')
      // Crossing the threshold while the socket is down: the send throws and
      // is swallowed.
      act(() => {
        button?.click()
      })
      expect(wsSendMock).not.toHaveBeenCalled()

      // The delivery retry picks it up once the socket is back.
      wsConnected = true
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(wsSendMock).toHaveBeenCalledWith('command.fastForward', { toolCallId: 'call-123' })
      // No duplicate send on further retries.
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(wsSendMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks further fast-forward when the server answers with an error (no active command)', () => {
    vi.useFakeTimers()
    try {
      const startedAt = Date.now()
      const { container } = render(
        <RunCommandView
          command="echo hello"
          timeout={60_000}
          status="pending"
          startedAt={startedAt}
          callId="call-123"
          streamingOutput={[{ stream: 'stdout', content: 'out\n' }]}
        />,
      )

      const counter = () => container.textContent?.match(/(\d+\.\d)s \/ (\d+)s/)?.[0]
      const button = () => container.querySelector('button')

      act(() => {
        button()?.click()
      })
      expect(wsSendMock).toHaveBeenCalledTimes(1)

      // The server reports no active command for this call id.
      act(() => {
        dispatchWsMessage({
          id: 'mock-msg-id',
          type: 'error',
          payload: { code: 'NO_ACTIVE_COMMAND', message: 'Aucune commande active à avancer' },
        })
      })
      expect(button()?.textContent).toBe('⚠')
      expect(counter()).toBe('60.0s / 60s')

      // Further clicks no longer grow the offset.
      act(() => {
        button()?.click()
      })
      expect(counter()).toBe('60.0s / 60s')
      expect(wsSendMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not render the button once the command has finished', () => {
    const { container } = render(
      <RunCommandView
        command="echo hello"
        timeout={10_000}
        status="success"
        startedAt={Date.now()}
        durationMs={100}
        result="done"
        callId="call-123"
      />,
    )

    expect(container.querySelector('button')).toBeNull()
    expect(wsSendMock).not.toHaveBeenCalled()
  })
})
