import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { spawnSync, spawn } from 'node:child_process'
import { runServiceCommand } from './service.js'

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
  constants: { F_OK: 0 },
}))

const mockSpawnSync = vi.fn<(...args: Parameters<typeof spawnSync>) => ReturnType<typeof spawnSync>>()
const mockSpawn = vi.fn<(...args: Parameters<typeof spawn>) => ReturnType<typeof spawn>>()

vi.mock('node:child_process', () => ({
  spawnSync: (...args: Parameters<typeof spawnSync>) => mockSpawnSync(...args),
  spawn: (...args: Parameters<typeof spawn>) => mockSpawn(...args),
}))

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('service on Windows', () => {
  afterEach(() => {
    setPlatform(realPlatform)
    process.exitCode = 0
  })

  it('prints a clear unsupported message and exits 1 without spawning anything', async () => {
    setPlatform('win32')
    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runServiceCommand('production', 'status')

    expect(mockLog.mock.calls.flat().join('\n')).toContain('not supported on Windows')
    expect(process.exitCode).toBe(1)
    expect(mockSpawnSync).not.toHaveBeenCalled()
    expect(mockSpawn).not.toHaveBeenCalled()
    mockLog.mockRestore()
  })
})

describe('service logs', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // The systemd path under test is Unix-only; pin the platform so the suite
    // also runs on Windows dev machines (the win32 guard would short-circuit).
    setPlatform('linux')
    const { access } = vi.mocked(await import('node:fs/promises'))
    access.mockResolvedValue(undefined)
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('uses spawnSync when no follow flag given', async () => {
    mockSpawnSync.mockReturnValue({
      stdout: 'log line 1\nlog line 2\n',
      stderr: '',
      status: 0,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)

    await runServiceCommand('production', 'logs')

    expect(mockSpawnSync).toHaveBeenCalledWith('journalctl', ['--user', '-u', 'openfox', '-n', '50', '--no-pager'], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('uses spawn with -f when -f flag given', async () => {
    await runServiceCommand('production', 'logs', '-f')

    expect(mockSpawn).toHaveBeenCalledWith('journalctl', ['--user', '-u', 'openfox', '-f', '--no-pager'], {
      stdio: 'inherit',
      windowsHide: true,
    })
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  it('uses spawn with -f when --follow flag given', async () => {
    await runServiceCommand('production', 'logs', '--follow')

    expect(mockSpawn).toHaveBeenCalledWith('journalctl', ['--user', '-u', 'openfox', '-f', '--no-pager'], {
      stdio: 'inherit',
      windowsHide: true,
    })
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })
})
