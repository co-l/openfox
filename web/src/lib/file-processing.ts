import { compressImage } from './image-compression.js'
import { generateUUID } from './uuid.js'
import { isTextMime, isImageMime, formatFileSize } from './attachment-utils.js'
import type { Attachment } from '@shared/types.js'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_TEXT_SIZE = 1024 * 1024
const COMPRESSIBLE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif']

function isPdfType(mimeType: string): boolean {
  return mimeType === 'application/pdf'
}

function isCompressibleImage(file: File): boolean {
  return COMPRESSIBLE_IMAGE_TYPES.includes(file.type)
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function processFile(
  file: File,
  onAddAttachment: (attachment: Attachment) => void,
  onError: (error: string) => void,
): Promise<void> {
  try {
    if (isTextMime(file.type)) {
      if (file.size > MAX_TEXT_SIZE) {
        onError(`Text file too large (${formatFileSize(file.size)}). Maximum is ${formatFileSize(MAX_TEXT_SIZE)}.`)
        return
      }

      const content = await file.text()

      const attachment: Attachment = {
        id: generateUUID(),
        filename: file.name || 'unnamed-file',
        mimeType: file.type,
        size: file.size,
        data: content,
      }

      onAddAttachment(attachment)
    } else if (isImageMime(file.type)) {
      if (file.size > MAX_FILE_SIZE) {
        onError(`Image file too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`)
        return
      }

      if (isCompressibleImage(file)) {
        const compressed = await compressImage(file, {
          maxWidth: 1920,
          maxHeight: 1920,
          quality: 0.85,
          maxSizeBytes: 1048576,
        })

        const attachment: Attachment = {
          id: generateUUID(),
          filename: file.name || 'unnamed-file',
          mimeType: compressed.mimeType,
          size: compressed.size,
          data: compressed.dataUrl,
        }

        onAddAttachment(attachment)
      } else {
        const dataUrl = await readFileAsDataUrl(file)

        const attachment: Attachment = {
          id: generateUUID(),
          filename: file.name || 'unnamed-file',
          mimeType: file.type,
          size: file.size,
          data: dataUrl,
        }

        onAddAttachment(attachment)
      }
    } else if (isPdfType(file.type)) {
      if (file.size > MAX_FILE_SIZE) {
        onError(`PDF file too large (${formatFileSize(file.size)}). Maximum is ${formatFileSize(MAX_FILE_SIZE)}.`)
        return
      }

      const dataUrl = await readFileAsDataUrl(file)

      const attachment: Attachment = {
        id: generateUUID(),
        filename: file.name || 'unnamed-file',
        mimeType: file.type,
        size: file.size,
        data: dataUrl,
      }

      onAddAttachment(attachment)
    } else {
      onError(`Unsupported file type: ${file.type}. Supported types: images (PNG, JPG, GIF, WebP, BMP, SVG), PDF, text files, JSON, XML, YAML, and other common text-based formats.`)
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? (err.message ?? 'Failed to process file') : 'Failed to process file'
    onError(errorMsg)
  }
}
