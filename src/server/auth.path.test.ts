import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../shared/types.js'
import { loadServerAuthConfig, resetAuthCache, tokenFromPassword } from './auth.js'
import { setRuntimeConfig } from './runtime-config.js'
import { getGlobalConfigDir } from '../cli/paths.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    mode: 'production',
    llm: { baseUrl: '', model: '', backend: 'unknown', timeout: 300000, idleTimeout: 300000 },
    context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 120000 },
    server: { port: 0, host: '127.0.0.1' },
    database: { path: ':memory:' },
    logging: { level: 'error' },
    workdir: '/tmp',
    ...overrides,
  }
}

describe('auth path resolution', () => {
  beforeEach(() => {
    resetAuthCache()
    vi.clearAllMocks()
  })

  it('reads auth.json from the explicit authDir', async () => {
    const authDir = join('config', 'openfox')
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword: 'x' }))
    setRuntimeConfig(makeConfig({ authDir }))

    await loadServerAuthConfig()

    expect(vi.mocked(readFile).mock.calls[0]?.[0]).toBe(join(authDir, 'auth.json'))
  })

  it('creates the private key inside the explicit authDir', async () => {
    const authDir = join('C:', 'repo', 'e2e', '.openfox-test')
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)
    setRuntimeConfig(makeConfig({ mode: 'test', authDir }))

    await tokenFromPassword('password')

    expect(vi.mocked(mkdir).mock.calls[0]?.[0]).toBe(authDir)
    expect(vi.mocked(writeFile).mock.calls[0]?.[0]).toBe(join(authDir, 'auth.key'))
  })

  it('falls back to the platform config dir when authDir is not set', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ strategy: 'network', encryptedPassword: 'x' }))
    setRuntimeConfig(makeConfig({}))

    await loadServerAuthConfig()

    expect(vi.mocked(readFile).mock.calls[0]?.[0]).toBe(join(getGlobalConfigDir('production'), 'auth.json'))
  })
})
