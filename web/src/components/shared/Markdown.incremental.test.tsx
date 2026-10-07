// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown, splitMarkdownBlocks } from './Markdown'

// Count what react-markdown is asked to parse, while still rendering for real.
const parsedChunks = vi.hoisted(() => [] as string[])
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>()
  const Real = actual.default
  return {
    ...actual,
    default: (props: Parameters<typeof Real>[0]) => {
      parsedChunks.push(String(props.children))
      return Real(props)
    },
  }
})

vi.mock('../../lib/syntax-highlighter', () => ({
  highlightCode: async (code: string) => code,
  useShikiTheme: () => 'github-dark-default',
}))

const SAMPLE = `## Plan

Here is **the plan**, with \`inline code\` and a [link](https://example.com).

- first point
- second point

1. step one
2. step two

\`\`\`ts
const a = 1

const b = 2
\`\`\`

| Stage | Cost |
| ----- | ---- |
| parse | low |

> A quoted note
> on two lines

Final paragraph.`

describe('splitMarkdownBlocks', () => {
  it('splits top-level blocks at blank lines', () => {
    expect(splitMarkdownBlocks('# Title\n\nPara one\nstill one\n\nPara two')).toEqual([
      '# Title\n\n',
      'Para one\nstill one\n\n',
      'Para two',
    ])
  })

  it('keeps a fenced code block with blank lines in one block, even while still open', () => {
    expect(splitMarkdownBlocks('Intro\n\n```ts\na\n\nb\n```\n\nAfter')).toEqual([
      'Intro\n\n',
      '```ts\na\n\nb\n```\n\n',
      'After',
    ])
    expect(splitMarkdownBlocks('Intro\n\n~~~\na\n\nb')).toEqual(['Intro\n\n', '~~~\na\n\nb'])
  })

  it('does not close a fence on a different or shorter marker', () => {
    expect(splitMarkdownBlocks('````md\n```\n\nstill code\n````\n\nAfter')).toEqual([
      '````md\n```\n\nstill code\n````\n\n',
      'After',
    ])
  })

  it('keeps indented continuations (list item paragraphs, nested content) with their block', () => {
    expect(splitMarkdownBlocks('- item\n\n  continued paragraph\n\n- next')).toEqual([
      '- item\n\n  continued paragraph\n\n',
      '- next',
    ])
  })

  it('joins back to the original content', () => {
    expect(splitMarkdownBlocks(SAMPLE).join('')).toBe(SAMPLE)
  })
})

describe('Markdown incremental streaming render', () => {
  beforeEach(() => {
    parsedChunks.length = 0
  })

  afterEach(cleanup)

  it('renders the same html while streaming as once finished', () => {
    // A whole-message parse keeps the "\n" text nodes between top-level blocks;
    // block-by-block parsing does not. They render nothing (the container does
    // not preserve whitespace), so they are the one difference allowed here.
    const withoutInterBlockWhitespace = (html: string) => html.replace(/>\s+</g, '><')
    expect(withoutInterBlockWhitespace(renderToString(<Markdown content={SAMPLE} isStreaming />))).toBe(
      withoutInterBlockWhitespace(renderToString(<Markdown content={SAMPLE} />)),
    )
  })

  it('keeps ordered list numbering when a loose list is split into blocks', () => {
    const html = renderToString(<Markdown content={'1. one\n\n2. two\n\n3. three'} isStreaming />)
    expect(html).toContain('start="2"')
    expect(html).toContain('start="3"')
  })

  it('only re-parses the block that is still being written', () => {
    const { rerender, container } = render(<Markdown content={'# Title\n\nFirst para\n\nSecond'} isStreaming />)
    parsedChunks.length = 0

    rerender(<Markdown content={'# Title\n\nFirst para\n\nSecond para grows'} isStreaming />)

    expect(parsedChunks).toEqual(['Second para grows'])
    expect(container.textContent).toContain('Second para grows')
  })

  it('parses the whole message once when streaming ends', () => {
    const { rerender } = render(<Markdown content={'# Title\n\nBody'} isStreaming />)
    parsedChunks.length = 0

    rerender(<Markdown content={'# Title\n\nBody'} />)

    expect(parsedChunks).toEqual(['# Title\n\nBody'])
  })
})
