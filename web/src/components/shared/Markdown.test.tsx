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
      expect(html).toContain('class="text-text-primary text-sm block"')
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
      expect(html).toContain('class="text-text-primary text-sm block"')
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
})
