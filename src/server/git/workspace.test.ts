import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'node:path'

import {
  getGitBranch,
  getDefaultBranch,
  resolveAndValidateSourceBranch,
  validateRef,
  ensureWorkspace,
  listBranches,
  listWorkspaces,
  getWorkspacesDir,
  isGitRepository,
} from './workspace.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('./workspace-config.js', () => ({
  loadWorkspaceConfig: vi.fn(),
}))

vi.mock('../db/projects.js', () => ({
  getProjectByWorkdir: vi.fn(),
}))

import { spawn, execSync } from 'node:child_process'
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import { loadWorkspaceConfig } from './workspace-config.js'
import { getProjectByWorkdir } from '../db/projects.js'

type MockProc = {
  stdout: { on: (event: string, cb: (d: Buffer) => void) => void }
  stderr: { on: (event: string, cb: (d: Buffer) => void) => void }
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

function makeMockProc(stdout: string, stderr = '', exitCode = 0): MockProc {
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
    },
  }
}

const CWD = '/tmp/project'
const PROJECT_NAME = 'test-project'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getGitBranch', () => {
  it('returns the branch name', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('main\n') as any)
    const result = await getGitBranch(CWD)
    expect(result).toBe('main')
  })

  it('returns null on error', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProc('', '', 1) as any)
    const result = await getGitBranch(CWD)
    expect(result).toBeNull()
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
    vi.mocked(spawn).mockReturnValue(makeMockProc('main\t*\nfeature/foo\t\n') as any)
    const result = await listBranches(CWD)
    expect(result).toEqual([
      { name: 'main', current: true },
      { name: 'feature/foo', current: false },
    ])
  })
})

describe('getWorkspacesDir', () => {
  it('returns path under global data dir when rootDir is not configured', async () => {
    vi.mocked(getProjectByWorkdir).mockReturnValue(null)
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toContain('workspaces')
    expect(dir).toContain(PROJECT_NAME)
  })

  it('returns global fallback when project has no workspaceRootDir', async () => {
    vi.mocked(getProjectByWorkdir).mockReturnValue({ workspaceRootDir: undefined } as any)
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toContain('workspaces')
    expect(dir).toContain(PROJECT_NAME)
  })

  it('uses absolute rootDir directly from project', async () => {
    vi.mocked(getProjectByWorkdir).mockReturnValue({ workspaceRootDir: '/custom/workspace/path' } as any)
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toBe('/custom/workspace/path')
  })

  it('resolves relative rootDir against projectDir', async () => {
    vi.mocked(getProjectByWorkdir).mockReturnValue({ workspaceRootDir: './my-workspaces' } as any)
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toBe(resolve(CWD, 'my-workspaces'))
  })

  it('resolves parent-relative rootDir correctly', async () => {
    vi.mocked(getProjectByWorkdir).mockReturnValue({ workspaceRootDir: '../shared-workspaces' } as any)
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toBe(resolve(CWD, '../shared-workspaces'))
  })

  it('calls getProjectByWorkdir with projectDir', async () => {
    vi.mocked(getProjectByWorkdir).mockReturnValue(null)
    await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(getProjectByWorkdir).toHaveBeenCalledWith(CWD)
  })
})

describe('listWorkspaces', () => {
  it('returns sorted workspace directories', async () => {
    vi.mocked(readdir).mockResolvedValue([
      { name: 'fix-bug', isDirectory: () => true },
      { name: 'add-feature', isDirectory: () => true },
      { name: 'readme.md', isDirectory: () => false },
    ] as any)

    vi.mocked(spawn).mockReturnValue(makeMockProc('main\n') as any)
    const result = await listWorkspaces(PROJECT_NAME, CWD)
    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe('add-feature')
    expect(result[1]?.name).toBe('fix-bug')
    expect(result[0]?.branch).toBe('main')
  })

  it('returns empty on error', async () => {
    vi.mocked(readdir).mockRejectedValue({ code: 'ENOENT' })
    const result = await listWorkspaces(PROJECT_NAME, CWD)
    expect(result).toEqual([])
  })
})

describe('ensureWorkspace', () => {
  it('creates workspace via shared clone', async () => {
    vi.mocked(spawn).mockReturnValueOnce(makeMockProc('') as any) // git clone --shared
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce(null as any) // wsPath doesn't exist → triggers clone
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-clone check
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ setup: ['echo hello'] })
    vi.mocked(execSync).mockReturnValue(Buffer.from('') as any)

    const result = await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME)
    expect(result.name).toBe('my-experiment')
    expect(result.path).toContain('my-experiment')
    expect(execSync).toHaveBeenCalledWith('echo hello', expect.any(Object))
  })

  it('checks out specific branch when requested', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git clone --shared
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef (git check-ref-format)
      .mockReturnValueOnce(makeMockProc('') as any) // git checkout (branch exists)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce(null as any) // wsPath doesn't exist yet → triggers clone
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-clone check
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    const result = await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME, 'develop')
    expect(result.name).toBe('my-experiment')
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('creates branch from HEAD when requested branch does not exist', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git clone --shared
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef (git check-ref-format)
      .mockReturnValueOnce(makeMockProc('', 'fatal: not a git repository', 128) as any) // git checkout fails
      .mockReturnValueOnce(makeMockProc('') as any) // git checkout -b from HEAD succeeds
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce(null as any) // wsPath doesn't exist → triggers clone
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-clone check
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    const result = await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME, 'new-feature')
    expect(result.name).toBe('my-experiment')
    expect(spawn).toHaveBeenCalledTimes(4)
    const lastCall = vi.mocked(spawn).mock.calls[3]
    expect(lastCall?.[1]).toEqual(['checkout', '-b', 'new-feature'])
  })

  it('reuses existing workspace directory', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // existing wsPath
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // .git inside
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-check stat
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    const result = await ensureWorkspace(CWD, 'existing-ws', PROJECT_NAME)
    expect(result.name).toBe('existing-ws')
  })
})

describe('getDefaultBranch', () => {
  it('returns local origin/HEAD when defined (criterion 0)', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('refs/remotes/origin/main\n') as any) // git symbolic-ref
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('main')
  })

  it('queries remote via ls-remote when origin/HEAD is not set locally (criterion 1)', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git symbolic-ref fails
      .mockReturnValueOnce(makeMockProc('ref: refs/heads/main\tHEAD\nabc123\tHEAD\n') as any) // git ls-remote --symref origin HEAD
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('main')
  })

  it('falls back to "main" when both origin/HEAD and ls-remote fail (criterion 2)', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git symbolic-ref fails
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git ls-remote fails
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('main')
  })

  it('never falls back to the current working directory branch (criterion 3)', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git symbolic-ref fails
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git ls-remote fails
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('main')
    const revParseCalls = vi
      .mocked(spawn)
      .mock.calls.filter(
        (call) => Array.isArray(call[1]) && call[1][0] === 'rev-parse' && call[1][1] === '--abbrev-ref',
      )
    expect(revParseCalls).toHaveLength(0)
  })
})

describe('resolveAndValidateSourceBranch', () => {
  it('returns local branch name when it exists locally', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git check-ref-format (validateRef)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch
      .mockReturnValueOnce(makeMockProc('abc123\n') as any) // git rev-parse local ref
    const result = await resolveAndValidateSourceBranch(CWD, 'main')
    expect(result).toBe('main')
  })

  it('creates tracking branch when branch exists on origin', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git check-ref-format (validateRef)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse local fails
      .mockReturnValueOnce(makeMockProc('abc123\n') as any) // git rev-parse remote ref succeeds
      .mockReturnValueOnce(makeMockProc('') as any) // git checkout -b from origin succeeds
    const result = await resolveAndValidateSourceBranch(CWD, 'origin/feature')
    expect(result).toBe('feature')
  })

  it('throws when branch does not exist locally or on origin', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git check-ref-format (validateRef)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse local fails
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse remote fails
    await expect(resolveAndValidateSourceBranch(CWD, 'nonexistent')).rejects.toThrow('not found')
  })

  it('throws when projectDir is provided but branch is absent from remote ls-remote (empty output)', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git check-ref-format (validateRef)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse local fails
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse remote fails
      .mockReturnValueOnce(makeMockProc('') as any) // git ls-remote succeeds but returns empty (branch absent)
    await expect(resolveAndValidateSourceBranch(CWD, 'absent-branch', '/tmp/project')).rejects.toThrow('not found')
  })
})

describe('isGitRepository', () => {
  const TEST_DIR = '/tmp/test-project'

  it('returns true when .git directory exists', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    const result = await isGitRepository(TEST_DIR)
    expect(result).toBe(true)
    expect(stat).toHaveBeenCalledWith(expect.stringContaining('.git'))
  })

  it('returns true when git rev-parse succeeds (worktree with .git file)', async () => {
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(spawn).mockReturnValueOnce(makeMockProc('/path/to/git-dir\n') as any)
    const result = await isGitRepository(TEST_DIR)
    expect(result).toBe(true)
    expect(spawn).toHaveBeenCalledWith('git', ['rev-parse', '--git-dir'], expect.anything())
  })

  it('returns false when .git does not exist and git rev-parse fails', async () => {
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(spawn).mockReturnValueOnce(makeMockProc('', 'fatal: not a git repository', 128) as any)
    const result = await isGitRepository(TEST_DIR)
    expect(result).toBe(false)
  })

  it('returns false when directory does not exist', async () => {
    vi.mocked(stat).mockRejectedValue({ code: 'ENOENT' })
    vi.mocked(spawn).mockReturnValueOnce(makeMockProc('', '', 1) as any)
    const result = await isGitRepository(TEST_DIR)
    expect(result).toBe(false)
  })

  it('returns true when git rev-parse succeeds despite .git not being a directory', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as any)
    vi.mocked(spawn).mockReturnValueOnce(makeMockProc('/path/to/git-dir\n') as any)
    const result = await isGitRepository(TEST_DIR)
    expect(result).toBe(true)
  })
})
