// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import { renderToString } from 'react-dom/server'
import remarkGfm from 'remark-gfm'
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
  warmUpHighlighter: () => {},
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
    expect(splitMarkdownBlocks('Intro\n\n- item\n\n  continued paragraph\n\n- next\n\nAfter')).toEqual([
      'Intro\n\n',
      '- item\n\n  continued paragraph\n\n- next\n\n',
      'After',
    ])
  })

  it('keeps a loose list in one block, so it renders as one list', () => {
    expect(splitMarkdownBlocks('- a\n\n- b\n\nAfter')).toEqual(['- a\n\n- b\n\n', 'After'])
    expect(splitMarkdownBlocks('1. one\n\n2. two')).toEqual(['1. one\n\n2. two'])
    expect(splitMarkdownBlocks('Intro:\n- a\n\n- b')).toEqual(['Intro:\n- a\n\n- b'])
  })

  // Blocks are rendered on their own, also once the message is finished: they
  // must parse exactly like the whole message (react-markdown defaults here, so
  // the check covers the splitting, not OpenFox's components).
  it.each([
    ['the sample', SAMPLE],
    ['a loose bullet list', '- one\n\n- two\n\n- three\n\nAfter the list.'],
    ['a loose ordered list', '1. one\n\n2. two\n\n3. three'],
    ['a list item with an indented paragraph', '- item\n\n  continued paragraph\n\n- next'],
    ['a nested loose list', '- top\n\n  - nested\n\n  - nested two\n\n- top two'],
    ['a list right after a paragraph', 'Steps:\n- first\n\n- second\n\nDone.'],
    ['two lists of different kinds', '- bullet\n\n1. ordered\n\n2. ordered two'],
    ['separate quotes', '> one\n\n> two'],
    ['indented code after a paragraph', 'Run:\n\n    npm test\n\nThen read.'],
    ['a table and headings', '# A\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n## B\n\nText'],
  ])('parses the blocks of %s like the whole message', (_name, content) => {
    const html = (markdown: string) =>
      renderToString(<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>).replace(/>\s+</g, '><')
    expect(
      splitMarkdownBlocks(content)
        .map((block) => html(block))
        .join(''),
    ).toBe(html(content))
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

  it('renders a loose list as one list', () => {
    const html = renderToString(<Markdown content={'1. one\n\n2. two\n\n3. three'} isStreaming />)
    expect(html.match(/<ol/g)).toHaveLength(1)
  })

  it('only re-parses the block that is still being written', () => {
    const { rerender, container } = render(<Markdown content={'# Title\n\nFirst para\n\nSecond'} isStreaming />)
    parsedChunks.length = 0

    rerender(<Markdown content={'# Title\n\nFirst para\n\nSecond para grows'} isStreaming />)

    expect(parsedChunks).toEqual(['Second para grows'])
    expect(container.textContent).toContain('Second para grows')
  })

  it('keeps the parsed blocks when streaming ends, parsing only the last one again', () => {
    // Parsing the whole message again at the end was one long task, e.g. ~1 s
    // (2x throttled) for a 100k-character reasoning when it finished.
    const { rerender, container } = render(<Markdown content={'# Title\n\nBody'} isStreaming />)
    parsedChunks.length = 0

    rerender(<Markdown content={'# Title\n\nBody'} />)

    // Only the last block, the one being written until now, is parsed again.
    expect(parsedChunks).toEqual(['Body'])
    expect(container.textContent).toContain('Body')
  })

  it('parses a finished message as a whole when a link or footnote is defined in another block', () => {
    const content = '**See** [the docs][docs].\n\n[docs]: https://example.com/docs'
    const { rerender, container } = render(<Markdown content={content} isStreaming />)
    parsedChunks.length = 0

    rerender(<Markdown content={content} />)

    expect(parsedChunks).toEqual([content])
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs')
  })
})
