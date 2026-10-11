// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeSvg, sanitizeHtml, isSafeSvg } from './sanitize'

describe('sanitizeSvg', () => {
  it('should allow safe SVG markup', () => {
    const safe = '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z" fill="currentColor"/></svg>'
    const result = sanitizeSvg(safe)
    expect(result).toContain('<svg')
    expect(result).toContain('<path')
  })

  it('should strip script tags', () => {
    const malicious = '<svg><script>alert("xss")</script><path d="M0 0"/></svg>'
    const result = sanitizeSvg(malicious)
    expect(result).not.toContain('<script')
    expect(result).not.toContain('alert')
  })

  it('should strip event handlers', () => {
    const malicious = '<svg onload="alert(1)"><circle r="5"/></svg>'
    const result = sanitizeSvg(malicious)
    expect(result).not.toContain('onload')
    expect(result).not.toContain('alert')
  })

  it('should strip javascript: hrefs', () => {
    const malicious = '<svg><a href="javascript:alert(1)"><text>click</text></a></svg>'
    const result = sanitizeSvg(malicious)
    expect(result).not.toContain('javascript:')
  })

  it('should strip foreignObject', () => {
    const malicious =
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>'
    const result = sanitizeSvg(malicious)
    expect(result).not.toContain('foreignObject')
    expect(result).not.toContain('<script')
  })

  it('should strip use tags with external references', () => {
    const malicious = '<svg><use href="http://evil.com/payload.svg#x"/></svg>'
    const result = sanitizeSvg(malicious)
    expect(result).not.toContain('<use')
    expect(result).not.toContain('evil.com')
  })

  it('should strip iframe and embed tags', () => {
    const malicious = '<svg><iframe src="http://evil.com"></iframe><embed src="http://evil.com"/></svg>'
    const result = sanitizeSvg(malicious)
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('<embed')
  })

  it('should return empty string for empty input', () => {
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg(null as unknown as string)).toBe('')
  })

  it('should preserve safe attributes like fill, stroke, viewBox', () => {
    const safe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2" stroke-width="2"/></svg>'
    const result = sanitizeSvg(safe)
    expect(result).toContain('viewBox')
    expect(result).toContain('fill')
    expect(result).toContain('stroke')
  })
})

describe('sanitizeHtml', () => {
  it('should allow basic formatting tags', () => {
    const html = '<p>Hello <strong>world</strong> <em>!</em></p>'
    const result = sanitizeHtml(html)
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
  })

  it('should allow safe links', () => {
    const html = '<a href="https://example.com" target="_blank" rel="noopener">link</a>'
    const result = sanitizeHtml(html)
    expect(result).toContain('href="https://example.com"')
  })

  it('should strip script tags', () => {
    const malicious = '<p>hello</p><script>alert("xss")</script>'
    const result = sanitizeHtml(malicious)
    expect(result).not.toContain('<script')
  })

  it('should strip event handlers', () => {
    const malicious = '<p onclick="alert(1)">click me</p>'
    const result = sanitizeHtml(malicious)
    expect(result).not.toContain('onclick')
  })

  it('should strip javascript: URLs', () => {
    const malicious = '<a href="javascript:alert(1)">click</a>'
    const result = sanitizeHtml(malicious)
    expect(result).not.toContain('javascript:')
  })

  it('should strip style tags', () => {
    const malicious = '<style>body { display: none }</style><p>hello</p>'
    const result = sanitizeHtml(malicious)
    expect(result).not.toContain('<style')
  })

  it('should strip iframe tags', () => {
    const malicious = '<iframe src="http://evil.com"></iframe>'
    const result = sanitizeHtml(malicious)
    expect(result).not.toContain('<iframe')
  })

  it('should return empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('')
  })
})

describe('isSafeSvg', () => {
  it('should return true for safe SVG', () => {
    const safe = '<svg viewBox="0 0 24 24"><path d="M12 2"/></svg>'
    expect(isSafeSvg(safe)).toBe(true)
  })

  it('should return false for SVG with script', () => {
    const malicious = '<svg><script>alert(1)</script></svg>'
    expect(isSafeSvg(malicious)).toBe(false)
  })
})
