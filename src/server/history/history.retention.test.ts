import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanupSnapshots } from './history.retention.js'
import { createSnapshot } from './history.snapshot.js'
import type { HistoryConfig } from './history.config.js'

describe('retention policy', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-retention-test-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('deletes snapshots older than retention period', async () => {
    // Arrange
    const config: HistoryConfig = {
      retentionDays: 1,
      maxSizeMB: 100,
      excludePatterns: [],
    }
    
    // Create old snapshot (simulate 2 days old)
    const oldFile = 'old-file.txt'
    const fullPath = join(testDir, oldFile)
    await writeFile(fullPath, 'old content')
    
    const result = await createSnapshot(fullPath, testDir, 'modify', snapshotDir)
    expect(result.success).toBe(true)
    
    // Manually modify the timestamp to be old
    const oldSnapshotPath = result.snapshotPath!
    const oldSnapshot = await import('node:fs/promises').then(m => m.readFile(oldSnapshotPath, 'utf-8'))
    const modifiedSnapshot = JSON.parse(oldSnapshot)
    modifiedSnapshot.timestamp = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    await import('node:fs/promises').then(m => m.writeFile(oldSnapshotPath, JSON.stringify(modifiedSnapshot, null, 2)))
    
    // Act
    const cleanupResult = await cleanupSnapshots(snapshotDir, config)
    
    // Assert
    expect(cleanupResult.deletedCount).toBe(1)
    expect(cleanupResult.freedBytes).toBeGreaterThan(0)
  })

  it('keeps recent snapshots', async () => {
    // Arrange
    const config: HistoryConfig = {
      retentionDays: 30,
      maxSizeMB: 100,
      excludePatterns: [],
    }
    
    const filePath = 'recent-file.txt'
    const fullPath = join(testDir, filePath)
    await writeFile(fullPath, 'recent content')
    
    const result = await createSnapshot(fullPath, testDir, 'modify', snapshotDir)
    expect(result.success).toBe(true)
    
    // Act
    const cleanupResult = await cleanupSnapshots(snapshotDir, config)
    
    // Assert
    expect(cleanupResult.deletedCount).toBe(0)
  })
})
