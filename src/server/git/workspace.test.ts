import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getGitBranch,
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

import { spawn, execSync } from 'node:child_process'
import { readFile, readdir, mkdir, stat } from 'node:fs/promises'

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
  it('returns path under global data dir', () => {
    const dir = getWorkspacesDir(PROJECT_NAME)
    expect(dir).toContain('workspaces')
    expect(dir).toContain(PROJECT_NAME)
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
    const result = await listWorkspaces(PROJECT_NAME)
    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe('add-feature')
    expect(result[1]?.name).toBe('fix-bug')
    expect(result[0]?.branch).toBe('main')
  })

  it('returns empty on error', async () => {
    vi.mocked(readdir).mockRejectedValue({ code: 'ENOENT' })
    const result = await listWorkspaces(PROJECT_NAME)
    expect(result).toEqual([])
  })
})

describe('ensureWorkspace', () => {
  it('creates workspace via shared clone', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('false\n') as any) // core.bare check
      .mockReturnValueOnce(makeMockProc('') as any) // git clone
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce(null as any) // wsPath doesn't exist → triggers clone
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-clone check
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['echo hello'] }))
    vi.mocked(execSync).mockReturnValue(Buffer.from('') as any)

    const result = await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME)
    expect(result.name).toBe('my-experiment')
    expect(result.path).toContain('my-experiment')
    expect(execSync).toHaveBeenCalledWith('echo hello', expect.any(Object))
  })

  it('checks out specific branch when requested', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('false\n') as any) // core.bare check
      .mockReturnValueOnce(makeMockProc('') as any) // git clone
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

  it('creates branch in workspace when requested branch does not exist', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('false\n') as any) // core.bare check
      .mockReturnValueOnce(makeMockProc('') as any) // git clone
      .mockReturnValueOnce(makeMockProc('', 'fatal: not a git repository', 128) as any) // git checkout fails
      .mockReturnValueOnce(makeMockProc('main\n') as any) // getGitBranch (source)
      .mockReturnValueOnce(makeMockProc('') as any) // git checkout -b succeeds
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat)
      .mockResolvedValueOnce(null as any) // wsPath doesn't exist → triggers clone
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // post-clone check
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    const result = await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME, 'new-feature')
    expect(result.name).toBe('my-experiment')
  })

  it('fixes core.bare if set to true', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockProc('true\n') as any) // core.bare check → true
      .mockReturnValueOnce(makeMockProc('') as any) // git config core.bare false
      .mockReturnValueOnce(makeMockProc('') as any) // git clone
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    await ensureWorkspace(CWD, 'my-experiment', PROJECT_NAME)
    // Second call should be the fix
    expect(spawn).toHaveBeenNthCalledWith(2, 'git', ['config', 'core.bare', 'false'], expect.any(Object))
  })

  it('reuses existing workspace directory', async () => {
    vi.mocked(spawn).mockReturnValueOnce(makeMockProc('false\n') as any) // core.bare check
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
