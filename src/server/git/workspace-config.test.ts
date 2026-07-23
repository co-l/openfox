import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { loadWorkspaceConfig, saveWorkspaceConfig } from './workspace-config.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/user'),
}))

vi.mock('node:crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('abc123def4567890abcdef1234567890'),
  })),
}))

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const WORKDIR = '/tmp/project'
const HASH = 'abc123def4567890'
const OLD_PATH = join(WORKDIR, '.openfox', 'workspace.json')
const NEW_DIR = join('/home/user', '.config', 'openfox', 'projects', HASH)
const NEW_PATH = join(NEW_DIR, 'workspace.json')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadWorkspaceConfig', () => {
  it('reads from new config location first', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['npm install'] }))

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toEqual({ setup: ['npm install'] })
    const readPaths = vi.mocked(readFile).mock.calls.map((c) => c[0])
    expect(readPaths[0]).toContain('.config/openfox/projects/')
    expect(readPaths[0]).toContain('workspace.json')
  })

  it('returns null when file does not exist at new location and no old config', async () => {
    vi.mocked(readFile).mockRejectedValue({ code: 'ENOENT' })

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toBeNull()
  })

  it('returns null when JSON is invalid at new location and no old config', async () => {
    vi.mocked(readFile).mockResolvedValue('not json')

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toBeNull()
  })

  it('returns null when config is empty obj at new location', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toBeNull()
  })

  it('parses valid config with setup array from new location', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['npm install --prefer-offline'] }))

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toEqual({ setup: ['npm install --prefer-offline'] })
  })

  it('parses valid config with rootDir from new location', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ rootDir: '/custom/workspaces' }))

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toEqual({ rootDir: '/custom/workspaces' })
  })
})

describe('auto-migration from old location', () => {
  it('migrates config from old .openfox/workspace.json when new location does not exist', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce({ code: 'ENOENT' })
      .mockResolvedValueOnce(JSON.stringify({ setup: ['npm install'] }))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toEqual({ setup: ['npm install'] })
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(readFile).toHaveBeenNthCalledWith(2, OLD_PATH, 'utf-8')
    expect(mkdir).toHaveBeenCalledWith(NEW_DIR, { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(
      NEW_PATH,
      JSON.stringify({ setup: ['npm install'] }, null, 2) + '\n',
      'utf-8',
    )
  })

  it('does NOT migrate when config already exists at new location', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['already migrated'] }))

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toEqual({ setup: ['already migrated'] })
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('does NOT migrate when old config is empty', async () => {
    vi.mocked(readFile).mockRejectedValueOnce({ code: 'ENOENT' }).mockResolvedValueOnce(JSON.stringify({}))

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('does NOT migrate when old config has invalid JSON', async () => {
    vi.mocked(readFile).mockRejectedValueOnce({ code: 'ENOENT' }).mockResolvedValueOnce('not json')

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('does NOT migrate when old config file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValueOnce({ code: 'ENOENT' }).mockRejectedValueOnce({ code: 'ENOENT' })

    const result = await loadWorkspaceConfig(WORKDIR)

    expect(result).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('saveWorkspaceConfig', () => {
  it('creates new config directory and writes to new location only', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, { setup: ['npm install --prefer-offline'] })

    expect(mkdir).toHaveBeenCalledWith(NEW_DIR, { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(
      NEW_PATH,
      JSON.stringify({ setup: ['npm install --prefer-offline'] }, null, 2) + '\n',
      'utf-8',
    )
  })

  it('does NOT write to old .openfox/workspace.json location', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, { setup: ['npm install'] })

    const writePaths = vi.mocked(writeFile).mock.calls.map((c) => c[0])
    for (const path of writePaths) {
      expect(path).not.toContain(join(WORKDIR, '.openfox'))
    }
  })

  it('saves config without setup', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, {})

    expect(writeFile).toHaveBeenCalledWith(NEW_PATH, JSON.stringify({}, null, 2) + '\n', 'utf-8')
  })

  it('saves config with rootDir', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, { rootDir: '/custom/workspaces' })

    expect(writeFile).toHaveBeenCalledWith(
      NEW_PATH,
      JSON.stringify({ rootDir: '/custom/workspaces' }, null, 2) + '\n',
      'utf-8',
    )
  })

  it('saves config with both rootDir and setup', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, { rootDir: '/custom/workspaces', setup: ['npm install'] })

    expect(writeFile).toHaveBeenCalledWith(
      NEW_PATH,
      JSON.stringify({ rootDir: '/custom/workspaces', setup: ['npm install'] }, null, 2) + '\n',
      'utf-8',
    )
  })
})

describe('config path computation', () => {
  it('uses sha256(workdir).slice(0,16) for the projects subdirectory', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['npm install'] }))

    await loadWorkspaceConfig(WORKDIR)

    expect(createHash).toHaveBeenCalledWith('sha256')
    const readPaths = vi.mocked(readFile).mock.calls.map((c) => c[0])
    expect(readPaths[0]).toContain(HASH)
  })

  it('resolves workdir before hashing', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['npm install'] }))

    await loadWorkspaceConfig(WORKDIR)

    const hashInstance = (createHash as ReturnType<typeof vi.fn>).mock.results[0]?.value
    expect(hashInstance.update).toHaveBeenCalled()
  })

  it('stores config under XDG_CONFIG_HOME/openfox/projects/{hash}/', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['lint'] }))

    await loadWorkspaceConfig(WORKDIR)

    const readPaths = vi.mocked(readFile).mock.calls.map((c) => c[0])
    expect(readPaths[0]).toContain('.config/openfox/projects/')
  })
})

describe('signature compatibility', () => {
  it('loadWorkspaceConfig accepts single workdir argument', () => {
    expect(loadWorkspaceConfig).toHaveLength(1)
  })

  it('saveWorkspaceConfig accepts two arguments (workdir, config)', () => {
    expect(saveWorkspaceConfig).toHaveLength(2)
  })
})
