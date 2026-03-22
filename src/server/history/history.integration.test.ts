import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSnapshot } from './history.snapshot.js'
import { loadIndex, addToIndex } from './history.index.js'
import { loadConfig } from './history.config.js'

describe('history integration', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-history-integration-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('creates snapshot and updates index', async () => {
    // Arrange
    const filePath = 'test-file.txt'
    const fullPath = join(testDir, filePath)
    await writeFile(fullPath, 'initial content')
    
    // Act - create snapshot
    const result = await createSnapshot(fullPath, testDir, 'modify', snapshotDir)
    expect(result.success).toBe(true)
    
    // Assert - snapshot file exists
    expect(result.snapshotPath).toBeDefined()
    expect(result.snapshotData).toBeDefined()
    
    // Assert - index was updated
    const index = await loadIndex(snapshotDir)
    expect(index.length).toBe(1)
    expect(index[0]?.path).toBe(filePath)
    expect(index[0]?.changeType).toBe('modify')
  })

  it('loads config with defaults', async () => {
    // Create .openfox directory first
    await mkdir(join(testDir, '.openfox'), { recursive: true })
    
    // Act
    const config = await loadConfig(testDir)
    
    // Assert
    expect(config.retentionDays).toBe(30)
    expect(config.maxSizeMB).toBe(100)
    expect(config.excludePatterns).toEqual([])
    
    // Verify config file was created
    const { existsSync } = await import('node:fs')
    const configPath = join(testDir, '.openfox', 'config.json')
    expect(existsSync(configPath)).toBe(true)
  })

  it('handles multiple snapshots correctly', async () => {
    // Arrange
    const file1 = 'file1.txt'
    const file2 = 'file2.txt'
    await writeFile(join(testDir, file1), 'content1')
    await writeFile(join(testDir, file2), 'content2')
    
    // Act - create multiple snapshots
    await createSnapshot(join(testDir, file1), testDir, 'create', snapshotDir)
    await createSnapshot(join(testDir, file2), testDir, 'create', snapshotDir)
    
    // Modify file1
    await writeFile(join(testDir, file1), 'updated content1')
    await createSnapshot(join(testDir, file1), testDir, 'modify', snapshotDir)
    
    // Assert
    const index = await loadIndex(snapshotDir)
    expect(index.length).toBe(3)
    
    // Most recent should be first
    expect(index[0]?.path).toBe(file1)
    expect(index[0]?.changeType).toBe('modify')
    
    expect(index[1]?.path).toBe(file2)
    expect(index[1]?.changeType).toBe('create')
    
    expect(index[2]?.path).toBe(file1)
    expect(index[2]?.changeType).toBe('create')
  })

  it('maintains index size limit', async () => {
    // Arrange
    const maxEntries = 10
    await mkdir(join(testDir, '.openfox'), { recursive: true })
    
    // Create more than max entries
    for (let i = 0; i < maxEntries + 5; i++) {
      const filePath = join(testDir, `file-${i}.txt`)
      await writeFile(filePath, `content-${i}`)
      
      const result = await createSnapshot(filePath, testDir, 'create', snapshotDir)
      if (result.success) {
        await addToIndex(snapshotDir, result.snapshotData!, maxEntries)
      }
    }
    
    // Assert
    const index = await loadIndex(snapshotDir)
    expect(index.length).toBe(maxEntries)
    
    // Should have the most recent entries (last 10 of 15)
    expect(index[0]?.path).toBe('file-14.txt')
    expect(index[index.length - 1]?.path).toBe('file-10.txt')
  })
})
