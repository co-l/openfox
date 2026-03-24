import { describe, it, expect } from 'vitest'
import { Markdown } from './Markdown'
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
      const content = '1. **verifier** - Verify criteria\n   - Use when: testing\n\n2. **reviewer** - Review code\n   - Use when: reviewing'
      const html = renderToString(<Markdown content={content} />)

      // Verify the container has the inline fix class
      expect(html).toContain('[&amp;_li&gt;p]:inline')
      // Verify list structure is intact
      expect(html).toContain('<ol')
      expect(html).toContain('verifier')
      expect(html).toContain('reviewer')
    })
  })
})
