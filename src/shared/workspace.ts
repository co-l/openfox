export interface WorkspaceConfig {
  setup?: string[]
  rootDir?: string
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

export function getRootDirBlockReason(
  path: string,
  exactPaths: readonly string[] = BLOCKED_EXACT_PATHS,
  virtualFsPrefixes: readonly string[] = BLOCKED_VIRTUAL_FS_PREFIXES,
): RootDirBlockReason | null {
  if (!path) return null
  const normalized = path.replace(/\/+$/, '') || '/'
  if (exactPaths.includes(normalized)) return 'exact'
  for (const prefix of virtualFsPrefixes) {
    if (normalized.startsWith(prefix)) return 'virtual_fs'
  }
  return null
}

export function isValidRootDir(
  path: string,
  exactPaths: readonly string[] = BLOCKED_EXACT_PATHS,
  virtualFsPrefixes: readonly string[] = BLOCKED_VIRTUAL_FS_PREFIXES,
): boolean {
  return getRootDirBlockReason(path, exactPaths, virtualFsPrefixes) === null
}
