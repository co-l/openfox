// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ThinkingSummary } from './ThinkingSummary'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ThinkingSummary', () => {
  it('shows a live ticking indicator while thinking', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { container } = render(<ThinkingSummary messageId="m-live" isStreaming thinkingFinished={false} />)

    expect(container.textContent).toContain('Thinking…')

    act(() => vi.advanceTimersByTime(12_000))

    expect(container.textContent).toContain('(12s)')
  })

  it('ticks every 100ms while under ten seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { container } = render(<ThinkingSummary messageId="m-fast" isStreaming thinkingFinished={false} />)

    act(() => vi.advanceTimersByTime(700))

    expect(container.textContent).toContain('(0.7s)')
  })

  it('switches to a final duration once thinking finishes mid-stream', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { container, rerender } = render(
      <ThinkingSummary messageId="m-frozen" isStreaming thinkingFinished={false} />,
    )

    vi.setSystemTime(160_000)
    rerender(<ThinkingSummary messageId="m-frozen" isStreaming thinkingFinished />)

    expect(container.textContent).toContain('Thought for 1m 0s')
  })

  it('prefers the server-measured duration when available', () => {
    const { container } = render(
      <ThinkingSummary messageId="m-server" isStreaming={false} thinkingFinished thinkingDuration={160} />,
    )

    expect(container.textContent).toContain('Thought for 2m 40s')
  })

  it('matches the thinking block styling', () => {
    const { container } = render(
      <ThinkingSummary messageId="m-style" isStreaming={false} thinkingFinished thinkingDuration={5} />,
    )

    const feedItem = container.querySelector('.feed-item')
    expect(feedItem?.className).toContain('bg-secondary')
    expect(feedItem?.className).toContain('rounded')
    expect(feedItem?.className).toContain('p-1.5')
  })

  it('renders nothing when no timing data is available', () => {
    const { container } = render(<ThinkingSummary messageId="m-unknown" isStreaming={false} thinkingFinished />)

    expect(container.textContent).toBe('')
  })
})
