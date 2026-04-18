import { compressImage, isValidImageType, validateImageSize } from './image-compression.js'
import { generateUUID } from './uuid.js'
import type { Attachment } from '@shared/types.js'

export interface ImageProcessingOptions {
  maxSizeBytes?: number
  filename?: string
}

export async function processImageFile(
  file: File,
  onAddAttachment: (attachment: Attachment) => void,
  onError: (error: string) => void,
  options: ImageProcessingOptions = {},
): Promise<void> {
  const { maxSizeBytes = 50 * 1024 * 1024, filename } = options

  if (!isValidImageType(file)) {
    onError(`Unsupported file type: ${file.type}. Only PNG, JPG, and GIF are supported.`)
    return
  }

  const sizeValidation = validateImageSize(file, maxSizeBytes)
  if (!sizeValidation.valid) {
    onError(sizeValidation.error ?? 'Image file is too large')
    return
  }

  try {
    const compressed = await compressImage(file, {
      maxWidth: 1920,
      maxHeight: 1920,
      quality: 0.85,
      maxSizeBytes: 1048576,
    })

    const attachment: Attachment = {
      id: generateUUID(),
      filename: filename ?? file.name,
      mimeType: compressed.mimeType as 'image/png' | 'image/jpeg' | 'image/gif',
      size: compressed.size,
      data: compressed.dataUrl,
    }

    onAddAttachment(attachment)
  } catch (err) {
    const errorMsg = err instanceof Error ? (err.message ?? 'Failed to process image') : 'Failed to process image'
    onError(errorMsg)
  }
}