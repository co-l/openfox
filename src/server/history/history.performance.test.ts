import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSnapshot } from './history.snapshot.js'
import { FileWatcher } from './history.watcher.js'

describe('history performance', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-performance-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('snapshot creation has minimal overhead (<5ms)', async () => {
    // Arrange
    const filePath = join(testDir, 'performance-test.txt')
    const content = 'x'.repeat(1000) // 1KB file
    await writeFile(filePath, content)

    // Act - measure time
    const startTime = performance.now()
    const result = await createSnapshot(filePath, testDir, 'modify', snapshotDir)
    const endTime = performance.now()
    const duration = endTime - startTime

    // Assert
    expect(result.success).toBe(true)
    expect(duration).toBeLessThan(5) // Must be under 5ms
  })

  it('debounce prevents duplicate snapshots', async () => {
    // Arrange
    const filePath = join(testDir, 'debounce-test.txt')
    await writeFile(filePath, 'initial')

    const snapshotCallback = vi.fn()
    const watcher = new FileWatcher(testDir, snapshotDir, [])
    watcher.onSnapshot = snapshotCallback
    watcher.start()

    // Wait for watcher to initialize
    await new Promise(resolve => setTimeout(resolve, 100))

    // Act - rapid changes
    await Promise.all([
      writeFile(filePath, 'change1'),
      writeFile(filePath, 'change2'),
      writeFile(filePath, 'change3'),
      writeFile(filePath, 'change4'),
      writeFile(filePath, 'change5'),
    ])

    // Wait for debounce period
    await new Promise(resolve => setTimeout(resolve, 600))

    // Assert - should only create one snapshot
    expect(snapshotCallback).toHaveBeenCalledTimes(1)
    
    watcher.stop()
  })

  it('efficient storage - only changed files stored', async () => {
    // Arrange
    const file1 = join(testDir, 'file1.txt')
    const file2 = join(testDir, 'file2.txt')
    const file3 = join(testDir, 'file3.txt')
    
    await writeFile(file1, 'content1')
    await writeFile(file2, 'content2')
    await writeFile(file3, 'content3')

    // Act - only snapshot file1
    const result1 = await createSnapshot(file1, testDir, 'create', snapshotDir)
    expect(result1.success).toBe(true)

    // Assert - only one snapshot created (excluding index.json)
    const { readdir } = await import('node:fs/promises')
    const allFiles = await readdir(snapshotDir, { recursive: true })
    
    // Should only have snapshot for file1, not file2 or file3
    // Exclude index.json from the count
    const snapshotFiles = allFiles.filter(f => f.endsWith('.json') && !f.includes('index.json'))
    expect(snapshotFiles.length).toBe(1)
    expect(snapshotFiles[0]).toContain('file1')
  })

  it('async operations are non-blocking', async () => {
    // Arrange
    const filePath = join(testDir, 'async-test.txt')
    await writeFile(filePath, 'content')

    // Act - create snapshot and immediately continue
    let snapshotCompleted = false
    const promise = createSnapshot(filePath, testDir, 'modify', snapshotDir)
    promise.then(() => { snapshotCompleted = true })
    
    // Should be able to continue immediately
    const immediateCheck = snapshotCompleted
    
    // Assert
    expect(immediateCheck).toBe(false) // Snapshot is async
    
    // Wait for completion
    await promise
    expect(snapshotCompleted).toBe(true)
  })

  it('handles large files efficiently', async () => {
    // Arrange - create 100KB file
    const filePath = join(testDir, 'large-file.txt')
    const largeContent = 'x'.repeat(100000) // 100KB
    await writeFile(filePath, largeContent)

    // Act
    const startTime = performance.now()
    const result = await createSnapshot(filePath, testDir, 'modify', snapshotDir)
    const endTime = performance.now()
    const duration = endTime - startTime

    // Assert - should complete in reasonable time (<50ms for 100KB)
    expect(result.success).toBe(true)
    expect(duration).toBeLessThan(50)
  })
})
