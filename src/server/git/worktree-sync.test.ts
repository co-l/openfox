import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncIgnoredAssets, getIgnoredDirectories } from './worktree.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  symlink: vi.fn(),
  cp: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { spawn } from 'node:child_process'
import { stat, symlink, cp } from 'node:fs/promises'

type MockProc = {
  stdout: { on: (event: string, cb: (d: Buffer) => void) => void }
  stderr: { on: (event: string, cb: (d: Buffer) => void) => void }
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

function makeMockProc(stdout: string, exitCode = 0): MockProc {
  return {
    stdout: {
      on: (event, cb) => {
        if (event === 'data') setTimeout(() => cb(Buffer.from(stdout)), 0)
      },
    },
    stderr: {
      on: (_event: string, _cb: (d: Buffer) => void) => {},
    },
    on: (event, cb) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0)
    },
  }
}

const PROJECT_DIR = '/tmp/project'
const WORKTREE_PATH = '/tmp/project/worktrees/test-branch'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getIgnoredDirectories', () => {
  it('returns directories from git ls-files output', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\nweb/node_modules\ne2e/node_modules\n') as any)
    const result = await getIgnoredDirectories(PROJECT_DIR)
    expect(result).toEqual(['node_modules', 'web/node_modules', 'e2e/node_modules'])
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      expect.objectContaining({ cwd: PROJECT_DIR }),
    )
  })

  it('returns empty array when no ignored directories', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    const result = await getIgnoredDirectories(PROJECT_DIR)
    expect(result).toEqual([])
  })

  it('returns empty array on git error', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', 1) as any)
    const result = await getIgnoredDirectories(PROJECT_DIR)
    expect(result).toEqual([])
  })
})

describe('syncIgnoredAssets', () => {
  it('does nothing when no ignored directories', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'copy' })
    expect(symlink).not.toHaveBeenCalled()
    expect(cp).not.toHaveBeenCalled()
  })

  it('copies all ignored directories with copy strategy', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\nweb/node_modules\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any) // node_modules exists in source
      .mockResolvedValueOnce({} as any) // web/node_modules exists in source
    vi.mocked(cp).mockResolvedValue(undefined)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'copy' })

    expect(cp).toHaveBeenCalledTimes(2)
    expect(cp).toHaveBeenCalledWith('/tmp/project/node_modules', '/tmp/project/worktrees/test-branch/node_modules', {
      recursive: true,
      force: true,
    })
    expect(cp).toHaveBeenCalledWith(
      '/tmp/project/web/node_modules',
      '/tmp/project/worktrees/test-branch/web/node_modules',
      { recursive: true, force: true },
    )
  })

  it('symlinks ignored directories with symlink strategy', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any) // exists in source
      .mockRejectedValueOnce({ code: 'ENOENT' }) // not in worktree
    vi.mocked(symlink).mockResolvedValue(undefined)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'symlink' })

    expect(symlink).toHaveBeenCalledTimes(1)
    expect(symlink).toHaveBeenCalledWith('/tmp/project/node_modules', '/tmp/project/worktrees/test-branch/node_modules')
  })

  it('skips symlink target that already exists', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any) // exists in source
      .mockResolvedValueOnce({} as any) // already exists in worktree

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'symlink' })

    expect(symlink).not.toHaveBeenCalled()
  })

  it('skips paths that do not exist in source', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\n') as any)
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' }) // doesn't exist in source

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'copy' })

    expect(cp).not.toHaveBeenCalled()
  })

  it('matches override by exact path', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\nweb/node_modules\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any) // node_modules source exists
      .mockRejectedValueOnce({ code: 'ENOENT' }) // node_modules target doesn't exist
      .mockResolvedValueOnce({} as any) // web/node_modules source exists
    vi.mocked(cp).mockResolvedValue(undefined)
    vi.mocked(symlink).mockResolvedValue(undefined)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, {
      ignoredAssets: 'symlink',
      overrides: { 'web/node_modules': 'copy' },
    })

    // node_modules symlinked (global strategy), web/node_modules copied (override)
    expect(symlink).toHaveBeenCalledTimes(1)
    expect(cp).toHaveBeenCalledTimes(1)
    expect(cp).toHaveBeenCalledWith(
      '/tmp/project/web/node_modules',
      '/tmp/project/worktrees/test-branch/web/node_modules',
      { recursive: true, force: true },
    )
  })

  it('matches override by basename', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\nweb/node_modules\ne2e/node_modules\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
    vi.mocked(cp).mockResolvedValue(undefined)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, {
      ignoredAssets: 'skip',
      overrides: { node_modules: 'copy' },
    })

    // All node_modules dirs at any depth are copied via basename match
    expect(cp).toHaveBeenCalledTimes(3)
    expect(cp).toHaveBeenCalledWith('/tmp/project/node_modules', '/tmp/project/worktrees/test-branch/node_modules', {
      recursive: true,
      force: true,
    })
    expect(cp).toHaveBeenCalledWith(
      '/tmp/project/web/node_modules',
      '/tmp/project/worktrees/test-branch/web/node_modules',
      { recursive: true, force: true },
    )
    expect(cp).toHaveBeenCalledWith(
      '/tmp/project/e2e/node_modules',
      '/tmp/project/worktrees/test-branch/e2e/node_modules',
      { recursive: true, force: true },
    )
  })

  it('exact path override takes precedence over basename', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\nweb/node_modules\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
    vi.mocked(cp).mockResolvedValue(undefined)
    vi.mocked(symlink).mockResolvedValue(undefined)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, {
      ignoredAssets: 'copy',
      overrides: { 'web/node_modules': 'symlink' },
    })

    // node_modules copied (global), web/node_modules symlinked (exact override beats basename)
    expect(cp).toHaveBeenCalledTimes(1)
    expect(symlink).toHaveBeenCalledTimes(1)
  })

  it('handles skip strategy gracefully', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\n') as any)
    vi.mocked(stat).mockResolvedValueOnce({} as any)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'skip' })

    expect(symlink).not.toHaveBeenCalled()
    expect(cp).not.toHaveBeenCalled()
  })

  it('continues on error and logs warning', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('node_modules\n.env\n') as any)
    vi.mocked(stat)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
    vi.mocked(cp).mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(undefined)

    await syncIgnoredAssets(PROJECT_DIR, WORKTREE_PATH, { ignoredAssets: 'copy' })

    expect(cp).toHaveBeenCalledTimes(2)
  })
})
