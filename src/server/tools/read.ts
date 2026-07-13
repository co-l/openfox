import { readFile, stat, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'
import { computeFileHash } from './file-tracker.js'
import { detectEncoding, decodeContent } from '../utils/encoding.js'
import { fileTypeFromBuffer } from 'file-type'

interface ReadFileArgs {
  path: string
  offset?: number
  limit?: number
}

/**
 * Detect if a buffer is an image using file-type library.
 * For SVG files, falls back to content-based detection since file-type
 * may identify them as generic XML.
 */
async function detectImageType(buffer: Buffer, filePath: string): Promise<string | null> {
  const fileType = await fileTypeFromBuffer(buffer)

  // Only accept known image MIME types
  const imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']

  if (fileType?.mime && imageMimeTypes.includes(fileType.mime)) {
    return fileType.mime
  }

  // For .svg files, check if content is actually SVG (not just XML)
  const ext = extname(filePath).toLowerCase()
  if (ext === '.svg' && buffer.length > 0) {
    const content = buffer.toString('utf-8')
    const trimmedStart = content.trimStart()
    if (trimmedStart.startsWith('<?xml') || trimmedStart.startsWith('<svg')) {
      return 'image/svg+xml'
    }
  }

  return null
}

/**
 * Format bytes into a human-readable string (B, KB, MB).
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * List directory contents in a scannable tree format.
 */
async function listDirectory(dirPath: string, relativePath: string): Promise<string> {
  const entries = await readdir(dirPath, { withFileTypes: true })

  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  const lines: string[] = [`${relativePath}/`]
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!
    const isLast = i === sorted.length - 1
    const prefix = isLast ? '└── ' : '├── '
    const suffix = entry.isDirectory() ? '/' : ''

    let sizeStr = ''
    if (!entry.isDirectory()) {
      try {
        const entryStat = await stat(join(dirPath, entry.name))
        sizeStr = `  ${formatSize(entryStat.size).padStart(7)}`
      } catch {
        /* ignore */
      }
    }

    lines.push(`${prefix}${entry.name}${suffix}${sizeStr}`)
  }

  return lines.join('\n')
}

export const readFileTool = createTool<ReadFileArgs>(
  'read_file',
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file or list directory contents. For text files: returns file content. For images (PNG, JPEG, GIF, WebP, BMP, SVG): returns base64-encoded data with MIME type metadata. For directories: returns a tree-formatted listing of entries with file sizes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file (relative to workdir or absolute)',
          },
          offset: {
            type: 'number',
            description: 'Line number to start from (1-indexed). Default: 1. Only applies to text files.',
          },
          limit: {
            type: 'number',
            description: `Maximum number of lines to read. Default: ${OUTPUT_LIMITS.read_file.maxLines}. Only applies to text files.`,
          },
        },
        required: ['path'],
      },
    },
  },
  async (args, context, helpers) => {
    const offset = args.offset ?? 1
    const limit = Math.min(args.limit ?? OUTPUT_LIMITS.read_file.maxLines, OUTPUT_LIMITS.read_file.maxLines)

    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])

    // Check if path exists
    try {
      const stats = await stat(fullPath)
      if (stats.isDirectory()) {
        const listing = await listDirectory(fullPath, args.path)
        return helpers.success(listing)
      }

      // Check image size limit before reading
      if (stats.size > OUTPUT_LIMITS.read_file.maxImageBytes) {
        return helpers.error(
          `File size (${stats.size} bytes) exceeds image size limit (2MB). Use shell command to process large files.`,
        )
      }
    } catch {
      return helpers.error(`File not found: ${args.path}`)
    }

    // Read file as binary first to detect type
    const rawBuffer = await readFile(fullPath)

    // Detect if this is an image file
    const mimeType = await detectImageType(rawBuffer, args.path)

    if (mimeType) {
      // Handle as image
      const base64Data = rawBuffer.toString('base64')
      const dataUrl = `data:${mimeType};base64,${base64Data}`

      // Record file read with content hash for write validation
      const contentHash = await computeFileHash(fullPath)
      if (contentHash) {
        context.sessionManager.recordFileRead(context.sessionId, fullPath, contentHash)
      }

      return helpers.success(`[Image: ${args.path} (${mimeType}, ${rawBuffer.length} bytes)]`, false, {
        metadata: {
          mimeType,
          size: rawBuffer.length,
          base64Data,
          dataUrl,
          path: fullPath,
        },
      })
    }

    // Handle as text file
    const { encoding, confidence } = detectEncoding(rawBuffer)
    const content = decodeContent(rawBuffer, encoding)
    const lines = content.split('\n')
    const totalLines = lines.length

    // Apply offset and limit
    const startLine = Math.max(1, offset)
    const endLine = Math.min(startLine + limit - 1, totalLines)
    const selectedLines = lines.slice(startLine - 1, endLine)

    // Join lines without prefix
    const formatted = selectedLines.join('\n')

    // Check if truncated
    const truncated = endLine < totalLines
    let output = formatted

    if (truncated) {
      output += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} total. Use offset to read more.]`
    }

    // Check byte limit
    if (output.length > OUTPUT_LIMITS.read_file.maxBytes) {
      output = output.slice(0, OUTPUT_LIMITS.read_file.maxBytes)
      output += '\n\n[Output truncated due to size limit]'
    }

    // Record file read with content hash for write validation
    const contentHash = await computeFileHash(fullPath)
    if (contentHash) {
      context.sessionManager.recordFileRead(context.sessionId, fullPath, contentHash)
    }

    return helpers.success(output, truncated, {
      metadata: {
        encoding,
        confidence: Math.round(confidence * 100) / 100,
        lineCount: totalLines,
        startLine,
        endLine,
        path: fullPath,
      },
    })
  },
)
