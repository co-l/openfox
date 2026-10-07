// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'

// Qwen-style models stream several times more reasoning than answer: the
// reasoning must take the same block-by-block streaming path as the answer.
vi.mock('./Markdown', () => ({
  Markdown: ({ content, isStreaming }: { content: string; isStreaming?: boolean }) => (
    <div data-streaming={String(Boolean(isStreaming))}>{content}</div>
  ),
}))

afterEach(cleanup)

describe('ThinkingBlock while streaming', () => {
  it.each(['default', 'labeled'] as const)('passes isStreaming to the markdown (%s variant)', (variant) => {
    const { container } = render(<ThinkingBlock content="thoughts" variant={variant} isStreaming />)

    expect(container.querySelector('[data-streaming]')?.getAttribute('data-streaming')).toBe('true')
  })

  it('renders finished reasoning as a complete message', () => {
    const { container } = render(<ThinkingBlock content="thoughts" />)

    expect(container.querySelector('[data-streaming]')?.getAttribute('data-streaming')).toBe('false')
  })
})
