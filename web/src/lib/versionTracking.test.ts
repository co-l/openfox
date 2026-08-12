// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getStoredLastVersion,
  getStoredPreviousVersion,
  trackVersion,
  stampPreviousVersion,
  isVersionNewerThan,
} from './versionTracking'

beforeEach(() => {
  localStorage.clear()
})

describe('trackVersion', () => {
  it('records the last seen version', () => {
    trackVersion('2.0.115')
    expect(getStoredLastVersion()).toBe('2.0.115')
  })

  it('preserves the previous version when the version changes', () => {
    trackVersion('2.0.114')
    trackVersion('2.0.115')
    expect(getStoredPreviousVersion()).toBe('2.0.114')
    expect(getStoredLastVersion()).toBe('2.0.115')
  })

  it('does not overwrite the previous version on repeat observations', () => {
    trackVersion('2.0.114')
    trackVersion('2.0.115')
    trackVersion('2.0.115')
    expect(getStoredPreviousVersion()).toBe('2.0.114')
  })

  it('ignores a null current version', () => {
    trackVersion(null)
    expect(getStoredLastVersion()).toBeNull()
  })
})

describe('stampPreviousVersion', () => {
  it('stores the given version as the previous one', () => {
    stampPreviousVersion('2.0.114')
    expect(getStoredPreviousVersion()).toBe('2.0.114')
  })

  it('ignores a null version', () => {
    stampPreviousVersion(null)
    expect(getStoredPreviousVersion()).toBeNull()
  })
})

describe('isVersionNewerThan', () => {
  it('compares major.minor.patch numerically', () => {
    expect(isVersionNewerThan('2.0.115', '2.0.114')).toBe(true)
    expect(isVersionNewerThan('2.0.114', '2.0.115')).toBe(false)
    expect(isVersionNewerThan('2.1.0', '2.0.199')).toBe(true)
    expect(isVersionNewerThan('2.0.114', '2.0.114')).toBe(false)
  })

  it('returns false for null or invalid inputs', () => {
    expect(isVersionNewerThan(null, '2.0.114')).toBe(false)
    expect(isVersionNewerThan('2.0.115', null)).toBe(false)
    expect(isVersionNewerThan('abc', '2.0.114')).toBe(false)
  })
})
