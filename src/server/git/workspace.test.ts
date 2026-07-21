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

import { spawn, execSync } from 'node:child_process'
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'
import { loadWorkspaceConfig } from './workspace-config.js'

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
    vi.mocked(loadWorkspaceConfig).mockResolvedValue(null)
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toContain('workspaces')
    expect(dir).toContain(PROJECT_NAME)
  })

  it('returns global fallback when config has no rootDir', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ setup: ['npm install'] })
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toContain('workspaces')
    expect(dir).toContain(PROJECT_NAME)
  })

  it('uses absolute rootDir directly from config', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootDir: '/custom/workspace/path' })
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toBe('/custom/workspace/path')
  })

  it('resolves relative rootDir against projectDir', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootDir: './my-workspaces' })
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toBe(resolve(CWD, 'my-workspaces'))
  })

  it('resolves parent-relative rootDir correctly', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootDir: '../shared-workspaces' })
    const dir = await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(dir).toBe(resolve(CWD, '../shared-workspaces'))
  })

  it('calls loadWorkspaceConfig with projectDir', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue(null)
    await getWorkspacesDir(PROJECT_NAME, CWD)
    expect(loadWorkspaceConfig).toHaveBeenCalledWith(CWD)
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

  it('uses getDefaultBranch as source when requested branch does not exist', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git clone --shared
      .mockReturnValueOnce(makeMockProc('') as any) // validateRef (git check-ref-format)
      .mockReturnValueOnce(makeMockProc('', 'fatal: not a git repository', 128) as any) // git checkout fails
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch origin --no-tags --quiet (getDefaultBranch)
      .mockReturnValueOnce(makeMockProc('refs/remotes/origin/main\n') as any) // git symbolic-ref origin/HEAD (getDefaultBranch)
      .mockReturnValueOnce(makeMockProc('') as any) // git checkout -b succeeds
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce(null as any) // wsPath doesn't exist → triggers clone
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-clone check
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    const result = await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME, 'new-feature')
    expect(result.name).toBe('my-experiment')
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
  it('returns origin/HEAD after fetch', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('refs/remotes/origin/main\n') as any) // git symbolic-ref
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('main')
  })

  it('falls back to current branch when origin/HEAD is not set', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git symbolic-ref fails
      .mockReturnValueOnce(makeMockProc('develop\n') as any) // git rev-parse (current branch)
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('develop')
  })

  it('falls back to "main" when nothing else works', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('') as any) // git fetch (runGit)
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git symbolic-ref fails
      .mockReturnValueOnce(makeMockProc('', '', 1) as any) // git rev-parse fails
    const result = await getDefaultBranch(CWD)
    expect(result).toBe('main')
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
