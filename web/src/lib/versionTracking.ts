/**
 * Version tracking helpers.
 *
 * `trackVersion` is the single place where the last-seen version is recorded.
 * Whenever it observes an actual change, the previous value is preserved in a
 * durable key so the changelog can later be trimmed to only what changed since
 * the version the user previously ran — regardless of which window performed
 * or observed the update.
 */

const LAST_VERSION_KEY = 'openfox_last_version'
export const PREVIOUS_VERSION_KEY = 'openfox_previous_version'

export function getStoredLastVersion(): string | null {
  return localStorage.getItem(LAST_VERSION_KEY)
}

export function getStoredPreviousVersion(): string | null {
  return localStorage.getItem(PREVIOUS_VERSION_KEY)
}

export function stampPreviousVersion(version: string | null): void {
  if (version) localStorage.setItem(PREVIOUS_VERSION_KEY, version)
}

export function trackVersion(currentVersion: string | null): void {
  if (!currentVersion) return
  const last = getStoredLastVersion()
  if (last && last !== currentVersion) {
    stampPreviousVersion(last)
  }
  localStorage.setItem(LAST_VERSION_KEY, currentVersion)
}

export function isVersionNewerThan(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  if (
    pa.length !== 3 ||
    pb.length !== 3 ||
    pa.some((num) => !Number.isInteger(num)) ||
    pb.some((num) => !Number.isInteger(num))
  ) {
    return false
  }
  for (let i = 0; i < 3; i++) {
    const x = pa[i]!
    const y = pb[i]!
    if (x !== y) return x > y
  }
  return false
}
