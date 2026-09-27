// @vitest-environment happy-dom
import { render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { RunCommandView } from './RunCommandView'

const wsSendMock = vi.fn()
vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: (...args: unknown[]) => wsSendMock(...args),
  },
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
  wsSendMock.mockClear()
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

describe('RunCommandView skip timeout button', () => {
  it('renders the button while pending and sends command.skipTimeout with the callId', () => {
    const { container } = render(
      <RunCommandView
        command="echo hello"
        timeout={10_000}
        status="pending"
        startedAt={Date.now()}
        callId="call-123"
        streamingOutput={[{ stream: 'stdout', content: 'out\n' }]}
      />,
    )

    const button = container.querySelector('button')
    expect(button).toBeTruthy()
    expect(button?.textContent).toBe('Skip timeout')

    button?.click()
    expect(wsSendMock).toHaveBeenCalledWith('command.skipTimeout', { toolCallId: 'call-123' })
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
