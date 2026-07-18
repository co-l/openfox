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
  // cmd.exe: Node's default arg quoting escapes inner double quotes with
  // backslashes, which cmd does not understand — commands like
  // node -e "..." silently break. Mimic what Node itself does for
  // { shell: true }: /d /s /c + the whole command wrapped in quotes,
  // passed verbatim.
  const isCmd = shell.command === 'cmd.exe'
  const args = isCmd ? ['/d', '/s', '/c', `"${command}"`] : [...shell.args, command]
  return spawn(shell.command, args, {
    ...(isCmd ? { windowsVerbatimArguments: true } : {}),
    cwd: options.cwd,
    env: { ...process.env },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // detached is only useful for Unix process-group semantics; on win32 it
    // spawns a visible console window and makes MSYS binaries (tail, sleep)
    // hang on pipes. Tree-kill uses taskkill on win32, so detached is unneeded.
    ...(options.detached && process.platform !== 'win32' ? { detached: true } : {}),
  })
}

export function spawnShellProcess(command: string, cwd: string, _signal?: AbortSignal, detached = false): ChildProcess {
  return spawnShell(command, { cwd, detached })
}
