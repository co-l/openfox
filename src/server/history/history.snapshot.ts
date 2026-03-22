import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { addToIndex } from './history.index.js'

// ============================================================================
// Types
// ============================================================================

export type ChangeType = 'create' | 'modify' | 'delete'

export interface SnapshotData {
  path: string              // Relative path to workdir
  timestamp: string         // ISO 8601
  changeType: ChangeType
  hashBefore: string | null // SHA-256 before change (null for creates)
  hashAfter: string | null  // SHA-256 after change (null for deletes)
  content: string | null    // Base64-encoded content (null for deletes)
  sessionId?: string        // Optional session ID if from agent
}

export interface SnapshotResult {
  success: boolean
  snapshotPath?: string
  snapshotData?: SnapshotData
  error?: string
}

// ============================================================================
// Snapshot Creation
// ============================================================================

/**
 * Create a snapshot of a file before modification.
 * Uses atomic write pattern: write to .tmp file, then rename.
 */
export async function createSnapshot(
  filePath: string,
  workdir: string,
  changeType: ChangeType,
  snapshotDir: string,
  sessionId?: string
): Promise<SnapshotResult> {
  try {
    const relativePath = relative(workdir, filePath)
    const timestamp = new Date().toISOString()
    
    // Read current content if file exists
    let content: Buffer | null = null
    let hashBefore: string | null = null
    
    if (changeType !== 'create') {
      try {
        content = await readFile(filePath)
        hashBefore = createHash('sha256').update(content).digest('hex')
      } catch (error) {
        if (changeType === 'delete') {
          // File doesn't exist but we're recording a delete - this shouldn't happen
          return {
            success: false,
            error: `Cannot snapshot deletion of non-existent file: ${filePath}`,
          }
        }
        // For modify on non-existent file, treat as create
        if (changeType === 'modify') {
          changeType = 'create'
          content = null
          hashBefore = null
        }
      }
    }
    
    // Calculate hash after and content
    let hashAfter: string | null = null
    let contentBase64: string | null = null
    
    if (changeType === 'delete') {
      // For deletes, content is what's being deleted
      hashAfter = null
      contentBase64 = content ? content.toString('base64') : null
    } else {
      // For creates and modifies, content is the new content
      if (content) {
        hashAfter = createHash('sha256').update(content).digest('hex')
        contentBase64 = content.toString('base64')
      } else {
        // New file - need to read it
        try {
          content = await readFile(filePath)
          hashAfter = createHash('sha256').update(content).digest('hex')
          contentBase64 = content.toString('base64')
        } catch (error) {
          return {
            success: false,
            error: `Cannot read file for snapshot: ${filePath}`,
          }
        }
      }
    }
    
    // Build snapshot data
    const snapshotData: SnapshotData = {
      path: relativePath,
      timestamp,
      changeType,
      hashBefore,
      hashAfter,
      content: contentBase64,
    }
    
    if (sessionId) {
      snapshotData.sessionId = sessionId
    }
    
    // Generate snapshot filename
    const date = new Date()
    const year = date.getFullYear().toString()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    
    const snapshotFilename = `${relativePath.replace(/[\\/]/g, '_')}_ts-${year}${month}${day}-${hours}${minutes}${seconds}.json`
    
    // Create directory structure
    const dirPath = join(snapshotDir, year, month, day)
    await mkdir(dirPath, { recursive: true })
    
    const snapshotPath = join(dirPath, snapshotFilename)
    const tmpPath = snapshotPath + '.tmp'
    
    // Write to temp file first (atomic write)
    await writeFile(tmpPath, JSON.stringify(snapshotData, null, 2))
    
    // Rename to final path (atomic on most filesystems)
    await rename(tmpPath, snapshotPath)
    
    // Update index
    await addToIndex(snapshotDir, snapshotData)
    
    return {
      success: true,
      snapshotPath,
      snapshotData,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute SHA-256 hash of file content
 */
export async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath)
    return createHash('sha256').update(content).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Read file content as base64
 */
export async function readFileAsBase64(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath)
    return content.toString('base64')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
