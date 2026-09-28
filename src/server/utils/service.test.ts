import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spawnSync } from 'node:child_process'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

import { spawnSync as mockedSpawnSync } from 'node:child_process'
import { isRunningAsService, resetServiceDetectionCache } from './service.js'

const mockSpawnSync = vi.mocked(mockedSpawnSync)

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function setServiceEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env['OPENFOX_SERVICE']
  } else {
    process.env['OPENFOX_SERVICE'] = value
  }
}

const originalPlatform = process.platform
const originalServiceEnv = process.env['OPENFOX_SERVICE']

describe('isRunningAsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServiceDetectionCache()
    setPlatform('linux')
    setServiceEnv(undefined)
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 1,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)
  })

  afterEach(() => {
    setPlatform(originalPlatform)
    setServiceEnv(originalServiceEnv)
    resetServiceDetectionCache()
    vi.restoreAllMocks()
  })

  it('returns true when OPENFOX_SERVICE=true without invoking systemctl', () => {
    setServiceEnv('true')

    expect(isRunningAsService()).toBe(true)
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  it('returns false on Linux when OPENFOX_SERVICE is absent and systemctl reports inactive', () => {
    setServiceEnv(undefined)
    mockSpawnSync.mockReturnValue({
      stdout: 'inactive\n',
      stderr: '',
      status: 1,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)

    expect(isRunningAsService()).toBe(false)
    expect(mockSpawnSync).toHaveBeenCalledTimes(1)
    expect(mockSpawnSync).toHaveBeenCalledWith('systemctl', ['--user', 'is-active', 'openfox'], {
      encoding: 'utf-8',
      windowsHide: true,
    })
  })

  it('returns true on Linux when OPENFOX_SERVICE is absent and systemctl reports active', () => {
    setServiceEnv(undefined)
    mockSpawnSync.mockReturnValue({
      stdout: 'active\n',
      stderr: '',
      status: 0,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)

    expect(isRunningAsService()).toBe(true)
    expect(mockSpawnSync).toHaveBeenCalledTimes(1)
  })

  it('returns false on Linux when systemctl is missing (ENOENT) without throwing', () => {
    setServiceEnv(undefined)
    mockSpawnSync.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync systemctl ENOENT'), { code: 'ENOENT' })
    })

    expect(isRunningAsService()).toBe(false)
  })

  it('returns false on Windows without invoking systemctl', () => {
    setServiceEnv(undefined)
    setPlatform('win32')

    expect(isRunningAsService()).toBe(false)
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  it('returns false on macOS without invoking systemctl', () => {
    setServiceEnv(undefined)
    setPlatform('darwin')

    expect(isRunningAsService()).toBe(false)
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  it('prioritises OPENFOX_SERVICE=true over an inactive systemctl report on Linux', () => {
    setServiceEnv('true')
    mockSpawnSync.mockReturnValue({
      stdout: 'inactive\n',
      stderr: '',
      status: 1,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)

    expect(isRunningAsService()).toBe(true)
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })

  it('caches the systemctl result so a second call does not fork again', () => {
    setServiceEnv(undefined)
    mockSpawnSync.mockReturnValue({
      stdout: 'active\n',
      stderr: '',
      status: 0,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)

    expect(isRunningAsService()).toBe(true)
    expect(isRunningAsService()).toBe(true)
    expect(isRunningAsService()).toBe(true)
    expect(mockSpawnSync).toHaveBeenCalledTimes(1)
  })

  it('resetServiceDetectionCache forces a fresh systemctl probe', () => {
    setServiceEnv(undefined)
    mockSpawnSync.mockReturnValue({
      stdout: 'active\n',
      stderr: '',
      status: 0,
      pid: 0,
      output: [],
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>)

    expect(isRunningAsService()).toBe(true)
    expect(mockSpawnSync).toHaveBeenCalledTimes(1)

    resetServiceDetectionCache()
    expect(isRunningAsService()).toBe(true)
    expect(mockSpawnSync).toHaveBeenCalledTimes(2)
  })
})
