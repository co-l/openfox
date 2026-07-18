import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { loadWorktreeConfig, saveWorktreeConfig } from './worktree-config.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

import { readFile, writeFile, mkdir } from 'node:fs/promises'

const WORKDIR = '/tmp/project'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadWorktreeConfig', () => {
  it('returns null when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue({ code: 'ENOENT' })
    const result = await loadWorktreeConfig(WORKDIR)
    expect(result).toBeNull()
  })

  it('returns null when JSON is invalid', async () => {
    vi.mocked(readFile).mockResolvedValue('not json')
    const result = await loadWorktreeConfig(WORKDIR)
    expect(result).toBeNull()
  })

  it('returns null when ignoredAssets is missing', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))
    const result = await loadWorktreeConfig(WORKDIR)
    expect(result).toBeNull()
  })

  it('parses valid config with defaults', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ignoredAssets: 'symlink' }))
    const result = await loadWorktreeConfig(WORKDIR)
    expect(result).toEqual({ ignoredAssets: 'symlink', overrides: undefined })
  })

  it('parses config with overrides', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ ignoredAssets: 'copy', overrides: { node_modules: 'symlink' } }),
    )
    const result = await loadWorktreeConfig(WORKDIR)
    expect(result).toEqual({ ignoredAssets: 'copy', overrides: { node_modules: 'symlink' } })
  })
})

describe('saveWorktreeConfig', () => {
  it('creates .openfox directory and writes config', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorktreeConfig(WORKDIR, { ignoredAssets: 'copy', overrides: { node_modules: 'symlink' } })

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.openfox'), { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(join('.openfox', 'worktree.json')),
      JSON.stringify({ ignoredAssets: 'copy', overrides: { node_modules: 'symlink' } }, null, 2) + '\n',
      'utf-8',
    )
  })

  it('saves config without overrides', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorktreeConfig(WORKDIR, { ignoredAssets: 'symlink' })

    expect(writeFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ ignoredAssets: 'symlink' }, null, 2) + '\n',
      'utf-8',
    )
  })
})
