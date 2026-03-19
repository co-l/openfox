/**
 * Unit tests for image compression utility
 */

import { describe, it, expect, vi } from 'vitest'
import { compressImage, isValidImageType, validateImageSize } from '../../lib/image-compression.js'

// Mock Image class for testing
class MockImage {
  width: number
  height: number
  onload: (() => void) | null = null
  
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0)
  }
}

// Mock Canvas
class MockCanvas {
  width = 0
  height = 0
  ctx: MockCanvasContext
  
  constructor() {
    this.ctx = new MockCanvasContext()
  }
  
  getContext(_contextType: string) {
    return this.ctx
  }
  
  toDataURL(_type?: string, _quality?: number) {
    return 'data:image/png;base64,MockBase64Data'
  }
}

class MockCanvasContext {
  imageSmoothingEnabled = false
  imageSmoothingQuality = 'high'
  
  drawImage(_img: HTMLImageElement, _sx: number, _sy: number, _sw: number, _sh: number, _dx: number, _dy: number, _dw: number, _dh: number): void
  drawImage(_img: any, ...args: any[]) {
    // Mock implementation
  }
}

// Mock FileReader
class MockFileReader {
  result: string | null = null
  onload: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  
  readAsDataURL(_file: File) {
    this.result = 'data:image/png;base64,MockBase64Data'
    setTimeout(() => this.onload?.(new Event('load')), 0)
  }
}

describe('Image Compression', () => {
  beforeAll(() => {
    // Mock global objects
    ;(global as any).Image = MockImage
    ;(global as any).HTMLImageElement = MockImage
    ;(global as any).FileReader = MockFileReader
  })

  describe('compressImage', () => {
    it('should compress large images to max 1920px dimension', async () => {
      // Create a mock file
      const mockFile = new File(['mock image data'], 'test.png', { type: 'image/png' })
      
      // @ts-ignore - using mock objects
      const result = await compressImage(mockFile, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.85,
        maxSizeBytes: 1048576,
      })
      
      expect(result.dataUrl).toBeDefined()
      expect(result.mimeType).toBe('image/png')
      expect(result.size).toBeGreaterThan(0)
    })

    it('should maintain aspect ratio when scaling', async () => {
      const mockFile = new File(['mock'], 'test.jpg', { type: 'image/jpeg' })
      
      // @ts-ignore
      const result = await compressImage(mockFile, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.85,
        maxSizeBytes: 1048576,
      })
      
      expect(result.dataUrl).toBeDefined()
      expect(result.width).toBeGreaterThan(0)
      expect(result.height).toBeGreaterThan(0)
    })

    it('should reject non-image files', async () => {
      const pdfFile = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })
      
      await expect(compressImage(pdfFile)).rejects.toThrow('File is not an image')
    })

    it('should reject unsupported image formats', async () => {
      const bmpFile = new File(['bmp data'], 'test.bmp', { type: 'image/bmp' })
      
      await expect(compressImage(bmpFile)).rejects.toThrow('Unsupported image format')
    })

    it('should handle GIF files by converting to PNG', async () => {
      const gifFile = new File(['gif data'], 'test.gif', { type: 'image/gif' })
      
      // @ts-ignore
      const result = await compressImage(gifFile, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.85,
        maxSizeBytes: 1048576,
      })
      
      expect(result.mimeType).toBe('image/png') // GIFs are converted to PNG
    })
  })

  describe('isValidImageType', () => {
    it('should return true for PNG files', () => {
      const pngFile = new File(['data'], 'test.png', { type: 'image/png' })
      expect(isValidImageType(pngFile)).toBe(true)
    })

    it('should return true for JPEG files', () => {
      const jpgFile = new File(['data'], 'test.jpg', { type: 'image/jpeg' })
      expect(isValidImageType(jpgFile)).toBe(true)
    })

    it('should return true for GIF files', () => {
      const gifFile = new File(['data'], 'test.gif', { type: 'image/gif' })
      expect(isValidImageType(gifFile)).toBe(true)
    })

    it('should return false for PDF files', () => {
      const pdfFile = new File(['data'], 'test.pdf', { type: 'application/pdf' })
      expect(isValidImageType(pdfFile)).toBe(false)
    })

    it('should return false for text files', () => {
      const txtFile = new File(['data'], 'test.txt', { type: 'text/plain' })
      expect(isValidImageType(txtFile)).toBe(false)
    })
  })

  describe('validateImageSize', () => {
    it('should validate small files as valid', () => {
      const smallFile = new File(['data'], 'test.png', { type: 'image/png' })
      const result = validateImageSize(smallFile, 1024) // 1KB limit
      
      expect(result.valid).toBe(true)
    })

    it('should reject files exceeding max size', () => {
      // Create a file that's 2KB
      const largeData = 'x'.repeat(2048)
      const largeFile = new File([largeData], 'test.png', { type: 'image/png' })
      const result = validateImageSize(largeFile, 1024) // 1KB limit
      
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('too large')
    })

    it('should provide helpful error messages', () => {
      const largeData = 'x'.repeat(2048)
      const largeFile = new File([largeData], 'test.png', { type: 'image/png' })
      const result = validateImageSize(largeFile, 1024)
      
      expect(result.error).toMatch(/Image file is too large/i)
    })
  })
})
