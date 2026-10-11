import { spawnSync } from 'node:child_process'

let cached: boolean | null = null

export function resetServiceDetectionCache(): void {
  cached = null
}

export function isRunningAsService(): boolean {
  if (cached !== null) return cached

  if (process.env['OPENFOX_SERVICE'] === 'true') {
    cached = true
    return true
  }

  if (process.platform !== 'linux') {
    cached = false
    return false
  }

  try {
    const result = spawnSync('systemctl', ['--user', 'is-active', 'openfox'], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    cached = result.status === 0
  } catch {
    cached = false
  }

  return cached
}
