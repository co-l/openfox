import { TEXT_MIME_PREFIXES, TEXT_MIME_EXACT } from '@shared/constants.js'

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export function isPreviewableImage(mimeType: string): boolean {
  return mimeType.startsWith('image/') && mimeType !== 'image/svg+xml'
}

export function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_EXACT.includes(mimeType) || TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex >= filename.length - 1) return 'FILE'
  return filename.slice(dotIndex + 1).toUpperCase()
}

// Must stay in sync with TEXT_MIME_EXACT / TEXT_MIME_PREFIXES in src/shared/constants.ts
const MIME_TO_EXT: Record<string, string> = {
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/javascript': 'js',
  'text/xml': 'xml',
  'text/x-yaml': 'yaml',
  'text/x-sh': 'sh',
  'text/tab-separated-values': 'tsv',
  'text/x-python': 'py',
  'text/x-java-source': 'java',
  'text/x-json': 'json',
  'text/x-typescript': 'ts',
  'text/css': 'css',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'application/javascript': 'js',
  'application/xhtml+xml': 'xhtml',
  'application/x-sh': 'sh',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

export function mimeTypeToExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType] || mimeType.split('/')[1]?.split('+')[0] || 'file'
}

export function isSupportedMimeType(mimeType: string): boolean {
  return isImageMime(mimeType) || isTextMime(mimeType) || mimeType === 'application/pdf'
}
