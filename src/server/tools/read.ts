import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'
import { computeFileHash } from './file-tracker.js'

interface ReadFileArgs {
  path: string
  offset?: number
  limit?: number
}

// Image file extensions and their MIME types
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

// Magic byte signatures for image formats
const IMAGE_SIGNATURES: Array<{ mimeType: string; signature: Buffer; extension: string }> = [
  { mimeType: 'image/png', signature: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), extension: '.png' },
  { mimeType: 'image/jpeg', signature: Buffer.from([0xFF, 0xD8, 0xFF]), extension: '.jpg' },
  { mimeType: 'image/gif', signature: Buffer.from([0x47, 0x49, 0x46, 0x38]), extension: '.gif' },
  { mimeType: 'image/webp', signature: Buffer.from([]), extension: '.webp' }, // WebP handled specially
  { mimeType: 'image/bmp', signature: Buffer.from([0x42, 0x4D]), extension: '.bmp' },
]

/**
 * Detect if a buffer is an image by checking magic byte signatures.
 * Falls back to extension-based detection if no signature matches.
 */
function detectImageType(buffer: Buffer, filePath: string): string | null {
  // First try magic byte detection
  for (const { mimeType, signature } of IMAGE_SIGNATURES) {
    if (mimeType === 'image/webp') {
      // WebP signature check (bytes 0-3 = RIFF, 8-11 = WEBP)
      if (buffer.length >= 12 &&
          buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return mimeType
      }
    } else if (buffer.length >= signature.length) {
      let matches = true
      for (let i = 0; i < signature.length; i++) {
        if (buffer[i] !== signature[i]) {
          matches = false
          break
        }
      }
      if (matches) {
        return mimeType
      }
    }
  }
  
  // Fall back to extension-based detection
  const ext = extname(filePath).toLowerCase()
  const mimeType = IMAGE_MIME_TYPES[ext]
  if (mimeType) {
    return mimeType
  }
  
  // Check for SVG text content
  if (buffer.length > 0) {
    const textStart = buffer.subarray(0, Math.min(100, buffer.length)).toString('utf-8')
    if (textStart.includes('<svg')) {
      return 'image/svg+xml'
    }
  }
  
  return null
}

export const readFileTool = createTool<ReadFileArgs>(
  'read_file',
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. For text files: returns line-numbered content. For images (PNG, JPEG, GIF, WebP, BMP, SVG): returns base64-encoded data with MIME type metadata.',
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
    const startTime = Date.now()
    const offset = args.offset ?? 1
    const limit = Math.min(
      args.limit ?? OUTPUT_LIMITS.read_file.maxLines,
      OUTPUT_LIMITS.read_file.maxLines
    )
    
    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])
    
    // Check if file exists and is not a directory
    try {
      const stats = await stat(fullPath)
      if (stats.isDirectory()) {
        return helpers.error(`Path is a directory, not a file: ${args.path}`)
      }
      
      // Check image size limit before reading
      if (stats.size > OUTPUT_LIMITS.read_file.maxImageBytes) {
        return helpers.error(`File size (${stats.size} bytes) exceeds image size limit (2MB). Use shell command to process large files.`)
      }
    } catch {
      return helpers.error(`File not found: ${args.path}`)
    }
    
    // Read file as binary first to detect type
    const rawBuffer = await readFile(fullPath)
    
    // Detect if this is an image file
    const mimeType = detectImageType(rawBuffer, args.path)
    
    if (mimeType) {
      // Handle as image
      const base64Data = rawBuffer.toString('base64')
      
      // Record file read with content hash for write validation
      const contentHash = await computeFileHash(fullPath)
      if (contentHash) {
        context.sessionManager.recordFileRead(context.sessionId, fullPath, contentHash)
      }
      
      return {
        success: true,
        durationMs: Date.now() - startTime,
        truncated: false,
        metadata: {
          mimeType,
          size: rawBuffer.length,
          base64Data,
          path: fullPath,
        },
      }
    }
    
    // Handle as text file
    const content = rawBuffer.toString('utf-8')
    const lines = content.split('\n')
    const totalLines = lines.length
    
    // Apply offset and limit
    const startLine = Math.max(1, offset)
    const endLine = Math.min(startLine + limit - 1, totalLines)
    const selectedLines = lines.slice(startLine - 1, endLine)
    
    // Format with line numbers
    const formatted = selectedLines
      .map((line, i) => `${startLine + i}: ${line}`)
      .join('\n')
    
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
    
    return helpers.success(output, truncated)
  }
)
