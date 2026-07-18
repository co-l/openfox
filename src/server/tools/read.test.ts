/**
 * Unit tests for read_file tool with image support
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'node:path'
import { readFileTool } from './read.js'
import { processPdfContent } from './pdf-utils.js'
import type { ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'

function makeSimplePdf(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td (Hello World PDF test) Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n428\n%%EOF`,
    'latin1',
  )
}

function makeEmptyPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td () Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n426\n%%EOF`,
    'latin1',
  )
}

function makeMultiPagePdf(): Buffer {
  const t1 = 'Page 1 content',
    t2 = 'Page 2 content'
  const s1 = `BT /F1 12 Tf 100 700 Td (${t1}) Tj ET`,
    s2 = `BT /F1 12 Tf 100 600 Td (${t2}) Tj ET`
  const l1 = Buffer.byteLength(s1, 'latin1'),
    l2 = Buffer.byteLength(s2, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 3 0 R>>endobj\n2 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n3 0 obj<</Type/Pages/Kids[4 0 R 6 0 R]/Count 2>>endobj\n4 0 obj<</Type/Page/Parent 3 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 2 0 R>>>>/Contents 5 0 R>>endobj\n5 0 obj<</Length ${l1}>>stream\n${s1}\nendstream\n6 0 obj<</Type/Page/Parent 3 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 2 0 R>>>>/Contents 7 0 R>>endobj\n7 0 obj<</Length ${l2}>>stream\n${s2}\nendstream\nxref\n0 8\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000107 00000 n \n0000000177 00000 n \n0000000308 00000 n \n0000000367 00000 n \n0000000498 00000 n \ntrailer<</Size 8/Root 1 0 R>>\nstartxref\n558\n%%EOF`,
    'latin1',
  )
}

function makeEncryptedPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 2/Length 128/O<${'00'.repeat(16)}>/U<${'00'.repeat(16)}>/P 0>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \ntrailer<</Size 4/Root 1 0 R/Encrypt 3 0 R>>\nstartxref\n206\n%%EOF`,
    'latin1',
  )
}

function makePdfWithMetadata(title: string, author: string): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td (Hello World) Tj ET'
  const streamLen = Buffer.byteLength(stream, 'latin1')

  const obj1 = '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj'
  const obj2 = '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj'
  const obj3 =
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj'
  const obj4 = '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj'
  const obj5 = `5 0 obj<</Length ${streamLen}>>stream\n${stream}\nendstream`
  const obj6 = `6 0 obj<</Title(${title})/Author(${author})>>endobj`

  const header = '%PDF-1.4\n'
  const objects = [obj1, obj2, obj3, obj4, obj5, obj6]
  const body = objects.join('\n') + '\n'

  const offsets: number[] = [0]
  let pos = header.length
  for (const obj of objects) {
    offsets.push(pos)
    pos += Buffer.byteLength(obj, 'latin1') + 1
  }

  const xrefOffset = pos
  const xrefRows = offsets
    .map((off, i) => `${off.toString().padStart(10, '0')} ${i === 0 ? '65535 f' : '00000 n'}`)
    .join('\n')
  const xref = `xref\n0 7\n${xrefRows}\n`
  const trailer = 'trailer<</Size 7/Root 1 0 R/Info 6 0 R>>\n'
  const startxref = `startxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(header + body + xref + trailer + startxref, 'latin1')
}

function makeCorruptPdf(): Buffer {
  // References a non-existent Pages object (999), causing pdfjs to throw
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 999 0 R>>endobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer<</Size 2/Root 1 0 R>>\nstartxref\n20\n%%EOF',
    'latin1',
  )
}

// Mock fs/promises using vi.mock factory pattern
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
  }
})

// Mock file-tracker
vi.mock('./file-tracker.js', () => ({
  computeFileHash: vi.fn().mockResolvedValue('test-hash'),
}))

import { readFile, stat, readdir } from 'node:fs/promises'

// Mock sessionManager for test context
const mockSessionManager = {
  recordFileRead: vi.fn(),
  getReadFiles: vi.fn().mockReturnValue({}),
  updateFileHash: vi.fn(),
} as any

const mockContext: ToolContext = {
  sessionManager: mockSessionManager,
  workdir: '/test/workdir',
  sessionId: 'test-session',
}

describe('readFileTool - Image Support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('image detection and reading', () => {
    it('should detect and read a PNG image file', async () => {
      const mockPngBuffer = Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
      ])

      vi.mocked(readFile).mockResolvedValue(mockPngBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockPngBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.png' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toBe(`[Image: test.png (image/png, ${mockPngBuffer.length} bytes)]`)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['mimeType']).toBe('image/png')
      expect(result.metadata?.['size']).toBe(mockPngBuffer.length)
      expect(result.metadata?.['base64Data']).toBeDefined()
      expect(result.metadata?.['dataUrl']).toMatch(/^data:image\/png;base64,/)
      expect(result.metadata?.['path']).toBe(resolve('/test/workdir/test.png'))
    })

    it('should detect and read a JPEG image file', async () => {
      const mockJpegBuffer = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe0, // JPEG signature
        0x00,
        0x10,
        0x4a,
        0x46,
      ])

      vi.mocked(readFile).mockResolvedValue(mockJpegBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockJpegBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.jpg' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.metadata?.['mimeType']).toBe('image/jpeg')
      expect(result.metadata?.['base64Data']).toBeDefined()
    })

    it('should detect and read a GIF image file', async () => {
      const mockGifBuffer = Buffer.from([
        0x47,
        0x49,
        0x46,
        0x38,
        0x39,
        0x61, // GIF89a signature
      ])

      vi.mocked(readFile).mockResolvedValue(mockGifBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockGifBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.gif' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.metadata?.['mimeType']).toBe('image/gif')
    })

    it('should detect and read a WebP image file', async () => {
      const mockWebpBuffer = Buffer.from([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00,
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ])

      vi.mocked(readFile).mockResolvedValue(mockWebpBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockWebpBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.webp' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.metadata?.['mimeType']).toBe('image/webp')
    })

    it('should detect and read a BMP image file', async () => {
      const mockBmpBuffer = Buffer.from([
        0x42,
        0x4d, // BM signature
        0x00,
        0x00,
        0x00,
        0x00,
      ])

      vi.mocked(readFile).mockResolvedValue(mockBmpBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockBmpBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.bmp' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.metadata?.['mimeType']).toBe('image/bmp')
    })

    it('should detect and read an SVG image file', async () => {
      const mockSvgContent = '<?xml version="1.0"?><svg></svg>'
      const mockSvgBuffer = Buffer.from(mockSvgContent, 'utf-8')

      vi.mocked(readFile).mockResolvedValue(mockSvgBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockSvgBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.svg' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.metadata?.['mimeType']).toBe('image/svg+xml')
    })
  })

  describe('size limit enforcement', () => {
    it('should reject images larger than 2MB', async () => {
      const oversizedSize = OUTPUT_LIMITS.read_file.maxImageBytes + 1

      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: oversizedSize,
      } as any)

      const result = await readFileTool.execute({ path: 'large.png' }, mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('exceeds image size limit')
      expect(result.error).toContain('2MB')
    })
  })

  describe('text file compatibility', () => {
    it('should still read text files without line number prefix', async () => {
      const textContent = 'line 1\nline 2\nline 3\nline 4\nline 5'
      const textBuffer = Buffer.from(textContent, 'utf-8')

      vi.mocked(readFile).mockResolvedValue(textBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: textBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.ts', offset: 2, limit: 2 }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('line 2')
      expect(result.output).toContain('line 3')
      expect(result.output).not.toContain('1|line 1')
      expect(result.output).not.toMatch(/^\d+\|/) // No line number prefix
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['encoding']).toBe('utf-8')
      expect(result.metadata?.['path']).toBe(resolve('/test/workdir/test.ts'))
      expect(result.metadata?.['startLine']).toBe(2)
      expect(result.metadata?.['endLine']).toBe(3)
    })

    it('should handle text files with offset and limit parameters', async () => {
      const textContent = Array(100)
        .fill('')
        .map((_, i) => `line ${i + 1}`)
        .join('\n')
      const textBuffer = Buffer.from(textContent, 'utf-8')

      vi.mocked(readFile).mockResolvedValue(textBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: textBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.ts', offset: 10, limit: 5 }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('line 10')
      expect(result.output).toContain('line 14')
      expect(result.output).not.toMatch(/^\d+\|/) // No line number prefix
      expect(result.metadata?.['startLine']).toBe(10)
      expect(result.metadata?.['endLine']).toBe(14)
    })
  })

  describe('error handling', () => {
    it('should return error for non-existent file', async () => {
      vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

      const result = await readFileTool.execute({ path: 'nonexistent.png' }, mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('File not found')
    })

    it('should list directory contents', async () => {
      vi.mocked(stat).mockImplementation(async (path: unknown) => {
        const p = path as string
        if (p.endsWith('somedir')) {
          return { isDirectory: () => true } as any
        }
        return { isDirectory: () => false, size: 123 } as any
      })
      vi.mocked(readdir).mockResolvedValue([
        { name: 'subdir', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false } as any,
        { name: 'file.ts', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false } as any,
      ])

      const result = await readFileTool.execute({ path: 'somedir' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('somedir/')
      expect(result.output).toContain('├── subdir/')
      expect(result.output).toContain('└── file.ts')
      expect(result.output).toContain('123 B')
    })

    it('should return error for unsupported image format', async () => {
      // Unknown file type with no recognized signature
      const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00])

      vi.mocked(readFile).mockResolvedValue(unknownBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: unknownBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'unknown.xyz' }, mockContext)

      // Should fall back to text reading for unknown types
      expect(result.success).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['encoding']).toBeDefined()
    })
  })

  describe('base64 encoding', () => {
    it('should encode image data as valid base64', async () => {
      const mockPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ])

      vi.mocked(readFile).mockResolvedValue(mockPngBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockPngBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.png' }, mockContext)

      const base64Data = result.metadata?.['base64Data'] as string
      expect(base64Data).toBeDefined()

      // Verify it's valid base64 by decoding
      const decoded = Buffer.from(base64Data, 'base64')
      expect(decoded.equals(mockPngBuffer)).toBe(true)
    })
  })

  describe('readFileTool - PDF Support', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should extract text from a valid PDF', async () => {
      const pdfBuffer = makeSimplePdf()

      vi.mocked(readFile).mockResolvedValue(pdfBuffer as any)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: pdfBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.pdf' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('[Page 1/1]')
      expect(result.output).toContain('Hello World PDF test')
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['format']).toBe('pdf')
      expect(result.metadata?.['pageCount']).toBe(1)
      expect(result.metadata?.['path']).toBe(resolve('/test/workdir/test.pdf'))
    })

    it('should return scanned PDF message when no text layer', async () => {
      const pdfBuffer = makeEmptyPdf()

      vi.mocked(readFile).mockResolvedValue(pdfBuffer as any)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: pdfBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.pdf' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('has no text layer')
      expect(result.output).toContain('OCR')
      expect(result.metadata?.['format']).toBe('pdf')
      expect(result.metadata?.['pageCount']).toBe(1)
    })

    it('should return error for password-protected PDF', async () => {
      const pdfBuffer = makeEncryptedPdf()

      vi.mocked(readFile).mockResolvedValue(pdfBuffer as any)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: pdfBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.pdf' }, mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('password-protected')
    })

    it('should reject PDFs larger than 20MB', async () => {
      const oversizedSize = OUTPUT_LIMITS.read_file.maxFileBytes + 1

      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: oversizedSize,
      } as any)

      const result = await readFileTool.execute({ path: 'large.pdf' }, mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('exceeds maximum file size')
      expect(result.error).toContain('20MB')
    })

    it('should extract text from a multi-page PDF', async () => {
      const pdfBuffer = makeMultiPagePdf()

      vi.mocked(readFile).mockResolvedValue(pdfBuffer as any)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: pdfBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.pdf' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('[Page 1/2]')
      expect(result.output).toContain('[Page 2/2]')
      expect(result.output).toContain('Page 1 content')
      expect(result.output).toContain('Page 2 content')
      expect(result.metadata?.['pageCount']).toBe(2)
    })

    it('should extract PDF metadata (title and author)', async () => {
      const pdfBuffer = makePdfWithMetadata('Test Title', 'Test Author')

      vi.mocked(readFile).mockResolvedValue(pdfBuffer as any)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: pdfBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.pdf' }, mockContext)

      expect(result.success).toBe(true)
      expect(result.metadata?.['title']).toBe('Test Title')
      expect(result.metadata?.['author']).toBe('Test Author')
    })

    it('should truncate PDF text output exceeding maxBytes', () => {
      const largeText = 'x'.repeat(OUTPUT_LIMITS.read_file.maxBytes + 10_000)
      const result = processPdfContent(largeText, OUTPUT_LIMITS.read_file.maxBytes)

      expect(result.truncated).toBe(true)
      expect(result.output).toContain('[Output truncated due to size limit]')
      expect(result.output.length).toBeLessThanOrEqual(OUTPUT_LIMITS.read_file.maxBytes + 100)
    })

    it('should return error for corrupt PDF', async () => {
      const pdfBuffer = makeCorruptPdf()

      vi.mocked(readFile).mockResolvedValue(pdfBuffer as any)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: pdfBuffer.length,
      } as any)

      const result = await readFileTool.execute({ path: 'test.pdf' }, mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to read PDF')
    })
  })
})
