import { spawnSync } from 'node:child_process'
import { VERSION } from '../constants.js'

/**
 * Run npm with fixed args. On Windows npm is npm.cmd, which Node refuses to
 * spawn directly (CVE-2024-27980), so go through the shell — as a single
 * command string to avoid DEP0190 (args are fixed literals, no injection).
 */
function npm(args: string[], inherit = false): { ok: boolean; stdout: string } {
  const win = process.platform === 'win32'
  const result = spawnSync(win ? ['npm', ...args].join(' ') : 'npm', win ? [] : args, {
    encoding: 'utf-8',
    ...(inherit ? { stdio: 'inherit' as const } : {}),
    shell: win,
    windowsHide: true,
  })
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() }
}

export function runUpdate(): number {
  const view = npm(['view', 'openfox', 'version'])
  if (!view.ok) {
    console.error('Failed to check the latest version (npm view openfox version)')
    return 1
  }
  const latest = view.stdout

  if (VERSION === latest) {
    console.log(`OpenFox is already at the latest version: ${VERSION}`)
    return 0
  }

  console.log(`Updating OpenFox: ${VERSION} -> ${latest}`)
  if (!npm(['install', '-g', 'openfox@latest'], true).ok) {
    return 1
  }
  console.log(`Updated: ${latest}`)
  console.log('Please restart OpenFox to use the new version.')
  return 0
}
