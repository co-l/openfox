// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ThinkingBlockToggle } from './ThinkingBlockToggle'

vi.mock('./ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div>block:{content}</div>,
}))

afterEach(cleanup)

describe('ThinkingBlockToggle', () => {
  it('expands by default when showThinking is on', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-on"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        thinkingDuration={5}
        showThinking
      />,
    )

    expect(container.textContent).toContain('block:thoughts')
    expect(container.textContent).not.toContain('Thought for')
  })

  it('collapses by default when showThinking is off', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-off"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        thinkingDuration={5}
        showThinking={false}
      />,
    )

    expect(container.textContent).toContain('Thought for')
    expect(container.textContent).not.toContain('thoughts')
  })

  it('toggles between collapsed and expanded on click', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-toggle"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        thinkingDuration={5}
        showThinking
      />,
    )
    const root = container.firstElementChild!

    fireEvent.click(root)
    expect(container.textContent).toContain('Thought for')

    fireEvent.click(root)
    expect(container.textContent).toContain('block:thoughts')
  })

  it('keeps a click target when collapsing a block with no known duration', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-noduration"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        showThinking
      />,
    )
    const root = container.firstElementChild!

    fireEvent.click(root)

    // The collapsed state must never render nothing, or the block disappears
    // from the feed with no way to click it back open.
    expect(container.textContent!.trim()).not.toBe('')

    fireEvent.click(root)
    expect(container.textContent).toContain('block:thoughts')
  })

  it('does not collapse when a text selection inside the block is active', () => {
    const { container } = render(
      <ThinkingBlockToggle messageId="t-sel" content="thoughts" isStreaming={false} thinkingFinished showThinking />,
    )
    const root = container.firstElementChild!
    const text = [...root.querySelectorAll('*')]
      .flatMap((el) => [...el.childNodes])
      .find((n) => n.textContent?.includes('thoughts'))!

    const range = document.createRange()
    range.selectNodeContents(text as Node)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(selection.isCollapsed).toBe(false)

    fireEvent.click(root)

    // Selecting text is not a collapse gesture: the block stays expanded.
    expect(container.textContent).toContain('block:thoughts')
    expect(container.textContent).not.toContain('Thought')
  })

  it('still collapses when the selection was made outside the block', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-sel-out"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        thinkingDuration={5}
        showThinking
      />,
    )
    const root = container.firstElementChild!
    const outside = document.createElement('div')
    outside.textContent = 'somewhere else'
    document.body.appendChild(outside)

    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent.click(root)

    // A stale selection elsewhere must not block the collapse gesture.
    expect(container.textContent).toContain('Thought for')
    expect(container.textContent).not.toContain('block:thoughts')
  })

  it('keeps a manual toggle across remounts', () => {
    const { container } = render(
      <ThinkingBlockToggle
        messageId="t-keep"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        thinkingDuration={5}
        showThinking
      />,
    )
    fireEvent.click(container.firstElementChild!)

    const remounted = render(
      <ThinkingBlockToggle
        messageId="t-keep"
        content="thoughts"
        isStreaming={false}
        thinkingFinished
        thinkingDuration={5}
        showThinking
      />,
    )

    expect(remounted.container.textContent).toContain('Thought for')
  })
})
