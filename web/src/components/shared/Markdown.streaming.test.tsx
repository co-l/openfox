// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

const highlightCodeMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/syntax-highlighter', () => ({
  highlightCode: highlightCodeMock,
  useShikiTheme: () => 'github-dark-default',
}))

const settingsMock = vi.hoisted(() => ({ deferCodeHighlightWhileStreaming: false }))
vi.mock('../../hooks/useDisplaySettings', () => ({
  useDisplaySettings: () => ({ showSyntaxHighlighting: true, ...settingsMock }),
}))

vi.mock('../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))

describe('Markdown streaming highlight deferral', () => {
  beforeEach(() => {
    settingsMock.deferCodeHighlightWhileStreaming = false
    highlightCodeMock.mockReset()
    highlightCodeMock.mockImplementation(async (code: string) => `<pre data-testid="highlighted">${code}</pre>`)
  })

  afterEach(cleanup)

  it('highlights streaming code blocks progressively by default (deferral is opt-in)', async () => {
    const { container } = render(<Markdown content={'```js\nconst x = 1'} isStreaming />)

    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalled())
    expect(container.textContent).toContain('const x = 1')
  })

  it('does not call highlightCode while streaming with an open code block when deferral is enabled', () => {
    settingsMock.deferCodeHighlightWhileStreaming = true
    const { getByText } = render(<Markdown content={'```js\nconst x = 1'} isStreaming />)

    expect(highlightCodeMock).not.toHaveBeenCalled()
    expect(getByText('const x = 1')).toBeInTheDocument()
  })

  it('highlights the code block exactly once when it closes during streaming (deferral enabled)', async () => {
    settingsMock.deferCodeHighlightWhileStreaming = true
    const { rerender, container } = render(<Markdown content={'```js\nconst x = 1'} isStreaming />)
    expect(highlightCodeMock).not.toHaveBeenCalled()

    rerender(<Markdown content={'```js\nconst x = 1\n```'} isStreaming />)
    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))
    expect(container.querySelector('[data-testid="highlighted"]')).toBeTruthy()

    rerender(<Markdown content={'```js\nconst x = 1\n```'} isStreaming />)
    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))
  })

  it('highlights a closed code block when streaming ends (deferral enabled)', async () => {
    settingsMock.deferCodeHighlightWhileStreaming = true
    const { rerender } = render(<Markdown content={'```js\nconst x = 1'} isStreaming />)
    expect(highlightCodeMock).not.toHaveBeenCalled()

    rerender(<Markdown content={'```js\nconst x = 1'} />)
    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))
  })

  it('keeps highlighting closed blocks when not streaming (default behavior)', async () => {
    const { container } = render(<Markdown content={'```js\nconst x = 1\n```'} />)

    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))
    expect(container.querySelector('[data-testid="highlighted"]')).toBeTruthy()
  })

  it('does not re-highlight stable closed blocks across renders', async () => {
    const { rerender } = render(<Markdown content={'```js\nconst x = 1\n```'} />)
    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))

    rerender(<Markdown content={'```js\nconst x = 1\n```'} />)
    await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))
  })

  it('skips highlighting for plain text blocks', async () => {
    render(<Markdown content={'```text\nplain output\n```'} />)
    await waitFor(() => expect(highlightCodeMock).not.toHaveBeenCalled())
  })

  it('skips highlighting for very large blocks (tool outputs)', async () => {
    const big = 'line of code\n'.repeat(400) // > 5000 chars
    const { container } = render(<Markdown content={`\`\`\`bash\n${big}\`\`\``} />)

    await waitFor(() => expect(highlightCodeMock).not.toHaveBeenCalled())
    expect(container.textContent).toContain('line of code')
  })
})
