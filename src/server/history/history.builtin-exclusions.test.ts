import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileWatcher } from './history.watcher.js'

describe('builtin exclusions', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-builtin-exclude-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('excludes .openfox directory from being watched', async () => {
    // Arrange
    const snapshotCallback = vi.fn()
    const watcher = new FileWatcher(testDir, snapshotDir, [])
    watcher.onSnapshot = snapshotCallback
    
    watcher.start()
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Create .openfox/history directory and files (simulating OpenFox's own operations)
    const openfoxHistoryDir = join(testDir, '.openfox', 'history')
    await mkdir(openfoxHistoryDir, { recursive: true })
    
    const indexFile = join(openfoxHistoryDir, 'index.json')
    await writeFile(indexFile, JSON.stringify([]))
    
    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 600))
    
    // Assert - should NOT create snapshots for .openfox files
    expect(snapshotCallback).not.toHaveBeenCalled()
    
    watcher.stop()
  })

  it('excludes .openfox/** subdirectories', async () => {
    // Arrange
    const snapshotCallback = vi.fn()
    const watcher = new FileWatcher(testDir, snapshotDir, [])
    watcher.onSnapshot = snapshotCallback
    
    watcher.start()
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Create nested .openfox structure
    const nestedDir = join(testDir, '.openfox', 'history', '2026', '03', '22')
    await mkdir(nestedDir, { recursive: true })
    
    const nestedFile = join(nestedDir, 'test.json')
    await writeFile(nestedFile, 'test content')
    
    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 600))
    
    // Assert - should NOT create snapshots for nested .openfox files
    expect(snapshotCallback).not.toHaveBeenCalled()
    
    watcher.stop()
  })
})
