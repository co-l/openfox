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

  describe('growing code block (streaming)', () => {
    // Same structure as shiki's output: one block-level `.line` span per line.
    const shikiLike = (code: string) =>
      `<pre class="shiki"><code>${code
        .split('\n')
        .map((line) => `<span class="line"><span data-testid="token">${line}</span></span>`)
        .join('\n')}</code></pre>`

    beforeEach(() => {
      highlightCodeMock.mockImplementation(async (code: string) => shikiLike(code))
    })

    it('re-highlights at most once per throttle window while showing every new line', async () => {
      const { rerender, container } = render(<Markdown content={'```ts\nconst a = 1'} isStreaming />)
      await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(container.querySelector('.shiki')).toBeTruthy())

      rerender(<Markdown content={'```ts\nconst a = 1\nconst b = 2'} isStreaming />)
      rerender(<Markdown content={'```ts\nconst a = 1\nconst b = 2\nconst c = 3'} isStreaming />)

      // Throttled: no new highlight yet, but the new lines are already on screen
      // as plain lines appended to the highlighted block.
      expect(highlightCodeMock).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain('const c = 3')
      expect(container.querySelectorAll('.shiki .line')).toHaveLength(3)

      // The trailing highlight catches up with the latest content.
      await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(2))
      expect(highlightCodeMock).toHaveBeenLastCalledWith(
        'const a = 1\nconst b = 2\nconst c = 3',
        'ts',
        expect.anything(),
      )
      await waitFor(() => expect(container.querySelectorAll('[data-testid="token"]')).toHaveLength(3))
    })

    it('keeps a highlight that resolves after the block grew (no starvation)', async () => {
      let resolveFirst: (html: string) => void = () => {}
      highlightCodeMock.mockImplementationOnce(() => new Promise<string>((resolve) => (resolveFirst = resolve)))
      const { rerender, container } = render(<Markdown content={'```ts\nconst a = 1'} isStreaming />)
      await waitFor(() => expect(highlightCodeMock).toHaveBeenCalledTimes(1))

      rerender(<Markdown content={'```ts\nconst a = 1\nconst b = 2'} isStreaming />)
      resolveFirst(shikiLike('const a = 1'))

      // The result for the shorter prefix is still used: highlighted first line + plain tail.
      await waitFor(() => expect(container.querySelector('.shiki')).toBeTruthy())
      expect(container.textContent).toContain('const b = 2')
    })

    it('appends a partial last line to the highlighted line instead of starting a new one', async () => {
      const { rerender, container } = render(<Markdown content={'```ts\nconst a'} isStreaming />)
      await waitFor(() => expect(container.querySelector('.shiki')).toBeTruthy())

      rerender(<Markdown content={'```ts\nconst a = 1'} isStreaming />)

      const lines = container.querySelectorAll('.shiki .line')
      expect(lines).toHaveLength(1)
      expect(lines[0]?.textContent).toBe('const a = 1')
    })

    it('escapes the plain tail', async () => {
      const { rerender, container } = render(<Markdown content={'```ts\nconst a = 1'} isStreaming />)
      await waitFor(() => expect(container.querySelector('.shiki')).toBeTruthy())

      rerender(<Markdown content={'```ts\nconst a = 1\nif (a < b && c > d) {}'} isStreaming />)

      expect(container.querySelector('.shiki img, .shiki b')).toBeNull()
      expect(container.textContent).toContain('if (a < b && c > d) {}')
    })
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
