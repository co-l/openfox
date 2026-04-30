import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `openfox-pwa-test-${Date.now()}`)

vi.mock('./paths.js', () => ({
  getGlobalConfigDir: (mode: string) => join(TEST_DIR, mode),
}))

vi.mock('./config.js', () => ({}))

describe('pwa', () => {
  beforeEach(async () => {
    vi.resetModules()
    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
    await mkdir(join(TEST_DIR, 'development'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('getManifestUrl', () => {
    it('returns localhost:10369 for production mode', async () => {
      const { getManifestUrl } = await import('./pwa.js')
      expect(getManifestUrl('production')).toBe('http://127.0.0.1:10369/manifest.webmanifest')
    })

    it('returns localhost:10469 for development mode', async () => {
      const { getManifestUrl } = await import('./pwa.js')
      expect(getManifestUrl('development')).toBe('http://127.0.0.1:10469/manifest.webmanifest')
    })

    it('returns localhost:10369 for test mode (falls back to production port)', async () => {
      const { getManifestUrl } = await import('./pwa.js')
      expect(getManifestUrl('test')).toBe('http://127.0.0.1:10369/manifest.webmanifest')
    })
  })

  describe('pwa config persistence', () => {
    it('saves and loads pwa config', async () => {
      vi.resetModules()
      const { savePwaConfig, loadPwaConfig } = await import('./pwa.js')

      const config = {
        appId: '01KQFQR5GN467NYZ307787F0ZX',
        profileId: '00000000000000000000000000',
        manifestUrl: 'http://127.0.0.1:10369/manifest.webmanifest',
        installedAt: '2026-04-30T12:00:00.000Z',
      }

      await savePwaConfig('production', config)

      const loaded = await loadPwaConfig('production')
      expect(loaded).toEqual(config)
    })

    it('loadPwaConfig returns null when no config exists', async () => {
      const { loadPwaConfig } = await import('./pwa.js')
      const result = await loadPwaConfig('production')
      expect(result).toBeNull()
    })

    it('removePwaConfig removes config file', async () => {
      const { savePwaConfig, loadPwaConfig, removePwaConfig } = await import('./pwa.js')

      await savePwaConfig('production', {
        appId: '01KQFQR5GN467NYZ307787F0ZX',
        profileId: '00000000000000000000000000',
        manifestUrl: 'http://127.0.0.1:10369/manifest.webmanifest',
        installedAt: '2026-04-30T12:00:00.000Z',
      })

      const before = await loadPwaConfig('production')
      expect(before).not.toBeNull()

      await removePwaConfig('production')

      const after = await loadPwaConfig('production')
      expect(after).toBeNull()
    })

    it('removePwaConfig does not throw when no config exists', async () => {
      const { removePwaConfig } = await import('./pwa.js')
      await expect(removePwaConfig('production')).resolves.toBeUndefined()
    })
  })

  describe('printPwaHelp', () => {
    it('prints help text to console', async () => {
      const { printPwaHelp } = await import('./pwa.js')
      const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})

      printPwaHelp()

      expect(mockLog).toHaveBeenCalled()
      const output = mockLog.mock.calls.flat().join('\n')
      expect(output).toContain('openfox pwa install')
      expect(output).toContain('openfox pwa uninstall')
      expect(output).toContain('openfox pwa launch')
      expect(output).toContain('openfox pwa update')
      expect(output).toContain('openfox pwa status')

      mockLog.mockRestore()
    })
  })
})