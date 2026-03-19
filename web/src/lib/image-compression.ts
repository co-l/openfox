/**
 * Image compression utility for client-side image processing.
 * Compresses images to max 1920px dimension with target ~1MB file size.
 */

export interface CompressionResult {
  dataUrl: string
  mimeType: string
  size: number
  width: number
  height: number
}

export interface CompressionOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  maxSizeBytes?: number
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.85,
  maxSizeBytes: 1048576, // 1MB
}

interface ImageLike {
  width: number
  height: number
}

interface CanvasContextLike {
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: 'low' | 'medium' | 'high'
  drawImage: (image: ImageLike, dx: number, dy: number, dw: number, dh: number) => void
}

interface CanvasLike {
  width: number
  height: number
  getContext: (contextType: string) => CanvasContextLike | null
  toDataURL: (type?: string, quality?: number) => string
}

interface BrowserImage extends ImageLike {
  onload: null | (() => void)
  onerror: null | (() => void)
  src: string
}

interface BrowserFileReader {
  result: string | ArrayBuffer | null
  onload: null | (() => void)
  onerror: null | (() => void)
  readAsDataURL: (file: File) => void
}

interface BrowserGlobals {
  document?: {
    createElement: (tagName: string) => unknown
  }
  Image?: new () => BrowserImage
  FileReader?: new () => BrowserFileReader
}

/**
 * Compress an image file to meet size and dimension constraints.
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('File is not an image')
  }

  // Check supported formats
  const supportedTypes = ['image/png', 'image/jpeg', 'image/gif']
  if (!supportedTypes.includes(file.type)) {
    throw new Error(`Unsupported image format: ${file.type}. Only PNG, JPG, and GIF are supported.`)
  }

  // Check if file is already within size limits
  if (file.size <= opts.maxSizeBytes) {
    const arrayBuffer = await file.arrayBuffer()
    const base64 = arrayBufferToBase64(arrayBuffer)
    const dataUrl = `data:${file.type};base64,${base64}`
    
    // Get dimensions
    const img = await loadImage(dataUrl)
    
    return {
      dataUrl,
      mimeType: file.type,
      size: file.size,
      width: img.width,
      height: img.height,
    }
  }

  // Compress the image
  return await compressToTarget(file, opts)
}

/**
 * Compress image to target size by adjusting quality and dimensions.
 */
async function compressToTarget(
  file: File,
  opts: Required<CompressionOptions>
): Promise<CompressionResult> {
  const dataUrl = await fileToDataUrl(file)
  const img = await loadImage(dataUrl)
  
  // Calculate scaled dimensions
  const { width, height } = calculateScaledDimensions(img.width, img.height, opts.maxWidth, opts.maxHeight)
  
  // Create canvas and draw resized image
  const canvas = createCanvas()
  canvas.width = width
  canvas.height = height
  
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }
  
  // Handle image smoothing for better quality
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  
  ctx.drawImage(img, 0, 0, width, height)
  
  // Compress with quality adjustment
  let quality = opts.quality
  let compressedDataUrl: string
  
  // Try to compress to target size
  do {
    compressedDataUrl = canvas.toDataURL(file.type.startsWith('image/gif') ? 'image/png' : file.type, quality)
    const size = dataUrlToSize(compressedDataUrl)
    
    if (size <= opts.maxSizeBytes || quality <= 0.3) {
      break
    }
    
    quality -= 0.1
  } while (true)
  
  const finalSize = dataUrlToSize(compressedDataUrl)
  
  return {
    dataUrl: compressedDataUrl,
    mimeType: file.type.startsWith('image/gif') ? 'image/png' : file.type,
    size: finalSize,
    width,
    height,
  }
}

/**
 * Calculate scaled dimensions while maintaining aspect ratio.
 */
function calculateScaledDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const ratio = width / height
  
  if (width > height && width > maxWidth) {
    return {
      width: maxWidth,
      height: Math.round(maxWidth / ratio),
    }
  }
  
  if (height > width && height > maxHeight) {
    return {
      width: Math.round(maxHeight * ratio),
      height: maxHeight,
    }
  }
  
  return { width, height }
}

/**
 * Convert File to Data URL.
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const FileReaderConstructor = getFileReaderConstructor()
    const reader = new FileReaderConstructor()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Load image from Data URL.
 */
function loadImage(dataUrl: string): Promise<ImageLike> {
  return new Promise((resolve, reject) => {
    const ImageConstructor = getImageConstructor()
    const img = new ImageConstructor()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

function createCanvas(): CanvasLike {
  const browserGlobals = getBrowserGlobals()
  if (!browserGlobals.document?.createElement) {
    throw new Error('Image compression requires browser canvas APIs')
  }

  return browserGlobals.document.createElement('canvas') as CanvasLike
}

function getImageConstructor(): new () => BrowserImage {
  const browserGlobals = getBrowserGlobals()
  if (!browserGlobals.Image) {
    throw new Error('Image compression requires browser image APIs')
  }

  return browserGlobals.Image
}

function getFileReaderConstructor(): new () => BrowserFileReader {
  const browserGlobals = getBrowserGlobals()
  if (!browserGlobals.FileReader) {
    throw new Error('Image compression requires browser file APIs')
  }

  return browserGlobals.FileReader
}

function getBrowserGlobals(): BrowserGlobals {
  return globalThis as BrowserGlobals
}

/**
 * Convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    const code = bytes[i]
    if (code !== undefined) {
      binary += String.fromCharCode(code)
    }
  }
  return btoa(binary)
}

/**
 * Calculate approximate size of a Data URL in bytes.
 */
function dataUrlToSize(dataUrl: string): number {
  const parts = dataUrl.split(',')
  const base64 = parts[1]
  if (!base64) return 0
  return Math.round((base64.length * 3) / 4)
}

/**
 * Validate if a file is an supported image type.
 */
export function isValidImageType(file: File): boolean {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/gif']
  return supportedTypes.includes(file.type)
}

/**
 * Validate image file size.
 */
export function validateImageSize(file: File, maxSizeBytes: number = 50 * 1024 * 1024): { valid: boolean; error?: string } {
  if (file.size > maxSizeBytes) {
    return { 
      valid: false, 
      error: `Image file is too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(maxSizeBytes)}.` 
    }
  }
  return { valid: true }
}

/**
 * Format bytes to human-readable string.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
