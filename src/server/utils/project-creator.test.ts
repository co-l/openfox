import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateProjectName, createProjectDirectory } from './project-creator.js'

const mockRealExecSync = vi.hoisted(() => ({
  current: undefined as unknown as typeof execSync,
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  mockRealExecSync.current = actual.execSync
  return { ...actual, execSync: vi.fn(actual.execSync) }
})

describe('project-creator', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    vi.mocked(execSync).mockImplementation(mockRealExecSync.current as never)
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

  describe('createProjectDirectory', () => {
    beforeEach(async () => {
      const { initDatabase } = await import('../db/index.js')
      const { loadConfig } = await import('../config.js')
      initDatabase(loadConfig())
    })

    it('creates directory and git repo (frontend flow)', async () => {
      // Frontend passes full path as workdir
      const fullPath = join(testDir, 'my-project')
      const project = await createProjectDirectory('my-project', fullPath)

      expect(project.name).toBe('my-project')
      expect(project.workdir).toBe(fullPath)

      const gitDir = join(fullPath, '.git')
      expect(await checkExists(gitDir)).toBe(true)
    })

    it('works with existing directory (browse flow)', async () => {
      // User clicked on existing folder
      const existingDir = join(testDir, 'existing')
      await mkdir(existingDir)

      const project = await createProjectDirectory('existing', existingDir)

      expect(project.name).toBe('existing')
      expect(project.workdir).toBe(existingDir)

      const gitDir = join(existingDir, '.git')
      expect(await checkExists(gitDir)).toBe(true)
    })

    it('handles special chars in name', async () => {
      const fullPath = join(testDir, 'test.project-123')
      const project = await createProjectDirectory('test.project-123', fullPath)

      expect(project.name).toBe('test.project-123')
      expect(project.workdir).toBe(fullPath)
    })

    it('creates the project without git when git is not installed', async () => {
      const fullPath = join(testDir, 'no-git-project')
      const missing = new Error('Command failed: git init\n/bin/sh: 1: git: not found') as Error & {
        status?: number
      }
      missing.status = 127
      vi.mocked(execSync).mockImplementation(() => {
        throw missing
      })

      const project = await createProjectDirectory('no-git-project', fullPath)

      expect(project.name).toBe('no-git-project')
      expect(project.workdir).toBe(fullPath)
      expect(await checkExists(fullPath)).toBe(true)
      expect(await checkExists(join(fullPath, '.git'))).toBe(false)
    })

    it('fails and cleans up when git init fails for a non-missing reason', async () => {
      const fullPath = join(testDir, 'git-fail-project')
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('fatal: unable to write new index file')
      })

      let caught: unknown
      try {
        await createProjectDirectory('git-fail-project', fullPath)
      } catch (err) {
        caught = err
      }

      expect(String((caught as Error).message)).toContain('Failed to initialize git')
      expect(await checkExists(fullPath)).toBe(false)
    })

    it('fails and cleans up when a genuine git error mentions "not found"', async () => {
      const fullPath = join(testDir, 'git-fail-notfound')
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('fatal: unable to resolve reference not found')
      })

      let caught: unknown
      try {
        await createProjectDirectory('git-fail-notfound', fullPath)
      } catch (err) {
        caught = err
      }

      expect(String((caught as Error).message)).toContain('Failed to initialize git')
      expect(await checkExists(fullPath)).toBe(false)
    })

    it('skips the sudo retry and reports EACCES when git init fails on Windows', async () => {
      const fullPath = join(testDir, 'win-project')
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("fatal: could not create work tree dir '...': Permission denied")
      })
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      // Clear calls recorded by the beforeEach DB setup — only the git init under test should count
      vi.mocked(execSync).mockClear()

      try {
        let caught: unknown
        try {
          await createProjectDirectory('win-project', fullPath)
        } catch (err) {
          caught = err
        }

        expect((caught as Error & { code?: string }).code).toBe('EACCES')
        expect(String((caught as Error).message)).toContain('Permission denied')
        // Only git init ran — no id/sudo fallback on Windows
        expect(execSync).toHaveBeenCalledTimes(1)
        expect(execSync).not.toHaveBeenCalledWith(expect.stringContaining('sudo -u'), expect.anything())
        // Self-created directory is cleaned up after failure
        expect(await checkExists(fullPath)).toBe(false)
      } finally {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
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
