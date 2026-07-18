import { readFileSync } from 'node:fs'

export interface WslInfo {
  isWSL: boolean
  wslDistro: string
}

let cached: WslInfo | null = null

function readEtcOsRelease(): Record<string, string> | null {
  try {
    const content = readFileSync('/etc/os-release', 'utf-8')
    const result: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/)
      if (m) {
        let val = m[2] ?? ''
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        result[m[1]!] = val
      }
    }
    return result
  } catch {
    return null
  }
}

export function detectWsl(): WslInfo {
  if (cached) return cached

  if (process.platform === 'win32') {
    cached = { isWSL: false, wslDistro: '' }
    return cached
  }

  const distro = process.env['WSL_DISTRO_NAME']
  if (distro) {
    cached = { isWSL: true, wslDistro: distro }
    return cached
  }

  try {
    const osrelease = readFileSync('/proc/sys/kernel/osrelease', 'utf-8')
    if (osrelease.toLowerCase().includes('wsl') || osrelease.toLowerCase().includes('microsoft')) {
      const osInfo = readEtcOsRelease()
      const name = osInfo?.['NAME'] ?? 'Ubuntu'
      cached = { isWSL: true, wslDistro: name }
      return cached
    }
  } catch {
    // Not running on Linux with /proc — not WSL
  }

  cached = { isWSL: false, wslDistro: '' }
  return cached
}
