// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { latchThinkingStart } from '../../lib/thinking-timing'
import { formatClockTime } from '../../lib/format-date'
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

  it('starts the elapsed time from the thinking start, not the collapse time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    latchThinkingStart('m-late')

    // The block is collapsed 30s after thinking began
    vi.setSystemTime(130_000)
    const { container } = render(<ThinkingSummary messageId="m-late" isStreaming thinkingFinished={false} />)

    expect(container.textContent).toContain('Thinking… (30s)')
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

  it('falls back to a duration-less chip when no timing data is available', () => {
    const { container } = render(<ThinkingSummary messageId="m-unknown" isStreaming={false} thinkingFinished />)

    expect(container.textContent).toContain('Thought')
    const feedItem = container.querySelector('.feed-item')
    expect(feedItem?.className).toContain('bg-secondary')
  })

  it('shows the latched end time and keeps it once server stats arrive', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    latchThinkingStart('m-chip-end')

    vi.setSystemTime(160_000)
    const { container, rerender } = render(<ThinkingSummary messageId="m-chip-end" isStreaming thinkingFinished />)

    expect(container.textContent).toContain('Thought for 1m 0s')
    expect(container.textContent).toContain(formatClockTime(160_000))

    // The authoritative duration arrives with the message stats: the chip
    // must keep showing the latched end time instead of dropping it.
    rerender(<ThinkingSummary messageId="m-chip-end" isStreaming={false} thinkingFinished thinkingDuration={60} />)

    expect(container.textContent).toContain('Thought for 1m 0s')
    expect(container.textContent).toContain(formatClockTime(160_000))
  })

  it('renders no end time when nothing was latched (e.g. after a page reload)', () => {
    const { container } = render(
      <ThinkingSummary messageId="m-fresh" isStreaming={false} thinkingFinished thinkingDuration={5} />,
    )

    expect(container.textContent).toContain('Thought for 5.0s')
    expect(container.textContent).not.toContain('·')
  })
})
