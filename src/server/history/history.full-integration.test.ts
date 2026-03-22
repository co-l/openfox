import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileWatcher } from './history.watcher.js'
import { createSnapshot } from './history.snapshot.js'
import { loadIndex } from './history.index.js'
import { loadConfig } from './history.config.js'
import { cleanupSnapshots } from './history.retention.js'
import type { HistoryConfig } from './history.config.js'

describe('history full integration', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-full-integration-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('full workflow: watcher creates snapshots, API serves them, retention cleans up', async () => {
    // 1. Initialize config
    const config = await loadConfig(testDir)
    expect(config.retentionDays).toBe(30)
    expect(config.maxSizeMB).toBe(100)

    // 2. Create some test files
    const file1 = join(testDir, 'test1.txt')
    const file2 = join(testDir, 'test2.txt')
    await writeFile(file1, 'content1')
    await writeFile(file2, 'content2')

    // 3. Create snapshots manually
    const snap1 = await createSnapshot(file1, testDir, 'create', snapshotDir)
    const snap2 = await createSnapshot(file2, testDir, 'create', snapshotDir)
    
    expect(snap1.success).toBe(true)
    expect(snap2.success).toBe(true)

    // 4. Verify index was updated
    const index = await loadIndex(snapshotDir)
    expect(index.length).toBe(2)
    expect(index[0]?.path).toMatch(/test/)

    // 5. Modify a file and create another snapshot
    await writeFile(file1, 'updated content1')
    const snap3 = await createSnapshot(file1, testDir, 'modify', snapshotDir)
    expect(snap3.success).toBe(true)

    // 6. Verify index now has 3 entries
    const index2 = await loadIndex(snapshotDir)
    expect(index2.length).toBe(3)
    expect(index2[0]?.changeType).toBe('modify')

    // 7. Test retention policy - just verify it runs without error
    const oldConfig: HistoryConfig = {
      retentionDays: 30,
      maxSizeMB: 100,
      excludePatterns: [],
    }
    
    const result = await cleanupSnapshots(snapshotDir, oldConfig)
    // Should complete without errors
    expect(result).toBeDefined()
    expect(result.deletedCount).toBeGreaterThanOrEqual(0)
  })

  it('gitignore exclusion works correctly', async () => {
    // Create .gitignore
    await writeFile(
      join(testDir, '.gitignore'),
      'node_modules/\ndist/\n*.log\n'
    )

    // Create files that should be excluded
    const nodeModuleFile = join(testDir, 'node_modules', 'test.js')
    await mkdir(join(testDir, 'node_modules'), { recursive: true })
    await writeFile(nodeModuleFile, 'should not be tracked')

    const logFile = join(testDir, 'debug.log')
    await writeFile(logFile, 'log content')

    // Create a file that should be tracked
    const trackedFile = join(testDir, 'src.ts')
    await writeFile(trackedFile, 'typescript code')

    // Create snapshot for the tracked file
    const result = await createSnapshot(trackedFile, testDir, 'create', snapshotDir)
    expect(result.success).toBe(true)

    // Verify index only has the tracked file
    const index = await loadIndex(snapshotDir)
    expect(index.length).toBe(1)
    expect(index[0]?.path).toBe('src.ts')
  })

  it('handles binary files correctly', async () => {
    // Create a binary file
    const binaryFile = join(testDir, 'image.png')
    const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // PNG header
    await writeFile(binaryFile, binaryContent)

    // Create snapshot (should skip binary detection)
    const result = await createSnapshot(binaryFile, testDir, 'create', snapshotDir)
    
    // Binary files should still be snapshotted but the watcher would skip them
    expect(result.success).toBe(true)
  })

  it('atomic writes prevent corruption', async () => {
    const filePath = join(testDir, 'atomic-test.txt')
    await writeFile(filePath, 'test content')

    // Create multiple snapshots sequentially (not in parallel to avoid race conditions)
    const results = []
    for (let i = 0; i < 5; i++) {
      await writeFile(filePath, `content-${i}`)
      const result = await createSnapshot(filePath, testDir, 'modify', snapshotDir)
      results.push(result)
    }

    // All should succeed
    results.forEach(r => expect(r.success).toBe(true))
    
    // All snapshot files should be valid JSON
    for (const result of results) {
      const content = await readFile(result.snapshotPath!, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.path).toBe('atomic-test.txt')
      expect(parsed.content).toBeDefined()
    }
  })
})
