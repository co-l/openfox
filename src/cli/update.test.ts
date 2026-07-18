import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { spawnSync } from 'node:child_process'

const mockSpawnSync = vi.fn<(...args: Parameters<typeof spawnSync>) => ReturnType<typeof spawnSync>>()

vi.mock('node:child_process', () => ({
  spawnSync: (...args: Parameters<typeof spawnSync>) => mockSpawnSync(...args),
}))

vi.mock('../constants.js', () => ({
  VERSION: '1.0.0',
}))

function spawnResult(status: number, stdout = ''): ReturnType<typeof spawnSync> {
  return { status, stdout, stderr: '', pid: 0, output: [], signal: null } as unknown as ReturnType<typeof spawnSync>
}

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('runUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    setPlatform(realPlatform)
    vi.restoreAllMocks()
  })

  it('returns 1 when the version check fails, without installing', async () => {
    mockSpawnSync.mockReturnValue(spawnResult(1))
    const { runUpdate } = await import('./update.js')

    expect(runUpdate()).toBe(1)
    expect(mockSpawnSync).toHaveBeenCalledTimes(1)
  })

  it('does nothing when already at the latest version', async () => {
    mockSpawnSync.mockReturnValue(spawnResult(0, '1.0.0\n'))
    const { runUpdate } = await import('./update.js')

    expect(runUpdate()).toBe(0)
    expect(mockSpawnSync).toHaveBeenCalledTimes(1)
  })

  it('installs the latest version and reports it', async () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult(0, '2.0.0\n')).mockReturnValueOnce(spawnResult(0))
    const { runUpdate } = await import('./update.js')

    expect(runUpdate()).toBe(0)
    expect(mockSpawnSync).toHaveBeenCalledTimes(2)
    // The auto-update route parses this exact line from stdout
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('Updated: 2.0.0')
  })

  it('returns 1 when the install fails', async () => {
    mockSpawnSync.mockReturnValueOnce(spawnResult(0, '2.0.0\n')).mockReturnValueOnce(spawnResult(1))
    const { runUpdate } = await import('./update.js')

    expect(runUpdate()).toBe(1)
  })

  it('spawns npm with an args array and no shell on non-Windows', async () => {
    setPlatform('linux')
    mockSpawnSync.mockReturnValue(spawnResult(0, '1.0.0\n'))
    const { runUpdate } = await import('./update.js')
    runUpdate()

    const [cmd, args, opts] = mockSpawnSync.mock.calls[0]!
    expect(cmd).toBe('npm')
    expect(args).toEqual(['view', 'openfox', 'version'])
    expect((opts as { shell?: boolean }).shell).toBe(false)
  })

  it('spawns a single command string through the shell on Windows (npm.cmd not directly spawnable)', async () => {
    setPlatform('win32')
    mockSpawnSync.mockReturnValue(spawnResult(0, '1.0.0\n'))
    const { runUpdate } = await import('./update.js')
    runUpdate()

    const [cmd, args, opts] = mockSpawnSync.mock.calls[0]!
    expect(cmd).toBe('npm view openfox version')
    expect(args).toEqual([])
    expect((opts as { shell?: boolean }).shell).toBe(true)
  })
})
