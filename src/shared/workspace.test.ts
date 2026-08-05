import { describe, it, expect } from 'vitest'
import { formatRootDir, getRootDirBlockReason, isValidRootDir, suggestRootDirChild } from './workspace.js'

describe('getRootDirBlockReason', () => {
  it('blocks posix system roots exactly', () => {
    expect(getRootDirBlockReason('/')).toBe('exact')
    expect(getRootDirBlockReason('/etc')).toBe('exact')
    expect(getRootDirBlockReason('/home')).toBe('exact')
  })

  it('blocks virtual filesystems by prefix', () => {
    expect(getRootDirBlockReason('/proc/self/fd')).toBe('virtual_fs')
    expect(getRootDirBlockReason('/sys/kernel')).toBe('virtual_fs')
  })

  it('allows regular directories', () => {
    expect(getRootDirBlockReason('/home/me/workspaces')).toBeNull()
    expect(getRootDirBlockReason('C:\\Users\\me\\workspaces')).toBeNull()
    expect(isValidRootDir('C:\\Users\\me\\workspaces')).toBe(true)
  })

  it('blocks bare Windows drive roots', () => {
    expect(getRootDirBlockReason('C:\\')).toBe('exact')
    expect(getRootDirBlockReason('d:/')).toBe('exact')
    expect(getRootDirBlockReason('Z:')).toBe('exact')
    expect(isValidRootDir('C:\\')).toBe(false)
  })

  it('ignores trailing separators of either kind', () => {
    expect(getRootDirBlockReason('/etc/')).toBe('exact')
    expect(getRootDirBlockReason('/home//')).toBe('exact')
    expect(getRootDirBlockReason('C:\\\\')).toBe('exact')
    expect(getRootDirBlockReason('/home/me/ws/')).toBeNull()
  })

  it('returns null for an empty path', () => {
    expect(getRootDirBlockReason('')).toBeNull()
  })
})

describe('formatRootDir', () => {
  it('drops trailing separators', () => {
    expect(formatRootDir('/home/me/ws/')).toBe('/home/me/ws')
    expect(formatRootDir('C:\\Users\\me\\ws\\')).toBe('C:\\Users\\me\\ws')
  })

  it('keeps drive roots readable', () => {
    expect(formatRootDir('C:\\')).toBe('C:\\')
    expect(formatRootDir('d:/')).toBe('d:\\')
  })

  it('keeps the posix root', () => {
    expect(formatRootDir('/')).toBe('/')
  })
})

describe('suggestRootDirChild', () => {
  it('appends with a single separator', () => {
    expect(suggestRootDirChild('/home', 'myproj')).toBe('/home/myproj')
    expect(suggestRootDirChild('/home/', 'myproj')).toBe('/home/myproj')
    expect(suggestRootDirChild('/', 'myproj')).toBe('/myproj')
    expect(suggestRootDirChild('C:\\', 'myproj')).toBe('C:\\myproj')
  })
})
