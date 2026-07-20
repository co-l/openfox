import { describe, it, expect } from 'vitest'
import { decodeDataUrl } from './data-url.js'

describe('decodeDataUrl', () => {
  it('decodes a standard base64 data URL', () => {
    const result = decodeDataUrl('data:text/plain;base64,SGVsbG8gV29ybGQ=')
    expect(result).toBeInstanceOf(Buffer)
    expect(result!.toString()).toBe('Hello World')
  })

  it('decodes a PDF data URL', () => {
    const buf = Buffer.from('%PDF-1.4 fake pdf')
    const dataUrl = `data:application/pdf;base64,${buf.toString('base64')}`
    const result = decodeDataUrl(dataUrl)
    expect(result).toBeInstanceOf(Buffer)
    expect(result!.toString('latin1')).toContain('%PDF-1.4')
  })

  it('decodes an image data URL', () => {
    const buf = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
    const result = decodeDataUrl(dataUrl)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('returns null for invalid data URL format', () => {
    expect(decodeDataUrl('not-a-data-url')).toBeNull()
  })

  it('returns null for data URL without base64', () => {
    expect(decodeDataUrl('data:text/plain,hello')).toBeNull()
  })

  it('returns empty buffer for malformed base64 content', () => {
    const result = decodeDataUrl('data:application/pdf;base64,!@#$%')
    expect(result).toBeInstanceOf(Buffer)
    expect(result!.length).toBe(0)
  })

  it('returns null for empty input', () => {
    expect(decodeDataUrl('')).toBeNull()
  })
})
