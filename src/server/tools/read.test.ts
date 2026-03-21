/**
 * Unit tests for read_file tool with image support
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileTool } from './read.js'
import type { ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'

// Mock fs/promises using vi.mock factory pattern
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
  }
})

// Mock file-tracker
vi.mock('./file-tracker.js', () => ({
  computeFileHash: vi.fn().mockResolvedValue('test-hash'),
}))

import { readFile, stat } from 'node:fs/promises'

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
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      ])
      
      vi.mocked(readFile).mockResolvedValue(mockPngBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockPngBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.png' },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output).toBeUndefined() // Images don't use output field
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['mimeType']).toBe('image/png')
      expect(result.metadata?.['size']).toBe(mockPngBuffer.length)
      expect(result.metadata?.['base64Data']).toBeDefined()
      expect(result.metadata?.['path']).toBe('/test/workdir/test.png')
    })

    it('should detect and read a JPEG image file', async () => {
      const mockJpegBuffer = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, // JPEG signature
        0x00, 0x10, 0x4A, 0x46,
      ])
      
      vi.mocked(readFile).mockResolvedValue(mockJpegBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockJpegBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.jpg' },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.metadata?.['mimeType']).toBe('image/jpeg')
      expect(result.metadata?.['base64Data']).toBeDefined()
    })

    it('should detect and read a GIF image file', async () => {
      const mockGifBuffer = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a signature
      ])
      
      vi.mocked(readFile).mockResolvedValue(mockGifBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockGifBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.gif' },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.metadata?.mimeType).toBe('image/gif')
    })

    it('should detect and read a WebP image file', async () => {
      const mockWebpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50, // WEBP
      ])
      
      vi.mocked(readFile).mockResolvedValue(mockWebpBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockWebpBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.webp' },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.metadata?.mimeType).toBe('image/webp')
    })

    it('should detect and read a BMP image file', async () => {
      const mockBmpBuffer = Buffer.from([
        0x42, 0x4D, // BM signature
        0x00, 0x00, 0x00, 0x00,
      ])
      
      vi.mocked(readFile).mockResolvedValue(mockBmpBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockBmpBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.bmp' },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.metadata?.mimeType).toBe('image/bmp')
    })

    it('should detect and read an SVG image file', async () => {
      const mockSvgContent = '<?xml version="1.0"?><svg></svg>'
      const mockSvgBuffer = Buffer.from(mockSvgContent, 'utf-8')
      
      vi.mocked(readFile).mockResolvedValue(mockSvgBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockSvgBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.svg' },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.metadata?.mimeType).toBe('image/svg+xml')
    })
  })

  describe('size limit enforcement', () => {
    it('should reject images larger than 2MB', async () => {
      const oversizedSize = OUTPUT_LIMITS.read_file.maxImageBytes + 1
      
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: oversizedSize,
      } as any)

      const result = await readFileTool.execute(
        { path: 'large.png' },
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('exceeds image size limit')
      expect(result.error).toContain('2MB')
    })
  })

  describe('text file compatibility', () => {
    it('should still read text files with line numbers', async () => {
      const textContent = 'line 1\nline 2\nline 3\nline 4\nline 5'
      const textBuffer = Buffer.from(textContent, 'utf-8')
      
      vi.mocked(readFile).mockResolvedValue(textBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: textBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.ts', offset: 2, limit: 2 },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output).toContain('2: line 2')
      expect(result.output).toContain('3: line 3')
      expect(result.output).not.toContain('1: line 1')
      expect(result.metadata).toBeUndefined() // Text files don't have metadata
    })

    it('should handle text files with offset and limit parameters', async () => {
      const textContent = Array(100).fill('').map((_, i) => `line ${i + 1}`).join('\n')
      const textBuffer = Buffer.from(textContent, 'utf-8')
      
      vi.mocked(readFile).mockResolvedValue(textBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: textBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.ts', offset: 10, limit: 5 },
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output).toContain('10: line 10')
      expect(result.output).toContain('14: line 14')
    })
  })

  describe('error handling', () => {
    it('should return error for non-existent file', async () => {
      vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

      const result = await readFileTool.execute(
        { path: 'nonexistent.png' },
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('File not found')
    })

    it('should return error for directory', async () => {
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => true,
      } as any)

      const result = await readFileTool.execute(
        { path: 'somedir' },
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('directory')
    })

    it('should return error for unsupported image format', async () => {
      // Unknown file type with no recognized signature
      const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00])
      
      vi.mocked(readFile).mockResolvedValue(unknownBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: unknownBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'unknown.xyz' },
        mockContext
      )

      // Should fall back to text reading for unknown types
      expect(result.success).toBe(true)
      expect(result.metadata).toBeUndefined()
    })
  })

  describe('base64 encoding', () => {
    it('should encode image data as valid base64', async () => {
      const mockPngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      ])
      
      vi.mocked(readFile).mockResolvedValue(mockPngBuffer)
      vi.mocked(stat).mockResolvedValue({
        isDirectory: () => false,
        size: mockPngBuffer.length,
      } as any)

      const result = await readFileTool.execute(
        { path: 'test.png' },
        mockContext
      )

      const base64Data = result.metadata?.base64Data as string
      expect(base64Data).toBeDefined()
      
      // Verify it's valid base64 by decoding
      const decoded = Buffer.from(base64Data, 'base64')
      expect(decoded.equals(mockPngBuffer)).toBe(true)
    })
  })
})
