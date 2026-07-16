import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGitBranch, listWorktrees, validateRef, addWorktree, ensureWorktreesIgnored, ensureWorktree } from './worktree.js'

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
  on: (event: string, cb: (code: number | Error) => void) => void
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

  it('appends worktrees/ when missing', async () => {
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).toHaveBeenCalledWith('/tmp/project/.gitignore', 'worktrees/\n')
  })

  it('handles missing gitignore', async () => {
    vi.mocked(readFile).mockRejectedValue({ code: 'ENOENT' })
    await ensureWorktreesIgnored(CWD)
    expect(appendFile).toHaveBeenCalledWith('/tmp/project/.gitignore', 'worktrees/\n')
  })
})

describe('ensureWorktree', () => {
  it('creates worktree and returns path', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    vi.mocked(appendFile).mockResolvedValue(undefined)
    vi.mocked(spawn).mockReturnValue(makeMockProc('') as any)

    const result = await ensureWorktree(CWD, 'feature/test')
    expect(result.path).toContain('worktrees/feature-test')
    expect(result.name).toBe('feature/test')
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('worktrees'), { recursive: true })
    expect(spawn).toHaveBeenCalledWith('git', ['worktree', 'add', '-b', 'feature/test', expect.any(String), 'main'], expect.any(Object))
  })

  it('reuses existing worktree directory', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(readFile).mockResolvedValue('node_modules/\n')
    vi.mocked(spawn).mockReturnValue(makeMockProc('main\n') as any) // getGitBranch called first

    const result = await ensureWorktree(CWD, 'existing')
    expect(result.path).toContain('worktrees/existing')
    // Should not call addWorktree (git worktree add)
    expect(spawn).toHaveBeenCalledTimes(1) // only getGitBranch
    expect(spawn).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object))
  })
})
