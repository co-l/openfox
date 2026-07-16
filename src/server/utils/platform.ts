import os from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'

export interface ShellConfig {
  command: string
  args: string[]
}

export interface ShellOption {
  id: string
  label: string
  available: boolean
}

/**
 * Locate Git Bash on Windows (bundled with Git for Windows).
 * Checks the standard install locations for bash.exe.
 */
export function findGitBash(): string | null {
  const candidates = [
    process.env['ProgramFiles'] && join(process.env['ProgramFiles'], 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env['LocalAppData'] && join(process.env['LocalAppData'], 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter((p): p is string => !!p)
  return candidates.find((p) => existsSync(p)) ?? null
}

const CMD_SHELL: ShellConfig = { command: 'cmd.exe', args: ['/c'] }

const WINDOWS_SHELLS: Record<string, () => ShellConfig | null> = {
  cmd: () => CMD_SHELL,
  powershell: () => ({ command: 'powershell.exe', args: ['-NoProfile', '-Command'] }),
  gitbash: () => {
    const bash = findGitBash()
    return bash ? { command: bash, args: ['-c'] } : null
  },
}

/**
 * Shells the user can pick from in Settings > Tools (Windows only).
 * Empty on other platforms, where the user's login shell is used.
 */
export function listAvailableShells(): ShellOption[] {
  if (process.platform !== 'win32') {
    return []
  }
  return [
    { id: 'cmd', label: 'cmd.exe', available: true },
    { id: 'powershell', label: 'PowerShell', available: true },
    { id: 'gitbash', label: 'Git Bash', available: findGitBash() !== null },
  ]
}

export function getPlatformShell(): ShellConfig {
  if (process.platform === 'win32') {
    const choice = getSetting(SETTINGS_KEYS.TOOLS_SHELL) ?? 'cmd'
    // Unknown value or Git Bash not installed anymore: fall back to cmd.exe
    return WINDOWS_SHELLS[choice]?.() ?? CMD_SHELL
  }

  const userShell = os.userInfo().shell
  if (userShell) {
    return { command: userShell, args: ['-c'] }
  }

  return { command: 'sh', args: ['-c'] }
}

export function getPathSeparator(): string {
  return process.platform === 'win32' ? ';' : ':'
}

export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(path)
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || isWindowsPath(path)
}
