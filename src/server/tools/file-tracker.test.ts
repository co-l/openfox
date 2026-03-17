import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  computeFileHash,
  validateFileForWrite,
  FileNotReadError,
  FileChangedExternallyError,
} from './file-tracker.js'
import type { FileReadEntry } from '../../shared/types.js'

describe('file-tracker', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-file-tracker-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('computeFileHash', () => {
    it('computes SHA-256 hash of file content', async () => {
      const filePath = join(testDir, 'test.txt')
      await writeFile(filePath, 'hello world')
      
      const hash = await computeFileHash(filePath)
      
      // SHA-256 of 'hello world'
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    })

    it('returns different hash for different content', async () => {
      const file1 = join(testDir, 'file1.txt')
      const file2 = join(testDir, 'file2.txt')
      await writeFile(file1, 'content A')
      await writeFile(file2, 'content B')
      
      const hash1 = await computeFileHash(file1)
      const hash2 = await computeFileHash(file2)
      
      expect(hash1).not.toBe(hash2)
    })

    it('returns same hash for identical content', async () => {
      const file1 = join(testDir, 'file1.txt')
      const file2 = join(testDir, 'file2.txt')
      await writeFile(file1, 'identical content')
      await writeFile(file2, 'identical content')
      
      const hash1 = await computeFileHash(file1)
      const hash2 = await computeFileHash(file2)
      
      expect(hash1).toBe(hash2)
    })

    it('returns null for non-existent file', async () => {
      const hash = await computeFileHash(join(testDir, 'nonexistent.txt'))
      expect(hash).toBeNull()
    })
  })

  describe('validateFileForWrite', () => {
    it('allows writing to new file (not on disk)', async () => {
      const filePath = join(testDir, 'new-file.txt')
      const readFiles: Record<string, FileReadEntry> = {}
      
      const result = await validateFileForWrite(filePath, readFiles)
      
      expect(result.valid).toBe(true)
    })

    it('rejects writing to existing file that was not read', async () => {
      const filePath = join(testDir, 'existing.txt')
      await writeFile(filePath, 'existing content')
      const readFiles: Record<string, FileReadEntry> = {}
      
      const result = await validateFileForWrite(filePath, readFiles)
      
      expect(result.valid).toBe(false)
      expect(result.error).toBeInstanceOf(FileNotReadError)
      expect(result.error?.message).toContain('must be read before writing')
    })

    it('allows writing to file that was read and unchanged', async () => {
      const filePath = join(testDir, 'read-file.txt')
      const content = 'original content'
      await writeFile(filePath, content)
      
      const hash = await computeFileHash(filePath)
      const readFiles: Record<string, FileReadEntry> = {
        [filePath]: { hash: hash!, readAt: new Date().toISOString() },
      }
      
      const result = await validateFileForWrite(filePath, readFiles)
      
      expect(result.valid).toBe(true)
    })

    it('rejects writing to file that changed externally since read', async () => {
      const filePath = join(testDir, 'changed-file.txt')
      await writeFile(filePath, 'original content')
      
      // Record the original hash
      const originalHash = await computeFileHash(filePath)
      const readFiles: Record<string, FileReadEntry> = {
        [filePath]: { hash: originalHash!, readAt: new Date().toISOString() },
      }
      
      // Simulate external change
      await writeFile(filePath, 'modified by external process')
      
      const result = await validateFileForWrite(filePath, readFiles)
      
      expect(result.valid).toBe(false)
      expect(result.error).toBeInstanceOf(FileChangedExternallyError)
      expect(result.error?.message).toContain('must be read before writing')
    })

    it('handles file deleted after being read', async () => {
      const filePath = join(testDir, 'deleted-file.txt')
      await writeFile(filePath, 'will be deleted')
      
      const hash = await computeFileHash(filePath)
      const readFiles: Record<string, FileReadEntry> = {
        [filePath]: { hash: hash!, readAt: new Date().toISOString() },
      }
      
      // Delete the file
      await rm(filePath)
      
      // File no longer exists, so it's like creating a new file - should be allowed
      const result = await validateFileForWrite(filePath, readFiles)
      
      expect(result.valid).toBe(true)
    })

    it('normalizes paths for comparison', async () => {
      const filePath = join(testDir, 'subdir', '..', 'normalized.txt')
      const normalizedPath = join(testDir, 'normalized.txt')
      await writeFile(normalizedPath, 'content')
      
      const hash = await computeFileHash(normalizedPath)
      const readFiles: Record<string, FileReadEntry> = {
        [normalizedPath]: { hash: hash!, readAt: new Date().toISOString() },
      }
      
      // Use non-normalized path for validation
      const result = await validateFileForWrite(filePath, readFiles)
      
      expect(result.valid).toBe(true)
    })
  })
})
