import { describe, it, expect } from 'vitest'
import { ThinkingBlock } from './ThinkingBlock'
import { renderToString } from 'react-dom/server'

describe('ThinkingBlock', () => {
  describe('default variant', () => {
    it('parses markdown content', () => {
      const content = 'This is **bold** and this is `code`'
      const html = renderToString(<ThinkingBlock content={content} />)

      expect(html).toContain('bold</strong>')
      expect(html).toContain('code</code>')
    })

    it('renders list items as proper HTML', () => {
      const content = '- Item one\n- Item two'
      const html = renderToString(<ThinkingBlock content={content} />)

      expect(html).toContain('<ul')
      expect(html).toContain('<li')
    })

    it('renders headers', () => {
      const content = '## Header'
      const html = renderToString(<ThinkingBlock content={content} />)

      expect(html).toContain('<h2')
      expect(html).toContain('Header')
    })
  })

  describe('labeled variant', () => {
    it('parses markdown content', () => {
      const content = 'This is **bold** and this is `code`'
      const html = renderToString(<ThinkingBlock content={content} variant="labeled" />)

      expect(html).toContain('bold</strong>')
      expect(html).toContain('code</code>')
    })

    it('shows thinking label', () => {
      const content = 'Some thought'
      const html = renderToString(<ThinkingBlock content={content} variant="labeled" />)

      expect(html).toContain('thinking:')
    })
  })
})
