import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FileReadEntry } from '@openfox/shared'

// ============================================================================
// Error Classes
// ============================================================================

export class FileNotReadError extends Error {
  constructor(path: string) {
    super(`File "${path}" must be read before writing. Use read_file first.`)
    this.name = 'FileNotReadError'
  }
}

export class FileChangedExternallyError extends Error {
  constructor(path: string) {
    super(`File "${path}" was modified externally and must be read before writing. Use read_file to see current contents.`)
    this.name = 'FileChangedExternallyError'
  }
}

// ============================================================================
// Hash Computation
// ============================================================================

/**
 * Compute SHA-256 hash of a file's content.
 * Returns null if the file doesn't exist.
 */
export async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath)
    const hash = createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean
  error?: FileNotReadError | FileChangedExternallyError
}

/**
 * Validate that a file can be written to.
 * 
 * Rules:
 * - New files (don't exist on disk) → allowed
 * - Existing files must be in readFiles map with matching hash
 * - If file changed externally (hash mismatch) → treated same as not read
 */
export async function validateFileForWrite(
  filePath: string,
  readFiles: Record<string, FileReadEntry>
): Promise<ValidationResult> {
  // Normalize path for consistent comparison
  const normalizedPath = resolve(filePath)
  
  // Check if file exists on disk
  const currentHash = await computeFileHash(normalizedPath)
  
  // New file - no read required
  if (currentHash === null) {
    return { valid: true }
  }
  
  // File exists - check if it was read
  const readEntry = readFiles[normalizedPath]
  
  if (!readEntry) {
    return {
      valid: false,
      error: new FileNotReadError(filePath),
    }
  }
  
  // Check if file changed since read
  if (readEntry.hash !== currentHash) {
    return {
      valid: false,
      error: new FileChangedExternallyError(filePath),
    }
  }
  
  return { valid: true }
}

// ============================================================================
// Helpers
// ============================================================================

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
