import { describe, it, expect } from 'vitest'
import { TEXT_MIME_EXACT } from '@shared/constants.js'
import { mimeTypeToExtension } from './attachment-utils.js'

describe('mimeTypeToExtension', () => {
  it('should have a mapping for every exact text MIME type', () => {
    const missing = TEXT_MIME_EXACT.filter((mime) => !mimeTypeToExtension(mime))
    expect(missing).toEqual([])
  })

  it('should return a fallback for unknown MIME types', () => {
    expect(mimeTypeToExtension('text/unknown-format')).toBe('unknown-format')
    expect(mimeTypeToExtension('application/octet-stream')).toBe('octet-stream')
  })

  it('should map known MIME types to correct extensions', () => {
    expect(mimeTypeToExtension('application/json')).toBe('json')
    expect(mimeTypeToExtension('application/xml')).toBe('xml')
    expect(mimeTypeToExtension('application/pdf')).toBe('pdf')
    expect(mimeTypeToExtension('image/png')).toBe('png')
    expect(mimeTypeToExtension('text/plain')).toBe('txt')
    expect(mimeTypeToExtension('text/csv')).toBe('csv')
    expect(mimeTypeToExtension('text/markdown')).toBe('md')
  })
})
