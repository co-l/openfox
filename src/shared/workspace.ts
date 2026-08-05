export interface WorkspaceConfig {
  setup?: string[]
}

/**
 * Paths that are blocked as exact workspace root directories.
 * Using these exact paths would be problematic, but subdirectories are fine.
 */
export const BLOCKED_EXACT_PATHS = [
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/usr',
  '/var',
  '/opt',
  '/root',
  '/run',
  '/tmp',
  '/home',
  '/mnt',
  '/media',
] as const

/**
 * Paths that are blocked entirely — no subdirectory under these can be used
 * as a workspace root. These are virtual filesystems or special FS areas
 * where creating workspace data is meaningless or dangerous.
 */
export const BLOCKED_VIRTUAL_FS_PREFIXES = ['/proc/', '/sys/', '/dev/', '/boot/', '/etc/', '/lost+found/'] as const

export type RootDirBlockReason = 'exact' | 'virtual_fs'

/**
 * A bare Windows drive root (`C:\`, `d:/`, `C:`). Blocked like `/` is on posix:
 * a whole drive as workspace root lists every top-level folder of the disk as a
 * workspace, each one deletable from the workspace switcher.
 * Not gated on the platform: this module also runs in the browser, which has no
 * way to know the server's platform. The cost on posix is a relative directory
 * literally named `c:` — the server would resolve it under the project, the
 * client now rejects it.
 */
const WINDOWS_DRIVE_ROOT = /^[a-zA-Z]:$/

export function getRootDirBlockReason(
  path: string,
  exactPaths: readonly string[] = BLOCKED_EXACT_PATHS,
  virtualFsPrefixes: readonly string[] = BLOCKED_VIRTUAL_FS_PREFIXES,
): RootDirBlockReason | null {
  if (!path) return null
  const normalized = path.replace(/[\\/]+$/, '') || '/'
  if (WINDOWS_DRIVE_ROOT.test(normalized)) return 'exact'
  if (exactPaths.includes(normalized)) return 'exact'
  for (const prefix of virtualFsPrefixes) {
    if (normalized.startsWith(prefix)) return 'virtual_fs'
  }
  return null
}

/** Root dir as shown in messages: trailing separators dropped, drive roots kept as `C:\`. */
export function formatRootDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (!trimmed) return '/'
  return WINDOWS_DRIVE_ROOT.test(trimmed) ? `${trimmed}\\` : trimmed
}

/** Suggested subdirectory under a blocked root, with a single separator on both platforms. */
export function suggestRootDirChild(path: string, child: string): string {
  const base = formatRootDir(path)
  return /[\\/]$/.test(base) ? `${base}${child}` : `${base}/${child}`
}

export function isValidRootDir(
  path: string,
  exactPaths: readonly string[] = BLOCKED_EXACT_PATHS,
  virtualFsPrefixes: readonly string[] = BLOCKED_VIRTUAL_FS_PREFIXES,
): boolean {
  return getRootDirBlockReason(path, exactPaths, virtualFsPrefixes) === null
}
