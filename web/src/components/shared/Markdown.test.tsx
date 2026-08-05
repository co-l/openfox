// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Markdown, getMarkdownCacheBytesForTest, setMarkdownCacheMaxBytesForTest } from './Markdown'
import { renderToString } from 'react-dom/server'

describe('Markdown', () => {
  describe('lists', () => {
    it('renders ordered lists with block class on li elements', () => {
      const content = `
1. First item
2. Second item
3. Third item
      `.trim()

      const html = renderToString(<Markdown content={content} />)

      // Verify the HTML contains the expected structure
      expect(html).toContain('<ol')
      expect(html).toContain('<li')

      // The li elements should have the 'block' class (in HTML it's 'class' not 'className')
      expect(html).toContain('class="text-text-primary text-sm list-item"')
    })

    it('renders unordered lists with block class on li elements', () => {
      const content = `
- Item one
- Item two
- Item three
      `.trim()

      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<ul')
      expect(html).toContain('<li')

      // The li elements should have the 'block' class
      expect(html).toContain('class="text-text-primary text-sm list-item"')
    })

    it('maintains consistent spacing between list items', () => {
      const content = `
1. First
2. Second
      `.trim()

      const html = renderToString(<Markdown content={content} />)

      // Check that the ol has the space-y-0.5 class for consistent spacing
      expect(html).toContain('class="list-decimal list-inside mb-1.5 space-y-0.5"')
    })

    it('maintains list styling (decimal for ol, disc for ul)', () => {
      const olContent = '1. Item 1\n2. Item 2'
      const ulContent = '- Item A\n- Item B'

      const olHtml = renderToString(<Markdown content={olContent} />)
      const ulHtml = renderToString(<Markdown content={ulContent} />)

      expect(olHtml).toContain('list-decimal')
      expect(ulHtml).toContain('list-disc')
    })
  })

  describe('preprocessing', () => {
    it('converts Unicode bullets to markdown list items', () => {
      const content = '• First item\n• Second item'
      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<ul')
      expect(html).toContain('<li')
      expect(html).toContain('First item')
    })

    it('fixes numbered list items with content on next line', () => {
      const content = '1.\n**verifier** - desc\n2.\n**reviewer** - desc'
      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<ol')
      expect(html).toContain('verifier')
      expect(html).toContain('reviewer')
    })

    it('handles mixed Unicode bullets and numbered lists', () => {
      const content = '1.\n**tool** - description\n- Use when: testing\n- Has access to: `read_file`'
      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('tool')
      expect(html).toContain('Use when: testing')
    })
  })

  describe('loose list rendering', () => {
    it('applies inline style to paragraphs inside list items via container class', () => {
      // Loose lists (blank lines between items) cause ReactMarkdown to wrap content in <p> tags
      // The [&_li>p]:inline class prevents the marker from appearing on its own line
      const content =
        '1. **verifier** - Verify criteria\n   - Use when: testing\n\n2. **reviewer** - Review code\n   - Use when: reviewing'
      const html = renderToString(<Markdown content={content} />)

      // Verify the container has the inline fix class
      expect(html).toContain('[&amp;_li&gt;p]:inline')
      // Verify list structure is intact
      expect(html).toContain('<ol')
      expect(html).toContain('verifier')
      expect(html).toContain('reviewer')
    })
  })

  describe('plain text fast path', () => {
    it('renders plain prose as a single paragraph with the same styling as markdown paragraphs', () => {
      const html = renderToString(<Markdown content="Hello world, this is plain prose." />)

      expect(html).toContain(
        '<p class="text-text-primary mb-1.5 last:mb-0 leading-tight break-words whitespace-pre-line">Hello world, this is plain prose.</p>',
      )
    })

    it('preserves paragraph breaks in plain prose', () => {
      const html = renderToString(<Markdown content={'First paragraph.\n\nSecond paragraph.'} />)

      expect(html).toContain('First paragraph.')
      expect(html).toContain('Second paragraph.')
      expect(html).toContain('whitespace-pre-line')
    })

    it('strips trailing blank lines so LLM padding does not render as gaps', () => {
      const html = renderToString(<Markdown content={'All green.\n\n\n\n'} />)

      expect(html).toContain('>All green.</p>')
      expect(html).not.toContain('All green.\n')
    })

    it('linkifies bare URLs like the markdown path does', () => {
      const html = renderToString(<Markdown content={'See https://example.com/docs for details'} />)

      expect(html).toContain('<a href="https://example.com/docs"')
      expect(html).toContain('example.com/docs')
    })

    it('applies the muted color for muted plain text', () => {
      const html = renderToString(<Markdown content="Quiet thought." muted />)

      expect(html).toContain('text-text-muted')
      expect(html).toContain('Quiet thought.')
    })

    it('renders empty or whitespace-only content as nothing', () => {
      const html = renderToString(<Markdown content="   " />)

      expect(html).not.toContain('<p')
    })

    it('still routes markdown syntax to the full parser', () => {
      const html = renderToString(<Markdown content="This has **bold** text." />)

      expect(html).toContain('<strong')
      expect(html).toContain('bold')
    })

    it('renders the muted variant distinctly even when the same content was rendered before', () => {
      // Same content string, different context: the parse cache must not
      // serve the non-muted node to the muted render.
      const normal = renderToString(<Markdown content="Quiet thought." />)
      const mutedHtml = renderToString(<Markdown content="Quiet thought." muted />)

      expect(normal).toContain('text-text-primary')
      expect(mutedHtml).toContain('text-text-muted')
      expect(normal).not.toBe(mutedHtml)
    })

    it('evicts large cached entries so the byte budget is not exceeded', () => {
      // Shrink the budget instead of feeding it 24MB: eviction behaves the same
      // at any threshold, and the content must stay markdown (the plain-text
      // fast path never reaches the cache, so plain filler would prove nothing).
      const budget = 200_000
      setMarkdownCacheMaxBytesForTest(budget)
      try {
        // 30 x ~20KB = ~600KB of keys, well past the shrunk budget.
        const big = `# Heading\n\n${'x'.repeat(20_000)}`
        for (let i = 0; i < 30; i++) {
          renderToString(<Markdown content={`${big} ${i}`} />)
        }
        // Bounded, and actually filled — a zero here would mean the renders
        // bypassed the cache and the assertion above proved nothing.
        expect(getMarkdownCacheBytesForTest()).toBeGreaterThan(0)
        expect(getMarkdownCacheBytesForTest()).toBeLessThanOrEqual(budget)
        // And the cache still works for fresh content
        const html = renderToString(<Markdown content={`${big} fresh`} />)
        expect(html).toContain('Heading')
      } finally {
        setMarkdownCacheMaxBytesForTest()
      }
    })
  })

  describe('markdown edge cases (full parser routing)', () => {
    it('routes strikethrough (~~text~~) to the full parser', () => {
      const html = renderToString(<Markdown content="This is ~~deleted~~ text." />)

      expect(html).toContain('<del')
      expect(html).toContain('deleted')
      expect(html).not.toContain('~~deleted~~')
    })

    it('routes blockquotes without space after > to the full parser', () => {
      const html = renderToString(<Markdown content=">quoted without space" />)

      expect(html).toContain('<blockquote')
      expect(html).toContain('quoted without space')
    })

    it('routes ordered list items with ) delimiter to the full parser', () => {
      const html = renderToString(<Markdown content="1) First item\n2) Second item" />)

      expect(html).toContain('<ol')
      expect(html).toContain('First item')
      expect(html).toContain('Second item')
    })

    it('routes angular autolinks (<https://…>) to the full parser', () => {
      const html = renderToString(<Markdown content="See <https://example.com/page> here" />)

      expect(html).toContain('<a href="https://example.com/page"')
      expect(html).not.toContain('&lt;https://example.com/page&gt;')
    })
  })

  describe('table rendering', () => {
    it('renders tables with pipes at start of lines correctly', () => {
      const content = `## Key Paths

| Path | Purpose |
|------|---------|
| \`/home/conrad/Downloads/\` | Raw downloads |
| \`/home/conrad/medias/\` | Organized media |`

      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<table')
      expect(html).toContain('<th')
      expect(html).toContain('<td')
      expect(html).toContain('Path')
      expect(html).toContain('Purpose')
      expect(html).toContain('/home/conrad/Downloads/')
    })

    it('handles tables with leading pipe on first line only', () => {
      const content = `|
| Path | Purpose |
|------|---------|
| /test | Test desc |`

      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<table')
      expect(html).toContain('Path')
      expect(html).toContain('Purpose')
    })

    it('renders properly formatted tables', () => {
      const content = `| Service | Port |
|---------|------|
| SSH | 22 |
| HTTP | 80 |`

      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<table')
      expect(html).toContain('Service')
      expect(html).toContain('Port')
      expect(html).toContain('SSH')
      expect(html).toContain('22')
    })

    it('handles tables with line numbers (read_file output)', () => {
      const content = `15| | Path | Purpose |
16| |------|---------|
17| | /test | Test desc |`

      const html = renderToString(<Markdown content={content} />)

      expect(html).toContain('<table')
      expect(html).toContain('Path')
      expect(html).toContain('Purpose')
      expect(html).toContain('/test')
    })
  })
})
