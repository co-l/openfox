import { describe, expect, it } from 'vitest'
import { pathBasename, pathBreadcrumbs } from './path'

describe('pathBasename', () => {
  it('returns the last segment of a Unix path', () => {
    expect(pathBasename('/home/user/projects/my-app')).toBe('my-app')
  })

  it('returns the last segment of a Windows path', () => {
    expect(pathBasename('C:\\Users\\me\\projects\\my-app')).toBe('my-app')
  })

  it('handles Windows paths with forward slashes', () => {
    expect(pathBasename('C:/Users/me/my-app')).toBe('my-app')
  })

  it('ignores trailing separators', () => {
    expect(pathBasename('/home/user/my-app/')).toBe('my-app')
    expect(pathBasename('C:\\Users\\me\\my-app\\')).toBe('my-app')
  })

  it('returns empty string for empty input', () => {
    expect(pathBasename('')).toBe('')
    expect(pathBasename('/')).toBe('')
  })
})

describe('pathBreadcrumbs', () => {
  it('builds crumbs for a Unix path', () => {
    expect(pathBreadcrumbs('/home/user/projects')).toEqual([
      { name: 'home', path: '/home' },
      { name: 'user', path: '/home/user' },
      { name: 'projects', path: '/home/user/projects' },
    ])
  })

  it('builds crumbs for a Windows path, keeping the drive root navigable', () => {
    expect(pathBreadcrumbs('D:\\github\\Openfox')).toEqual([
      // 'D:' alone would be drive-relative on Windows; the crumb must be 'D:\'
      { name: 'D:', path: 'D:\\' },
      { name: 'github', path: 'D:\\github' },
      { name: 'Openfox', path: 'D:\\github\\Openfox' },
    ])
  })

  it('returns no crumbs for an empty path', () => {
    expect(pathBreadcrumbs('')).toEqual([])
  })
})
