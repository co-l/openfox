import { describe, expect, it, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import { getGlobalConfigDir } from './paths.js'

describe('getGlobalConfigDir', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('test mode', () => {
    it('resolves e2e/.openfox-test when launched from the repository root', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(join('C:', 'repo'))
      expect(getGlobalConfigDir('test')).toBe(join('C:', 'repo', 'e2e', '.openfox-test'))
    })

    it('resolves .openfox-test directly when launched from e2e/', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(join('C:', 'repo', 'e2e'))
      expect(getGlobalConfigDir('test')).toBe(join('C:', 'repo', 'e2e', '.openfox-test'))
    })
  })
})
