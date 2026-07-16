/** Last segment of a path, handling both / and \ separators. */
export function pathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export interface Breadcrumb {
  name: string
  path: string
}

/**
 * Breadcrumb trail for a native path (Unix or Windows).
 * On Windows the drive crumb is 'X:\' — 'X:' alone would be drive-relative.
 */
export function pathBreadcrumbs(path: string): Breadcrumb[] {
  const sep = path.includes('\\') ? '\\' : '/'
  return path
    .split(/[\\/]/)
    .filter(Boolean)
    .map((part, i, arr) => ({
      name: part,
      path:
        sep === '/'
          ? '/' + arr.slice(0, i + 1).join('/')
          : arr.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : ''),
    }))
}

export function truncateMiddle(path: string, maxLen = 28): string {
  if (path.length <= maxLen) return path
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  const middle = parts.slice(1, -1).join('/')
  const space = maxLen - first.length - last.length - 3
  if (space < 0) return path
  const lchars = middle.slice(0, Math.floor(space / 2))
  const rchars = middle.slice(-Math.ceil(space / 2))
  return `/${first}/${lchars}...${rchars}/${last}`
}
