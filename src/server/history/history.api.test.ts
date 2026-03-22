import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSnapshot } from './history.snapshot.js'
import { getHistorySnapshot } from './history.api.js'
import type { Request, Response } from 'express'

describe('history API snapshot content', () => {
  let testDir: string
  let snapshotDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-api-test-${Date.now()}`)
    snapshotDir = join(testDir, '.openfox', 'history')
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns file content for a snapshot', async () => {
    // Arrange - create a test file and snapshot it
    const testFile = join(testDir, 'test.txt')
    const testContent = 'Hello, World!'
    await writeFile(testFile, testContent)
    
    const result = await createSnapshot(testFile, testDir, 'create', snapshotDir)
    expect(result.success).toBe(true)
    expect(result.snapshotData).toBeDefined()
    
    const timestamp = result.snapshotData!.timestamp
    
    // Act - call the API endpoint
    const mockReq = {
      query: { workdir: testDir },
      params: { snapshotId: timestamp }
    } as unknown as Request
    
    let jsonResponse: any
    const mockRes = {
      status: (code: number) => {
        mockRes.statusCode = code
        return mockRes
      },
      json: (data: any) => {
        jsonResponse = data
      },
      statusCode: 200
    } as unknown as Response
    
    await getHistorySnapshot(mockReq, mockRes)
    
    // Assert
    expect(jsonResponse).toBeDefined()
    expect(jsonResponse.entry).toBeDefined()
    expect(jsonResponse.entry.content).toBeDefined()
    expect(jsonResponse.entry.content).toBe(testContent)
  })

  it('returns content for a deleted file snapshot', async () => {
    // Arrange - create a file and snapshot it as deleted (before actually deleting)
    const testFile = join(testDir, 'to-delete.txt')
    const originalContent = 'Content to be deleted'
    await writeFile(testFile, originalContent)
    
    // Create snapshot with changeType='delete' while file still exists
    // This captures what was being deleted
    const deleteResult = await createSnapshot(testFile, testDir, 'delete', snapshotDir)
    expect(deleteResult.success).toBe(true)
    expect(deleteResult.snapshotData).toBeDefined()
    
    // For deletes, the snapshot should contain the content that was deleted
    expect(deleteResult.snapshotData!.content).toBeDefined()
    
    const timestamp = deleteResult.snapshotData!.timestamp
    
    // Act
    const mockReq = {
      query: { workdir: testDir },
      params: { snapshotId: timestamp }
    } as unknown as Request
    
    let jsonResponse: any
    const mockRes = {
      status: (code: number) => mockRes,
      json: (data: any) => { jsonResponse = data }
    } as unknown as Response
    
    await getHistorySnapshot(mockReq, mockRes)
    
    // Assert - deleted files should have content (what was deleted)
    expect(jsonResponse.entry.content).toBe(originalContent)
  })
})
