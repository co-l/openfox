import { describe, it, expect } from 'vitest'
import { DRIVES_VIEW } from '../../shared/directory.js'
import { isDriveRootPath, driveRootParent, listDrives } from './drives.js'

describe('isDriveRootPath', () => {
  it('matches a Windows drive root', () => {
    expect(isDriveRootPath('D:\\')).toBe(true)
    expect(isDriveRootPath('C:\\')).toBe(true)
  })

  it('rejects drive-relative paths and subdirectories', () => {
    expect(isDriveRootPath('D:')).toBe(false)
    expect(isDriveRootPath('D:\\projects')).toBe(false)
  })

  it('rejects Unix paths', () => {
    expect(isDriveRootPath('/')).toBe(false)
    expect(isDriveRootPath('/home/user')).toBe(false)
  })
})

describe('driveRootParent', () => {
  it('ascends from a Windows drive root to the drives view', () => {
    expect(driveRootParent('D:\\', 'win32')).toBe(DRIVES_VIEW)
  })

  it('returns null inside a drive on win32', () => {
    expect(driveRootParent('D:\\projects', 'win32')).toBeNull()
  })

  it('returns null on posix', () => {
    expect(driveRootParent('/', 'linux')).toBeNull()
  })
})

describe('listDrives', () => {
  it('returns the single root on posix', async () => {
    const drives = await listDrives('linux')
    expect(drives).toEqual([{ name: '/', path: '/' }])
  })

  it('returns readable drives on win32, in letter order', async () => {
    const readable = new Set(['C:\\', 'D:\\'])
    const drives = await listDrives('win32', (p) =>
      readable.has(p) ? Promise.resolve() : Promise.reject(new Error('unavailable')),
    )
    expect(drives).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ])
  })

  it('skips unreadable drives', async () => {
    const drives = await listDrives('win32', (p) =>
      p === 'E:\\' ? Promise.resolve() : Promise.reject(new Error('unavailable')),
    )
    expect(drives).toEqual([{ name: 'E:', path: 'E:\\' }])
  })
})
