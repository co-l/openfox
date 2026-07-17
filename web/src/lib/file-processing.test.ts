// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { processFile } from './file-processing.js'

class MockFileReader {
  result: string | null = null
  onload: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null

  readAsDataURL(_file: File) {
    this.result = 'data:application/pdf;base64,MockPDFData'
    this.onload?.(new Event('load'))
  }
}

function setupMocks() {
  vi.stubGlobal('FileReader', MockFileReader)
  vi.stubGlobal('Image', MockImg)
  vi.stubGlobal('HTMLImageElement', MockImg)
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'high',
        drawImage: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,MockBase64Data',
    }),
  })
}

function restoreMocks() {
  vi.unstubAllGlobals()
}

class MockImg {
  width = 1200
  height = 800
  onload: (() => void) | null = null
  set src(_value: string) {
    this.onload?.()
  }
}

describe('file-processing', () => {
  beforeEach(setupMocks)
  afterEach(restoreMocks)

  it('should process text/plain files by reading content as text', async () => {
    const file = new File(['Hello, this is a text file.'], 'notes.txt', { type: 'text/plain' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('notes.txt')
    expect(attachments[0]?.mimeType).toBe('text/plain')
    expect(attachments[0]?.data).toBe('Hello, this is a text file.')
  })

  it('should process application/json files as text', async () => {
    const file = new File(['{"key": "value"}'], 'data.json', { type: 'application/json' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('data.json')
    expect(attachments[0]?.mimeType).toBe('application/json')
    expect(attachments[0]?.data).toBe('{"key": "value"}')
  })

  it('should process text/csv files as text', async () => {
    const file = new File(['a,b,c\n1,2,3'], 'data.csv', { type: 'text/csv' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('data.csv')
    expect(attachments[0]?.mimeType).toBe('text/csv')
    expect(attachments[0]?.data).toBe('a,b,c\n1,2,3')
  })

  it('should process application/xml files as text', async () => {
    const file = new File(['<root/>'], 'config.xml', { type: 'application/xml' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('config.xml')
    expect(attachments[0]?.mimeType).toBe('application/xml')
    expect(attachments[0]?.data).toBe('<root/>')
  })

  it('should handle text files with large content', async () => {
    const largeContent = 'x'.repeat(5000)
    const file = new File([largeContent], 'large.txt', { type: 'text/plain' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.data).toBe(largeContent)
  })

  it('should reject unsupported file types with error', async () => {
    const file = new File(['binary data'], 'file.bin', { type: 'application/octet-stream' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(attachments).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Unsupported file type')
  })

  it('should reject files exceeding max size', async () => {
    const hugeContent = 'x'.repeat(1100 * 1024) // ~1.1MB, just above MAX_TEXT_SIZE
    const file = new File([hugeContent], 'huge.txt', { type: 'text/plain' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(attachments).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('too large')
  })

  it('should process image files through compression pipeline', async () => {
    const file = new File(['image data'], 'photo.png', { type: 'image/png' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('photo.png')
    expect(attachments[0]?.mimeType).toBe('image/png')
    expect(attachments[0]?.data).toBeDefined()
  })

  it('should process PDF files as data URL', async () => {
    const file = new File(['pdf binary content'], 'doc.pdf', { type: 'application/pdf' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(file, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('doc.pdf')
    expect(attachments[0]?.mimeType).toBe('application/pdf')
    expect(attachments[0]?.data).toBe('data:application/pdf;base64,MockPDFData')
  })

  it('should handle multiple files sequentially', async () => {
    const txtFile = new File(['text content'], 'notes.txt', { type: 'text/plain' })
    const jsonFile = new File(['{}'], 'data.json', { type: 'application/json' })
    const attachments: any[] = []
    const errors: string[] = []

    await processFile(txtFile, (att) => attachments.push(att), (err) => errors.push(err))
    await processFile(jsonFile, (att) => attachments.push(att), (err) => errors.push(err))

    expect(errors).toHaveLength(0)
    expect(attachments).toHaveLength(2)
    expect(attachments[0]?.filename).toBe('notes.txt')
    expect(attachments[1]?.filename).toBe('data.json')
  })
})
