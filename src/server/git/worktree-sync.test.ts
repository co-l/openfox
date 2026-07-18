import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { syncIgnoredAssets, getIgnoredDirectories } from './worktree.js'

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

/** Symlink creation needs a privilege/Developer Mode on Windows — probe once. */
const CAN_SYMLINK = (() => {
  if (process.platform !== 'win32') return true
  const probe = join(tmpdir(), `wt-symlink-probe-${process.pid}`)
  try {
    symlinkSync('probe-target', probe, 'file')
    rmSync(probe)
    return true
  } catch {
    return false
  }
})()

function createProjectStructure(root: string) {
  // Create a realistic project with .gitignore, node_modules, etc.
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.gitignore'), 'node_modules/\nweb/node_modules/\n')

  // Create source node_modules with a file and a symlink
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'some-package'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'some-package', 'index.js'), 'module.exports = 42')

  // Create web/node_modules
  mkdirSync(join(root, 'web', 'node_modules', '.bin'), { recursive: true })
  mkdirSync(join(root, 'web', 'node_modules', 'web-pkg'), { recursive: true })
  writeFileSync(join(root, 'web', 'node_modules', 'web-pkg', 'index.js'), 'module.exports = "web"')

  if (CAN_SYMLINK) {
    symlinkSync('../some-package/index.js', join(root, 'node_modules', '.bin', 'some-package'))
    symlinkSync('../web-pkg/index.js', join(root, 'web', 'node_modules', '.bin', 'web-pkg'))
  }
}

describe('getIgnoredDirectories', () => {
  it('returns gitignored directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-test-'))
    try {
      createProjectStructure(root)
      // Init git repo so git ls-files works
      const { execSync } = await import('node:child_process')
      execSync('git init', { cwd: root, stdio: 'ignore' })
      execSync('git add .gitignore', { cwd: root, stdio: 'ignore' })

      const dirs = await getIgnoredDirectories(root)
      expect(dirs).toContain('node_modules/')
      expect(dirs).toContain('web/node_modules/')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('syncIgnoredAssets', () => {
  it.skipIf(!CAN_SYMLINK)('copies node_modules preserving symlinks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-test-'))
    const worktreePath = join(root, 'worktrees', 'test-branch')
    try {
      createProjectStructure(root)
      const { execSync } = await import('node:child_process')
      execSync('git init', { cwd: root, stdio: 'ignore' })
      execSync('git add .gitignore', { cwd: root, stdio: 'ignore' })
      mkdirSync(worktreePath, { recursive: true })

      await syncIgnoredAssets(root, worktreePath, {
        ignoredAssets: 'skip',
        overrides: { node_modules: 'copy' },
      })

      // Root node_modules should be copied
      expect(existsSync(join(worktreePath, 'node_modules', 'some-package', 'index.js'))).toBe(true)
      // Web node_modules should be copied (basename match)
      expect(existsSync(join(worktreePath, 'web', 'node_modules', 'web-pkg', 'index.js'))).toBe(true)
      // Symlinks should be preserved as relative
      const binLink = readlinkSync(join(worktreePath, 'node_modules', '.bin', 'some-package'))
      expect(binLink).toBe('../some-package/index.js')
      const webBinLink = readlinkSync(join(worktreePath, 'web', 'node_modules', '.bin', 'web-pkg'))
      expect(webBinLink).toBe('../web-pkg/index.js')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does nothing with skip strategy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-test-'))
    const worktreePath = join(root, 'worktrees', 'test-branch')
    try {
      createProjectStructure(root)
      const { execSync } = await import('node:child_process')
      execSync('git init', { cwd: root, stdio: 'ignore' })
      execSync('git add .gitignore', { cwd: root, stdio: 'ignore' })
      mkdirSync(worktreePath, { recursive: true })

      await syncIgnoredAssets(root, worktreePath, { ignoredAssets: 'skip' })

      expect(existsSync(join(worktreePath, 'node_modules'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('copies nothing when no ignored dirs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wt-test-'))
    const worktreePath = join(root, 'worktrees', 'test-branch')
    try {
      mkdirSync(join(root, '.git'))
      writeFileSync(join(root, '.gitignore'), '')
      const { execSync } = await import('node:child_process')
      execSync('git init', { cwd: root, stdio: 'ignore' })
      execSync('git add .gitignore', { cwd: root, stdio: 'ignore' })
      mkdirSync(worktreePath, { recursive: true })

      await syncIgnoredAssets(root, worktreePath, { ignoredAssets: 'copy' })

      expect(existsSync(join(worktreePath, 'node_modules'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
