import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { getPlatformShell } from './platform.js'

export function checkAborted(signal: AbortSignal | undefined): boolean {
  return !!signal?.aborted
}

export interface SpawnShellOptions {
  cwd: string
  detached?: boolean
  stdio?: StdioOptions
}

export function spawnShell(command: string, options: SpawnShellOptions): ChildProcess {
  const shell = getPlatformShell()
  return spawn(shell.command, [...shell.args, command], {
    cwd: options.cwd,
    env: { ...process.env },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...(options.detached ? { detached: true } : {}),
  })
}

export function spawnShellProcess(command: string, cwd: string, _signal?: AbortSignal, detached = false): ChildProcess {
  return spawnShell(command, { cwd, detached })
}
