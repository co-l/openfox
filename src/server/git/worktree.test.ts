import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'node:path'
import {
  getGitBranch,
  listWorktrees,
  validateRef,
  addWorktree,
  ensureWorktreesIgnored,
  ensureWorktree,
  listBranches,
  checkoutBranch,
  createBranch,
} from './worktree.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { spawn } from 'node:child_process'
import { readFile, appendFile, mkdir, stat } from 'node:fs/promises'

type MockProc = {
  stdout: { on: (event: string, cb: (d: Buffer) => void) => void }
  stderr: { on: (event: string, cb: (d: Buffer) => void) => void }
  stdin?: { write: (d: Buffer) => void; end: () => void }
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

function makeMockProc(stdout: string, stderr = '', exitCode = 0): MockProc {
  const listeners: Record<string, (arg: unknown) => void> = {}
  return {
    stdout: {
      on: (event, cb) => {
        if (event === 'data') setTimeout(() => cb(Buffer.from(stdout)), 0)
      },
    },
    stderr: {
      on: (event, cb) => {
        if (event === 'data' && stderr) setTimeout(() => cb(Buffer.from(stderr)), 0)
      },
    },
    on: (event, cb) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0)
      if (event === 'error') listeners['error'] = cb
    },
  }
}

const CWD = '/tmp/project'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getGitBranch', () => {
  it('returns the branch name', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('main\n') as any)
    const result = await getGitBranch(CWD)
    expect(result).toBe('main')
    expect(spawn).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object))
  })

  it('returns null on error', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', '', 1) as any)
    const result = await getGitBranch(CWD)
    expect(result).toBeNull()
  })

  it('passes sanitized env excluding inherited GIT_* vars', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('main\n') as any)
    await getGitBranch(CWD)
    const callOpts = vi.mocked(spawn).mock.calls[0]?.[2] as { env: Record<string, string | undefined> } | undefined
    expect(callOpts).toBeDefined()
    expect(callOpts!.env['GIT_DIR']).toBeUndefined()
    expect(callOpts!.env['GIT_INDEX_FILE']).toBeUndefined()
    expect(callOpts!.env['GIT_WORK_TREE']).toBeUndefined()
    expect(callOpts!.env['GIT_PREFIX']).toBeUndefined()
    expect(callOpts!.env['PATH']).toBe(process.env['PATH'])
  })
})

describe('listWorktrees', () => {
  it('parses worktree list --porcelain output', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeMockProc(
        'worktree /repo/main\nbranch refs/heads/main\n\nworktree /repo/worktrees/fix\nbranch refs/heads/fix/pagination\n\n',
      ) as any,
    )
    const result = await listWorktrees(CWD)
    expect(result).toEqual([
      { path: '/repo/main', branch: 'main' },
      { path: '/repo/worktrees/fix', branch: 'fix/pagination' },
    ])
  })

  it('returns empty on error', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', '', 1) as any)
    const result = await listWorktrees(CWD)
    expect(result).toEqual([])
  })
})

describe('validateRef', () => {
  it('resolves for valid branch name', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await expect(validateRef(CWD, 'feature/foo')).resolves.toBeUndefined()
  })

  it('rejects for invalid branch name', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', 'fatal: invalid ref format', 128) as any)
    await expect(validateRef(CWD, 'bad name')).rejects.toThrow('fatal: invalid ref format')
  })
})

describe('listBranches', () => {
  it('parses git branch --format output', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('main\t*\nfeature/foo\t\nfeature/bar\t\n') as any)
    const result = await listBranches(CWD)
    expect(result).toEqual([
      { name: 'main', current: true },
      { name: 'feature/foo', current: false },
      { name: 'feature/bar', current: false },
    ])
  })

  it('returns empty on error', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', '', 1) as any)
    const result = await listBranches(CWD)
    expect(result).toEqual([])
  })
})

describe('checkoutBranch', () => {
  it('resolves on success', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await expect(checkoutBranch(CWD, 'main')).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith('git', ['checkout', 'main'], expect.any(Object))
  })

  it('rejects on failure', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', 'fatal: could not checkout', 128) as any)
    await expect(checkoutBranch(CWD, 'nonexistent')).rejects.toThrow('fatal: could not checkout')
  })
})

describe('createBranch', () => {
  it('resolves on success', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await expect(createBranch(CWD, 'feature/new')).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith('git', ['checkout', '-b', 'feature/new'], expect.any(Object))
  })

  it('rejects on failure', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', 'fatal: could not create branch', 128) as any)
    await expect(createBranch(CWD, 'feature/new')).rejects.toThrow('fatal: could not create branch')
  })
})

describe('addWorktree', () => {
  it('resolves on success', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)
    await expect(addWorktree(CWD, ['-b', 'fix', '/tmp/wt', 'main'])).resolves.toBeUndefined()
  })

  it('rejects on failure', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', 'fatal: could not create worktree', 128) as any)
    await expect(addWorktree(CWD, ['/tmp/wt', 'main'])).rejects.toThrow('fatal: could not create worktree')
  })
})

describe('ensureWorktreesIgnored', () => {
  it('does nothing when worktrees/ already in gitignore', async () => {
    vi.mocked(readFile).mockResolvedValue('node_modules/\nworktrees/\n')
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).not.toHaveBeenCalled()
  })

  it('does nothing when /worktrees/ already in gitignore', async () => {
    vi.mocked(readFile).mockResolvedValue('node_modules/\n/worktrees/\n')
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).not.toHaveBeenCalled()
  })

  it('does nothing when worktrees (no trailing slash) already in gitignore', async () => {
    vi.mocked(readFile).mockResolvedValue('node_modules/\nworktrees\n')
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).not.toHaveBeenCalled()
  })

  it('appends worktrees/ when missing', async () => {
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).toHaveBeenCalledWith(resolve(CWD, '.gitignore'), 'worktrees/\n')
  })

  it('handles missing gitignore', async () => {
    vi.mocked(readFile).mockRejectedValue({ code: 'ENOENT' })
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).toHaveBeenCalledWith(resolve(CWD, '.gitignore'), 'worktrees/\n')
  })
})

describe('ensureWorktree', () => {
  it('validates ref and creates worktree', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    vi.mocked(appendFile).mockResolvedValue(undefined)
    // First spawn = validateRef (success), second = getGitBranch, third = addWorktree
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef
      .mockReturnValueOnce(makeMockProc('main\n') as any) // getGitBranch
      .mockReturnValueOnce(makeMockProc('') as any) // addWorktree -b

    const result = await ensureWorktree(CWD, 'feature/test')
    expect(result.path).toContain(join('worktrees', 'feature-test'))
    expect(result.name).toBe('feature/test')
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('worktrees'), { recursive: true })
    expect(spawn).toHaveBeenNthCalledWith(1, 'git', ['check-ref-format', 'refs/heads/feature/test'], expect.any(Object))
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      'git',
      ['worktree', 'add', '-b', 'feature/test', expect.any(String), 'main'],
      expect.any(Object),
    )
  })

  it('rejects invalid branch name', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', 'fatal: invalid ref format', 128) as any)
    await expect(ensureWorktree(CWD, 'bad name')).rejects.toThrow('fatal: invalid ref format')
  })

  it('reuses existing worktree directory', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    // validateRef + getGitBranch
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef
      .mockReturnValueOnce(makeMockProc('main\n') as any) // getGitBranch

    const result = await ensureWorktree(CWD, 'existing')
    expect(result.path).toContain(join('worktrees', 'existing'))
    // Should not call addWorktree (git worktree add)
    expect(spawn).toHaveBeenCalledTimes(2) // validateRef + getGitBranch
    expect(spawn).toHaveBeenNthCalledWith(1, 'git', ['check-ref-format', 'refs/heads/existing'], expect.any(Object))
    expect(spawn).toHaveBeenNthCalledWith(2, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object))
  })

  it('propagates mkdir failure', async () => {
    vi.mocked(mkdir).mockRejectedValue(new Error('Permission denied'))
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)

    await expect(ensureWorktree(CWD, 'feature/test')).rejects.toThrow('Permission denied')
  })

  it('falls back without -b when branch already exists', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    vi.mocked(appendFile).mockResolvedValue(undefined)
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef
      .mockReturnValueOnce(makeMockProc('main\n') as any) // getGitBranch
      .mockReturnValueOnce(makeMockProc('', 'fatal: A branch named "existing" already exists.', 128) as any) // addWorktree -b fails
      .mockReturnValueOnce(makeMockProc('') as any) // git rev-parse --verify (branch exists)
      .mockReturnValueOnce(makeMockProc('') as any) // addWorktree without -b succeeds

    const result = await ensureWorktree(CWD, 'existing')
    expect(result.path).toContain(join('worktrees', 'existing'))
    expect(spawn).toHaveBeenNthCalledWith(
      4,
      'git',
      ['rev-parse', '--verify', 'refs/heads/existing'],
      expect.any(Object),
    )
    expect(spawn).toHaveBeenNthCalledWith(
      5,
      'git',
      ['worktree', 'add', expect.any(String), 'existing'],
      expect.any(Object),
    )
  })

  it('throws when -b fails and branch does not exist', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    vi.mocked(appendFile).mockResolvedValue(undefined)
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef
      .mockReturnValueOnce(makeMockProc('main\n') as any) // getGitBranch
      .mockReturnValueOnce(makeMockProc('', 'fatal: some error', 128) as any) // addWorktree -b fails
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse --verify fails (branch doesn't exist)

    await expect(ensureWorktree(CWD, 'nonexistent')).rejects.toThrow('fatal: some error')
  })
})
