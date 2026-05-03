import { spawn } from 'node:child_process'
import { getPlatformShell } from './platform.js'

export function checkAborted(signal: AbortSignal | undefined): boolean {
  return !!signal?.aborted
}

export function spawnShellProcess(
  command: string,
  cwd: string,
  _signal?: AbortSignal,
  detached = false,
): ReturnType<typeof spawn> {
  const shell = getPlatformShell()
  return spawn(shell.command, [...shell.args, command], {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(detached ? { detached: true } : {}),
  })
}
