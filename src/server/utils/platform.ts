import os from 'node:os'

export function getPlatformShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c'] }
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