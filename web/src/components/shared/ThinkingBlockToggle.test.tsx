// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ThinkingBlockToggle } from './ThinkingBlockToggle'

vi.mock('./ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div>block:{content}</div>,
}))

vi.mock('./ThinkingSummary', () => ({
  ThinkingSummary: () => <div>summary</div>,
}))

afterEach(cleanup)

describe('ThinkingBlockToggle', () => {
  it('expands by default when showThinking is on', () => {
    const { container } = render(
      <ThinkingBlockToggle messageId="t-on" content="thoughts" isStreaming={false} thinkingFinished showThinking />,
    )

    expect(container.textContent).toContain('block:thoughts')
    expect(container.textContent).not.toContain('summary')
  })

  it('collapses by default when showThinking is off', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-off"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        showThinking={false}
      />,
    )

    expect(container.textContent).toContain('summary')
    expect(container.textContent).not.toContain('thoughts')
  })

  it('toggles between collapsed and expanded on click', () => {
    const { container } = render(
      <ThinkingBlockToggle messageId="t-toggle" content="thoughts" isStreaming={false} thinkingFinished showThinking />,
    )
    const root = container.firstElementChild!

    fireEvent.click(root)
    expect(container.textContent).toContain('summary')

    fireEvent.click(root)
    expect(container.textContent).toContain('block:thoughts')
  })

  it('keeps a manual toggle across remounts', () => {
    const { container } = render(
      <ThinkingBlockToggle messageId="t-keep" content="thoughts" isStreaming={false} thinkingFinished showThinking />,
    )
    fireEvent.click(container.firstElementChild!)

    const remounted = render(
      <ThinkingBlockToggle messageId="t-keep" content="thoughts" isStreaming={false} thinkingFinished showThinking />,
    )

    expect(remounted.container.textContent).toContain('summary')
  })
})
