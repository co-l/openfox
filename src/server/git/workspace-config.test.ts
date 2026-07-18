import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { loadWorkspaceConfig, saveWorkspaceConfig } from './workspace-config.js'

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

describe('loadWorkspaceConfig', () => {
  it('returns null when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue({ code: 'ENOENT' })
    const result = await loadWorkspaceConfig(WORKDIR)
    expect(result).toBeNull()
  })

  it('returns null when JSON is invalid', async () => {
    vi.mocked(readFile).mockResolvedValue('not json')
    const result = await loadWorkspaceConfig(WORKDIR)
    expect(result).toBeNull()
  })

  it('returns null when setup is missing', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({}))
    const result = await loadWorkspaceConfig(WORKDIR)
    expect(result).toBeNull()
  })

  it('parses valid config with setup array', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ setup: ['npm install --prefer-offline'] }))
    const result = await loadWorkspaceConfig(WORKDIR)
    expect(result).toEqual({ setup: ['npm install --prefer-offline'] })
  })
})

describe('saveWorkspaceConfig', () => {
  it('creates .openfox directory and writes config', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, { setup: ['npm install --prefer-offline'] })

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.openfox'), { recursive: true })
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(join('.openfox', 'workspace.json')),
      JSON.stringify({ setup: ['npm install --prefer-offline'] }, null, 2) + '\n',
      'utf-8',
    )
  })

  it('saves config without setup', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await saveWorkspaceConfig(WORKDIR, {})

    expect(writeFile).toHaveBeenCalledWith(expect.any(String), JSON.stringify({}, null, 2) + '\n', 'utf-8')
  })
})
