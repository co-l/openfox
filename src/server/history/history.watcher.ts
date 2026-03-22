import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, relative, extname } from 'node:path'
import { createSnapshot, type ChangeType } from './history.snapshot.js'
import { loadGitignore, isPathExcluded } from './history.utils.js'

// ============================================================================
// Types
// ============================================================================

export interface WatcherConfig {
  debounceMs: number
  excludePatterns: string[]
}

export interface SnapshotEvent {
  path: string
  changeType: ChangeType
  timestamp: string
  hashBefore: string | null
  hashAfter: string | null
}

// ============================================================================
// Default Exclusions
// ============================================================================

/**
 * Built-in patterns that are always excluded from history watching.
 * These are hardcoded to prevent watching OpenFox's own internal directories.
 */
const BUILTIN_EXCLUDE_PATTERNS = [
  '.openfox/**',
]

// ============================================================================
// File Watcher
// ============================================================================

/**
 * File watcher that monitors filesystem changes and creates snapshots.
 * Completely decoupled from agent tools - watches all changes regardless of source.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private config: WatcherConfig
  private gitignorePatterns: string[] = []
  
  onSnapshot: ((event: SnapshotEvent) => void) | null = null

  constructor(
    private workdir: string,
    private snapshotDir: string,
    private additionalExcludePatterns: string[] = [],
    private debounceMs: number = 500
  ) {
    // Combine builtin exclusions with additional patterns
    const allExcludePatterns = [...BUILTIN_EXCLUDE_PATTERNS, ...additionalExcludePatterns]
    
    this.config = {
      debounceMs,
      excludePatterns: allExcludePatterns,
    }
  }

  /**
   * Start watching the workdir for changes
   */
  start(): void {
    // Load .gitignore patterns
    loadGitignore(this.workdir).then((patterns: string[]) => {
      this.gitignorePatterns = patterns
    }).catch((err: Error) => {
      console.error('Error loading .gitignore:', err)
      this.gitignorePatterns = []
    })
    
    this.watcher = watch(this.workdir, { recursive: true }, async (eventType, filename) => {
      if (!filename) return
      
      // Normalize path - filename from fs.watch is already relative to workdir
      const relativePath = filename.startsWith('/') || filename.startsWith('\\') 
        ? relative(this.workdir, filename)
        : filename
      
      // Normalize path separators to forward slashes
      const normalizedPath = relativePath.replace(/\\/g, '/')
      
      const filePath = join(this.workdir, normalizedPath)
      
      // Check if path should be excluded
      if (this.shouldExclude(normalizedPath)) {
        return
      }
      
      // Skip binary files
      if (this.isBinaryFile(filename)) {
        return
      }
      
      // Determine change type by checking file existence
      let changeType: ChangeType = 'modify'
      
      try {
        const stats = await stat(filePath)
        if (stats.isFile()) {
          // File exists - check if it's a new file (created in this debounce window)
          const mtime = stats.mtimeMs
          const now = Date.now()
          
          // If file was created very recently (within debounce window), treat as create
          if (now - mtime < this.config.debounceMs + 100) {
            changeType = 'create'
          } else {
            changeType = eventType === 'change' ? 'modify' : 'modify'
          }
        }
      } catch (error) {
        // File doesn't exist - it was deleted
        changeType = 'delete'
      }
      
      // Debounce: clear existing timer for this file
      const existingTimer = this.debounceTimers.get(filePath)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      
      // Create new timer
      const timer = setTimeout(async () => {
        this.debounceTimers.delete(filePath)
        await this.createSnapshot(filePath, relativePath, changeType)
      }, this.config.debounceMs)
      
      this.debounceTimers.set(filePath, timer)
    })
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  /**
   * Check if a path should be excluded
   */
  private shouldExclude(relativePath: string): boolean {
    // Check .gitignore patterns
    if (isPathExcluded(relativePath, this.gitignorePatterns)) {
      return true
    }
    
    // Check additional exclude patterns
    if (isPathExcluded(relativePath, this.config.excludePatterns)) {
      return true
    }
    
    return false
  }

  /**
   * Check if a file is binary
   */
  private isBinaryFile(filename: string): boolean {
    const binaryExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.tar', '.gz', '.rar', '.7z',
      '.exe', '.dll', '.so', '.dylib',
      '.bin', '.dat', '.db', '.sqlite', '.sqlite3'
    ]
    
    const ext = extname(filename).toLowerCase()
    if (binaryExtensions.includes(ext)) {
      return true
    }
    
    // Check for null bytes in first 1024 bytes (basic binary detection)
    // This is done lazily when creating snapshot
    return false
  }

  /**
   * Create a snapshot for a file change
   */
  private async createSnapshot(
    filePath: string,
    relativePath: string,
    changeType: ChangeType
  ): Promise<void> {
    try {
      const result = await createSnapshot(
        filePath,
        this.workdir,
        changeType,
        this.snapshotDir
      )
      
      if (result.success && result.snapshotData) {
        const event: SnapshotEvent = {
          path: result.snapshotData.path,
          changeType: result.snapshotData.changeType,
          timestamp: result.snapshotData.timestamp,
          hashBefore: result.snapshotData.hashBefore,
          hashAfter: result.snapshotData.hashAfter,
        }
        
        // Notify callback if set
        if (this.onSnapshot) {
          this.onSnapshot(event)
        }
      }
    } catch (error) {
      // Log error but don't crash the watcher
      console.error('Error creating snapshot:', error)
    }
  }
}
