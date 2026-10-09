import { access } from 'node:fs/promises'
import { DRIVES_VIEW, type DirectoryEntry } from '../../shared/directory.js'

type DriveProbe = (path: string) => Promise<void>
type Platform = NodeJS.Platform

/** Whether a win32 path is a drive root (`D:\`), not drive-relative (`D:`) or a subdirectory. */
export function isDriveRootPath(path: string): boolean {
  return /^[A-Za-z]:\\$/.test(path)
}

/** Parent for a win32 drive root — the drives view; null for anything else. */
export function driveRootParent(path: string, platform: Platform): string | null {
  return platform === 'win32' && isDriveRootPath(path) ? DRIVES_VIEW : null
}

/**
 * Logical drives as seen by the picker. On win32, probes `A:\` through `Z:\`
 * with fs.access and keeps the readable ones (no native dependency); on posix,
 * the single root. Entries come back in letter order.
 */
export async function listDrives(platform: Platform, probe: DriveProbe = (p) => access(p)): Promise<DirectoryEntry[]> {
  if (platform !== 'win32') return [{ name: '/', path: '/' }]

  const drives: DirectoryEntry[] = []
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    const path = `${letter}:\\`
    try {
      await probe(path)
      drives.push({ name: `${letter}:`, path })
    } catch {
      // Drive not mounted or not readable.
    }
  }
  return drives
}
