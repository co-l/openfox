import { readFile, writeFile, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SnapshotData } from './history.snapshot.js'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)

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
    return JSON.parse(content) as IndexEntry[]
  } catch (error) {
    console.error('Error loading index:', error)
    return []
  }
}

/**
 * Save index file
 */
export async function saveIndex(snapshotDir: string, entries: IndexEntry[]): Promise<void> {
  const indexPath = getIndexPath(snapshotDir)
  
  // Create directory if it doesn't exist
  await writeFileAsync(indexPath, JSON.stringify(entries, null, 2))
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
      console.error('Error scanning directory:', error)
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
    console.error('Error loading snapshot:', error)
    return null
  }
}
