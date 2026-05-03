import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateProjectName, createDirectoryWithGit } from './project-creator.js'

describe('project-creator', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  describe('validateProjectName', () => {
    it('accepts valid names', () => {
      expect(validateProjectName('my-project').valid).toBe(true)
      expect(validateProjectName('Project_123').valid).toBe(true)
    })

    it('rejects empty names', () => {
      expect(validateProjectName('').valid).toBe(false)
    })

    it('rejects invalid characters', () => {
      expect(validateProjectName('my@project').valid).toBe(false)
    })
  })

  describe('createDirectoryWithGit', () => {
    beforeEach(async () => {
      const { initDatabase } = await import('../db/index.js')
      const { loadConfig } = await import('../config.js')
      initDatabase(loadConfig())
    })

    it('creates directory and git repo (frontend flow)', async () => {
      // Frontend passes full path as workdir
      const fullPath = join(testDir, 'my-project')
      const project = await createDirectoryWithGit('my-project', fullPath)

      expect(project.name).toBe('my-project')
      expect(project.workdir).toBe(fullPath)

      const gitDir = join(fullPath, '.git')
      expect(await checkExists(gitDir)).toBe(true)
    })

    it('works with existing directory (browse flow)', async () => {
      // User clicked on existing folder
      const existingDir = join(testDir, 'existing')
      await mkdir(existingDir)

      const project = await createDirectoryWithGit('existing', existingDir)

      expect(project.name).toBe('existing')
      expect(project.workdir).toBe(existingDir)

      const gitDir = join(existingDir, '.git')
      expect(await checkExists(gitDir)).toBe(true)
    })

    it('handles special chars in name', async () => {
      const fullPath = join(testDir, 'test.project-123')
      const project = await createDirectoryWithGit('test.project-123', fullPath)

      expect(project.name).toBe('test.project-123')
      expect(project.workdir).toBe(fullPath)
    })
  })
})

async function checkExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
