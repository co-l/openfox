import { readFile, writeFile, existsSync, readdirSync, rename } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SnapshotData } from './history.snapshot.js'
import { logger } from '../utils/logger.js'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)
const renameAsync = promisify(rename)

// ============================================================================
// File Lock for Index Operations
// ============================================================================

const indexLocks = new Map<string, Promise<any>>()

/**
 * Execute a function with a lock on the index file to prevent concurrent writes
 */
async function withIndexLock<T>(
  snapshotDir: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = snapshotDir
  
  // Wait for any existing operation on this index
  while (indexLocks.has(lockKey)) {
    await indexLocks.get(lockKey)
  }
  
  // Create new promise for this operation
  let resolveLock: () => void
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve
  })
  indexLocks.set(lockKey, lockPromise)
  
  try {
    return await fn()
  } finally {
    resolveLock!()
    indexLocks.delete(lockKey)
  }
}

// ============================================================================
// Types
// ============================================================================

export interface IndexEntry {
  path: string
  timestamp: string
  changeType: string
  hashBefore: string | null
  hashAfter: string | null
}

// ============================================================================
// Index File Operations
// ============================================================================

/**
 * Get the index file path
 */
export function getIndexPath(snapshotDir: string): string {
  return join(snapshotDir, 'index.json')
}

/**
 * Load index file
 */
export async function loadIndex(snapshotDir: string): Promise<IndexEntry[]> {
  const indexPath = getIndexPath(snapshotDir)
  
  if (!existsSync(indexPath)) {
    return []
  }
  
  try {
    const content = await readFileAsync(indexPath, 'utf-8')
    const parsed = JSON.parse(content) as IndexEntry[]
    // Validate that it's an array
    if (!Array.isArray(parsed)) {
      logger.warn('History index file is not an array, resetting to empty')
      return []
    }
    return parsed
  } catch (error) {
    logger.error('Error loading history index', { error: error instanceof Error ? error.message : String(error) })
    // If JSON is corrupted, return empty array to allow recovery
    return []
  }
}

/**
 * Save index file with atomic write and locking
 */
export async function saveIndex(snapshotDir: string, entries: IndexEntry[]): Promise<void> {
  const indexPath = getIndexPath(snapshotDir)
  
  // Create directory if it doesn't exist
  const { ensureDirectory } = await import('./history.snapshot.js')
  await ensureDirectory(snapshotDir)
  
  // Use lock to prevent concurrent writes
  return withIndexLock(snapshotDir, async () => {
    // Write to temp file first, then rename for atomic operation
    const tmpPath = indexPath + '.tmp'
    await writeFileAsync(tmpPath, JSON.stringify(entries, null, 2))
    
    // Atomic rename
    await renameAsync(tmpPath, indexPath)
  })
}

/**
 * Add entry to index
 */
export async function addToIndex(
  snapshotDir: string,
  snapshot: SnapshotData,
  maxEntries: number = 1000
): Promise<void> {
  const entries = await loadIndex(snapshotDir)
  
  // Add new entry at the beginning
  const newEntry: IndexEntry = {
    path: snapshot.path,
    timestamp: snapshot.timestamp,
    changeType: snapshot.changeType,
    hashBefore: snapshot.hashBefore,
    hashAfter: snapshot.hashAfter,
  }
  
  entries.unshift(newEntry)
  
  // Trim to max entries
  if (entries.length > maxEntries) {
    entries.splice(maxEntries)
  }
  
  await saveIndex(snapshotDir, entries)
}

/**
 * Remove entries older than a date from index
 */
export async function cleanupOldIndexEntries(
  snapshotDir: string,
  cutoffDate: Date
): Promise<void> {
  const entries = await loadIndex(snapshotDir)
  
  const filtered = entries.filter(entry => {
    const entryDate = new Date(entry.timestamp)
    return entryDate >= cutoffDate
  })
  
  await saveIndex(snapshotDir, filtered)
}

/**
 * Get all snapshot files from the directory structure
 */
export async function getAllSnapshotFiles(snapshotDir: string): Promise<string[]> {
  const files: string[] = []
  
  // Check if directory exists first
  const { existsSync } = await import('node:fs')
  if (!existsSync(snapshotDir)) {
    return []
  }
  
  function scanDirectory(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        
        if (entry.isDirectory() && entry.name !== 'index.json') {
          scanDirectory(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.tmp.json')) {
          files.push(fullPath)
        }
      }
    } catch (error) {
      logger.error('Error scanning history directory', { error: error instanceof Error ? error.message : String(error) })
    }
  }
  
  scanDirectory(snapshotDir)
  return files
}

/**
 * Load snapshot data from a file
 */
export async function loadSnapshot(filePath: string): Promise<SnapshotData | null> {
  try {
    const content = await readFileAsync(filePath, 'utf-8')
    return JSON.parse(content) as SnapshotData
  } catch (error) {
    logger.error('Error loading snapshot', { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}
