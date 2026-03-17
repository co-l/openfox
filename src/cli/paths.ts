import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { mkdir, access } from 'node:fs/promises'
import type { Mode } from './main.js'

export function getGlobalConfigDir(mode: Mode): string {
  const suffix = mode === 'development' ? '-dev' : ''
  const home = homedir()
  
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', `openfox${suffix}`)
    case 'win32':
      return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), `openfox${suffix}`)
    default:
      return join(process.env['XDG_CONFIG_HOME'] ?? join(home, '.config'), `openfox${suffix}`)
  }
}

export function getGlobalConfigPath(mode: Mode): string {
  return join(getGlobalConfigDir(mode), 'config.json')
}

export function getGlobalDataDir(mode: Mode): string {
  const suffix = mode === 'development' ? '-dev' : ''
  const home = homedir()
  
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', `openfox${suffix}`)
    case 'win32':
      return join(process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), `openfox${suffix}`)
    default:
      return join(process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), `openfox${suffix}`)
  }
}

export function getDatabasePath(mode: Mode): string {
  return join(getGlobalDataDir(mode), 'sessions.db')
}

export async function ensureDataDirExists(mode: Mode): Promise<void> {
  const dataDir = getGlobalDataDir(mode)
  try {
    await access(dataDir)
  } catch {
    await mkdir(dataDir, { recursive: true })
  }
}
