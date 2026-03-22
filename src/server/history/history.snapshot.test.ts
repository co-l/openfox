import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createSnapshot, type SnapshotData } from './history.snapshot.js'

describe('snapshot creation', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-history-test-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await rm(testDir, { recursive: true, force: true })
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('creates a snapshot before file modification', async () => {
    // Arrange
    const filePath = 'src/test-file.txt'
    const fullFilePath = join(testDir, filePath)
    const content = 'original content'
    
    await mkdir(join(testDir, 'src'), { recursive: true })
    await writeFile(fullFilePath, content)
    
    // Act - create snapshot
    const result = await createSnapshot(
      fullFilePath,
      testDir,
      'modify',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    expect(result.snapshotPath).toBeDefined()
    expect(result.snapshotData.path).toBe(filePath)
    expect(result.snapshotData.changeType).toBe('modify')
    expect(result.snapshotData.hashBefore).toBeDefined()
    expect(result.snapshotData.content).toBeDefined()
  })

  it('records correct metadata in snapshot', async () => {
    // Arrange
    const filePath = 'src/metadata-test.ts'
    const fullFilePath = join(testDir, filePath)
    const content = 'export const test = 1'
    
    await mkdir(join(testDir, 'src'), { recursive: true })
    await writeFile(fullFilePath, content)
    
    // Calculate expected hash
    const hash = createHash('sha256').update(content).digest('hex')
    
    // Act
    const result = await createSnapshot(
      fullFilePath,
      testDir,
      'modify',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    const snapshot: SnapshotData = result.snapshotData!
    
    // Check timestamp format (ISO 8601)
    expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    
    // Check path is relative to workdir
    expect(snapshot.path).toBe(filePath)
    
    // Check changeType
    expect(snapshot.changeType).toBe('modify')
    
    // Check hash matches
    expect(snapshot.hashBefore).toBe(hash)
    
    // Check content is base64 encoded
    const decoded = Buffer.from(snapshot.content!, 'base64').toString('utf-8')
    expect(decoded).toBe(content)
  })

  it('handles file creation (hashBefore is null)', async () => {
    // Arrange
    const filePath = 'new-file.txt'
    const fullFilePath = join(testDir, filePath)
    const content = 'new file content'
    
    // Create the file first (simulating a new file creation)
    await writeFile(fullFilePath, content)
    
    // Act - snapshot the newly created file
    const result = await createSnapshot(
      fullFilePath,
      testDir,
      'create',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    const snapshot: SnapshotData = result.snapshotData!
    
    expect(snapshot.changeType).toBe('create')
    expect(snapshot.hashBefore).toBeNull()
    expect(snapshot.hashAfter).toBeDefined()
    expect(snapshot.content).toBeDefined()
    
    // Verify content matches
    const decoded = Buffer.from(snapshot.content!, 'base64').toString('utf-8')
    expect(decoded).toBe(content)
  })

  it('handles file deletion (hashAfter is null, content has deleted file)', async () => {
    // Arrange
    const filePath = 'to-delete.txt'
    const fullFilePath = join(testDir, filePath)
    const content = 'content before deletion'
    
    await writeFile(fullFilePath, content)
    
    // Act - create snapshot for deletion
    const result = await createSnapshot(
      fullFilePath,
      testDir,
      'delete',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    const snapshot: SnapshotData = result.snapshotData!
    
    expect(snapshot.changeType).toBe('delete')
    expect(snapshot.hashBefore).toBeDefined()
    expect(snapshot.hashAfter).toBeNull()
    expect(snapshot.content).toBeDefined()
    
    // Verify content contains the deleted file
    const decoded = Buffer.from(snapshot.content!, 'base64').toString('utf-8')
    expect(decoded).toBe(content)
    
    // Now actually delete the file
    await rm(fullFilePath)
  })

  it('uses atomic write pattern (temp file + rename)', async () => {
    // Arrange
    const filePath = 'atomic-test.txt'
    const fullFilePath = join(testDir, filePath)
    await writeFile(fullFilePath, 'content')
    
    // Act
    const result = await createSnapshot(
      fullFilePath,
      testDir,
      'modify',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    
    // Verify snapshot file exists and is valid JSON
    const snapshotContent = await readFile(result.snapshotPath!, 'utf-8')
    const parsed = JSON.parse(snapshotContent)
    
    expect(parsed.path).toBe(filePath)
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.content).toBeDefined()
    
    // Verify no .tmp file remains
    const tmpPath = result.snapshotPath!.replace('.json', '.tmp.json')
    try {
      await readFile(tmpPath)
      expect(false).toBe(true) // Should not reach here
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ENOENT')
    }
  })

  it('creates directory structure YYYY/MM/DD', async () => {
    // Arrange
    const filePath = 'structure-test.txt'
    const fullFilePath = join(testDir, filePath)
    await writeFile(fullFilePath, 'content')
    
    // Act
    const result = await createSnapshot(
      fullFilePath,
      testDir,
      'modify',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    
    // Parse the snapshot path to verify structure
    const relativePath = result.snapshotPath!.replace(snapshotDir, '').replace(/^[/\\]/, '')
    const parts = relativePath.split(/[\\/]/)
    
    // Should be: YYYY/MM/DD/filename_ts-YYYYMMDD-HHMMSS.json
    expect(parts.length).toBeGreaterThanOrEqual(4)
    
    const year = parts[0]
    const month = parts[1]
    const day = parts[2]
    const filename = parts[parts.length - 1]
    
    // Verify format
    expect(year).toMatch(/^\d{4}$/)
    expect(month).toMatch(/^\d{2}$/)
    expect(day).toMatch(/^\d{2}$/)
    expect(filename).toMatch(/_ts-\d{8}-\d{6}\.json$/)
  })

  it('only snapshots the modified file (per-file snapshots)', async () => {
    // Arrange
    const file1 = 'file1.txt'
    const file2 = 'file2.txt'
    await mkdir(testDir, { recursive: true })
    await writeFile(join(testDir, file1), 'content1')
    await writeFile(join(testDir, file2), 'content2')
    
    // Act - snapshot only file1
    const result = await createSnapshot(
      join(testDir, file1),
      testDir,
      'modify',
      snapshotDir
    )
    
    // Assert
    expect(result.success).toBe(true)
    expect(result.snapshotData!.path).toBe(file1)
    
    // Verify only file1's content is in the snapshot
    const decoded = Buffer.from(result.snapshotData!.content!, 'base64').toString('utf-8')
    expect(decoded).toBe('content1')
    expect(decoded).not.toBe('content2')
  })
})
