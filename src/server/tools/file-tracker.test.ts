import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { computeFileHash, validateFileForWrite, FileNotReadError, FileChangedExternallyError } from './file-tracker.js'
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

  describe('cross-workspace matching', () => {
    it('allows write when the same relative path was read with identical content in another workspace', async () => {
      const originalDir = join(testDir, 'original')
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(join(originalDir, 'src'), { recursive: true })
      await mkdir(join(workspaceDir, 'src'), { recursive: true })

      const content = 'shared content'
      await writeFile(join(originalDir, 'src', 'app.ts'), content)
      await writeFile(join(workspaceDir, 'src', 'app.ts'), content)

      const origPath = join(originalDir, 'src', 'app.ts')
      const wsPath = join(workspaceDir, 'src', 'app.ts')

      const hash = await computeFileHash(origPath)
      const readFiles: Record<string, FileReadEntry> = {
        [origPath]: { hash: hash!, readAt: new Date().toISOString(), relPath: join('src', 'app.ts') },
      }

      const result = await validateFileForWrite(wsPath, readFiles, workspaceDir)

      expect(result.valid).toBe(true)
    })

    it('rejects write when the same relative path has different content across workspaces', async () => {
      const originalDir = join(testDir, 'original')
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(originalDir, { recursive: true })
      await mkdir(workspaceDir, { recursive: true })

      await writeFile(join(originalDir, 'app.ts'), 'original content')
      await writeFile(join(workspaceDir, 'app.ts'), 'diverged content')

      const origPath = join(originalDir, 'app.ts')
      const wsPath = join(workspaceDir, 'app.ts')

      const hash = await computeFileHash(origPath)
      const readFiles: Record<string, FileReadEntry> = {
        [origPath]: { hash: hash!, readAt: new Date().toISOString(), relPath: 'app.ts' },
      }

      const result = await validateFileForWrite(wsPath, readFiles, workspaceDir)

      // The agent never read THIS copy, so it must read it first — it is not
      // an external modification of a file the agent actually read.
      expect(result.valid).toBe(false)
      expect(result.error).toBeInstanceOf(FileNotReadError)
    })

    it('skips cross-workspace matching for files outside the workdir', async () => {
      const baseA = join(testDir, 'base-a')
      const baseB = join(testDir, 'base-b')
      await mkdir(baseA, { recursive: true })
      await mkdir(baseB, { recursive: true })

      const content = 'identical content'
      const outsideA = join(testDir, 'outside-a', 'x.txt')
      const outsideB = join(testDir, 'outside-b', 'x.txt')
      await mkdir(dirname(outsideA), { recursive: true })
      await mkdir(dirname(outsideB), { recursive: true })
      await writeFile(outsideA, content)
      await writeFile(outsideB, content)

      // Both produce the same '../...'-style relPath despite living in unrelated dirs.
      const readFiles: Record<string, FileReadEntry> = {
        [outsideA]: {
          hash: (await computeFileHash(outsideA))!,
          readAt: new Date().toISOString(),
          relPath: '../outside-a/x.txt',
        },
      }

      const result = await validateFileForWrite(outsideB, readFiles, baseB)

      expect(result.valid).toBe(false)
      expect(result.error).toBeInstanceOf(FileNotReadError)
    })

    it('rejects write when no relative path matches', async () => {
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(workspaceDir, { recursive: true })
      await writeFile(join(workspaceDir, 'app.ts'), 'content')

      const readFiles: Record<string, FileReadEntry> = {
        [join(testDir, 'original', 'other.ts')]: {
          hash: 'deadbeef',
          readAt: new Date().toISOString(),
          relPath: 'other.ts',
        },
      }

      const result = await validateFileForWrite(join(workspaceDir, 'app.ts'), readFiles, workspaceDir)

      expect(result.valid).toBe(false)
      expect(result.error).toBeInstanceOf(FileNotReadError)
    })

    it('does not match across workspaces when no baseDir is provided', async () => {
      const originalDir = join(testDir, 'original')
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(originalDir, { recursive: true })
      await mkdir(workspaceDir, { recursive: true })

      await writeFile(join(originalDir, 'app.ts'), 'content')
      await writeFile(join(workspaceDir, 'app.ts'), 'content')

      const origPath = join(originalDir, 'app.ts')
      const wsPath = join(workspaceDir, 'app.ts')

      const hash = await computeFileHash(origPath)
      const readFiles: Record<string, FileReadEntry> = {
        [origPath]: { hash: hash!, readAt: new Date().toISOString(), relPath: 'app.ts' },
      }

      const result = await validateFileForWrite(wsPath, readFiles)

      expect(result.valid).toBe(false)
      expect(result.error).toBeInstanceOf(FileNotReadError)
    })
  })
})
