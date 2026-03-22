import { readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAllSnapshotFiles, loadSnapshot } from './history.index.js'
import type { HistoryConfig } from './history.config.js'

// ============================================================================
// Retention Policy
// ============================================================================

/**
 * Clean up old snapshots based on retention policy
 */
export async function cleanupSnapshots(
  snapshotDir: string,
  config: HistoryConfig
): Promise<{ deletedCount: number; freedBytes: number }> {
  const now = Date.now()
  const cutoffDate = new Date(now - config.retentionDays * 24 * 60 * 60 * 1000)
  const maxBytes = config.maxSizeMB * 1024 * 1024
  
  // Get all snapshot files
  const snapshotFiles = await getAllSnapshotFiles(snapshotDir)
  
  // Calculate total size
  let totalBytes = 0
  const fileSizes: Map<string, number> = new Map()
  
  for (const file of snapshotFiles) {
    try {
      const stats = statSync(file)
      const size = stats.size
      totalBytes += size
      fileSizes.set(file, size)
    } catch (error) {
      console.error(`Error getting file size for ${file}:`, error)
    }
  }
  
  // Sort by timestamp (oldest first)
  const sortedFiles: Array<{ path: string; timestamp: Date; size: number }> = []
  
  for (const file of snapshotFiles) {
    const snapshot = await loadSnapshot(file)
    if (snapshot) {
      sortedFiles.push({
        path: file,
        timestamp: new Date(snapshot.timestamp),
        size: fileSizes.get(file) || 0,
      })
    }
  }
  
  sortedFiles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  
  // Delete old files
  let deletedCount = 0
  let freedBytes = 0
  
  for (const file of sortedFiles) {
    // Delete if older than cutoff
    if (file.timestamp < cutoffDate) {
      try {
        unlinkSync(file.path)
        deletedCount++
        freedBytes += file.size
        totalBytes -= file.size
      } catch (error) {
        console.error(`Error deleting ${file.path}:`, error)
      }
    }
    
    // Delete until under size limit
    while (totalBytes > maxBytes) {
      if (sortedFiles.length === 0) break
      
      const oldest = sortedFiles[sortedFiles.length - 1]
      if (!oldest) break
      
      if (oldest.timestamp < cutoffDate) break
      
      try {
        unlinkSync(oldest.path)
        deletedCount++
        freedBytes += oldest.size
        totalBytes -= oldest.size
        sortedFiles.pop()
      } catch (error) {
        console.error(`Error deleting ${oldest.path}:`, error)
        break
      }
    }
  }
  
  return { deletedCount, freedBytes }
}

/**
 * Run cleanup periodically
 */
export function startCleanupScheduler(
  snapshotDir: string,
  config: HistoryConfig,
  intervalMs: number = 3600000 // Default: 1 hour
): NodeJS.Timeout {
  // Run immediately
  cleanupSnapshots(snapshotDir, config).then(result => {
    console.log('History cleanup completed:', result)
  })
  
  // Schedule periodic cleanup
  return setInterval(async () => {
    const result = await cleanupSnapshots(snapshotDir, config)
    console.log('Scheduled history cleanup completed:', result)
  }, intervalMs)
}
