import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPathSeparator, isWindowsPath, isAbsolutePath, getPlatformShell, listAvailableShells } from './platform.js'

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(() => null),
  SETTINGS_KEYS: { TOOLS_SHELL: 'tools.shell' },
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => false) }
})

import { getSetting } from '../db/settings.js'
import { existsSync } from 'node:fs'

function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('getPathSeparator', () => {
  it('returns ; on windows', () => {
    expect(getPathSeparator()).toBe(process.platform === 'win32' ? ';' : ':')
  })
})

describe('isWindowsPath', () => {
  it('returns true for Windows drive paths', () => {
    expect(isWindowsPath('C:\\Users\\test')).toBe(true)
    expect(isWindowsPath('C:/Users/test')).toBe(true)
    expect(isWindowsPath('D:\\Program Files')).toBe(true)
    expect(isWindowsPath('E:/')).toBe(true)
  })

  it('returns false for Unix paths', () => {
    expect(isWindowsPath('/home/user')).toBe(false)
    expect(isWindowsPath('/tmp')).toBe(false)
  })

  it('returns false for relative paths', () => {
    expect(isWindowsPath('relative/path')).toBe(false)
    expect(isWindowsPath('file.txt')).toBe(false)
  })
})

describe('getPlatformShell (win32 shell setting)', () => {
  const realPlatform = process.platform
  const realProgramFiles = process.env['ProgramFiles']

  beforeEach(() => {
    mockPlatform('win32')
    vi.mocked(getSetting).mockReturnValue(null)
    vi.mocked(existsSync).mockReturnValue(false)
    process.env['ProgramFiles'] = 'C:\\Program Files'
  })

  afterEach(() => {
    mockPlatform(realPlatform)
    if (realProgramFiles) {
      process.env['ProgramFiles'] = realProgramFiles
    } else {
      delete process.env['ProgramFiles']
    }
    vi.clearAllMocks()
  })

  it('defaults to cmd.exe when no setting', () => {
    expect(getPlatformShell()).toEqual({ command: 'cmd.exe', args: ['/c'] })
  })

  it('uses cmd.exe when setting is cmd', () => {
    vi.mocked(getSetting).mockReturnValue('cmd')
    expect(getPlatformShell()).toEqual({ command: 'cmd.exe', args: ['/c'] })
  })

  it('uses powershell when setting is powershell', () => {
    vi.mocked(getSetting).mockReturnValue('powershell')
    expect(getPlatformShell()).toEqual({ command: 'powershell.exe', args: ['-NoProfile', '-Command'] })
  })

  it('uses Git Bash when setting is gitbash and bash.exe is found', () => {
    vi.mocked(getSetting).mockReturnValue('gitbash')
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('bash.exe'))
    const shell = getPlatformShell()
    expect(shell.command.endsWith('bash.exe')).toBe(true)
    expect(shell.args).toEqual(['-c'])
  })

  it('falls back to cmd.exe when setting is gitbash but bash.exe is missing', () => {
    vi.mocked(getSetting).mockReturnValue('gitbash')
    expect(getPlatformShell()).toEqual({ command: 'cmd.exe', args: ['/c'] })
  })

  it('ignores the setting on non-Windows platforms', () => {
    mockPlatform('linux')
    vi.mocked(getSetting).mockReturnValue('powershell')
    const shell = getPlatformShell()
    expect(shell.command).not.toBe('powershell.exe')
    expect(shell.args[shell.args.length - 1]).toBe('-c')
  })
})

describe('listAvailableShells', () => {
  const realPlatform = process.platform
  const realProgramFiles = process.env['ProgramFiles']

  beforeEach(() => {
    process.env['ProgramFiles'] = 'C:\\Program Files'
  })

  afterEach(() => {
    mockPlatform(realPlatform)
    if (realProgramFiles) {
      process.env['ProgramFiles'] = realProgramFiles
    } else {
      delete process.env['ProgramFiles']
    }
    vi.clearAllMocks()
  })

  it('returns empty list on non-Windows', () => {
    mockPlatform('linux')
    expect(listAvailableShells()).toEqual([])
  })

  it('lists cmd and powershell as always available on Windows', () => {
    mockPlatform('win32')
    vi.mocked(existsSync).mockReturnValue(false)
    const shells = listAvailableShells()
    expect(shells.find((s) => s.id === 'cmd')?.available).toBe(true)
    expect(shells.find((s) => s.id === 'powershell')?.available).toBe(true)
    expect(shells.find((s) => s.id === 'gitbash')?.available).toBe(false)
  })

  it('marks gitbash available when bash.exe is found', () => {
    mockPlatform('win32')
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('bash.exe'))
    expect(listAvailableShells().find((s) => s.id === 'gitbash')?.available).toBe(true)
  })
})

describe('isAbsolutePath', () => {
  it('returns true for Unix absolute paths', () => {
    expect(isAbsolutePath('/home/user')).toBe(true)
    expect(isAbsolutePath('/tmp')).toBe(true)
    expect(isAbsolutePath('/')).toBe(true)
  })

  it('returns true for Windows absolute paths', () => {
    expect(isAbsolutePath('C:\\Users\\test')).toBe(true)
    expect(isAbsolutePath('C:/Users/test')).toBe(true)
    expect(isAbsolutePath('D:\\')).toBe(true)
  })

  it('returns false for relative paths', () => {
    expect(isAbsolutePath('relative/path')).toBe(false)
    expect(isAbsolutePath('file.txt')).toBe(false)
    expect(isAbsolutePath('./file')).toBe(false)
  })
})
