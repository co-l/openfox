import { readFile, existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import ignore from 'ignore'

const readFileAsync = promisify(readFile)

// ============================================================================
// Gitignore Handling
// ============================================================================

/**
 * Load .gitignore patterns from the workdir
 */
export async function loadGitignore(workdir: string): Promise<string[]> {
  const gitignorePath = join(workdir, '.gitignore')
  
  if (!existsSync(gitignorePath)) {
    return []
  }
  
  try {
    const content = await readFileAsync(gitignorePath, 'utf-8')
    return content.split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith('#'))
  } catch (error) {
    console.error('Error reading .gitignore:', error)
    return []
  }
}

/**
 * Simple pattern matching for gitignore-style patterns
 * Supports: *, **, ?, and basic patterns
 */
export function isPathExcluded(relativePath: string, patterns: string[]): boolean {
  const normalizedPath = normalizeHistoryPath(relativePath)

  if (!normalizedPath || patterns.length === 0) {
    return false
  }

  try {
    return ignore().add(patterns).ignores(normalizedPath)
  } catch (error) {
    console.error('Error matching ignore patterns:', error)
    return false
  }
}

function normalizeHistoryPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

// ============================================================================
// Binary File Detection
// ============================================================================

/**
 * Check if a file is binary by examining its content
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = await readFileAsync(filePath)
    
    // Check first 1024 bytes for null bytes (common in binary files)
    const sampleSize = Math.min(buffer.length, 1024)
    for (let i = 0; i < sampleSize; i++) {
      if (buffer[i] === 0) {
        return true
      }
    }
    
    return false
  } catch (error) {
    // If we can't read the file, assume it's not binary
    return false
  }
}

/**
 * Check if a file extension indicates a binary file
 */
export function isBinaryExtension(filename: string): boolean {
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.dat', '.db', '.sqlite', '.sqlite3',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.woff', '.woff2', '.ttf', '.eot',
    '.jar', '.war', '.ear', '.nupkg'
  ])
  
  const ext = filename.split('.').pop()?.toLowerCase()
  if (!ext) return false
  
  return binaryExtensions.has(`.${ext}`)
}
