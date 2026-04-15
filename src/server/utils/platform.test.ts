import { describe, expect, it } from 'vitest'
import { getPathSeparator, isWindowsPath, isAbsolutePath } from './platform.js'

describe('getPathSeparator', () => {
  it('returns ; on windows', () => {
    expect(getPathSeparator()).toBe(process.platform === 'win32' ? ';' : ':')
  })
})

describe('isWindowsPath', () => {
  it('returns true for Windows drive paths', () => {
    expect(isWindowsPath('C:\\Users\\test')).toBe(true)
    expect(isWindowsPath('C:/Users/test')).toBe(true)
    expect(isWindowsPath('D:\\Program Files')).toBe(true)
    expect(isWindowsPath('E:/')).toBe(true)
  })

  it('returns false for Unix paths', () => {
    expect(isWindowsPath('/home/user')).toBe(false)
    expect(isWindowsPath('/tmp')).toBe(false)
  })

  it('returns false for relative paths', () => {
    expect(isWindowsPath('relative/path')).toBe(false)
    expect(isWindowsPath('file.txt')).toBe(false)
  })
})

describe('isAbsolutePath', () => {
  it('returns true for Unix absolute paths', () => {
    expect(isAbsolutePath('/home/user')).toBe(true)
    expect(isAbsolutePath('/tmp')).toBe(true)
    expect(isAbsolutePath('/')).toBe(true)
  })

  it('returns true for Windows absolute paths', () => {
    expect(isAbsolutePath('C:\\Users\\test')).toBe(true)
    expect(isAbsolutePath('C:/Users/test')).toBe(true)
    expect(isAbsolutePath('D:\\')).toBe(true)
  })

  it('returns false for relative paths', () => {
    expect(isAbsolutePath('relative/path')).toBe(false)
    expect(isAbsolutePath('file.txt')).toBe(false)
    expect(isAbsolutePath('./file')).toBe(false)
  })
})