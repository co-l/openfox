// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWorkspaceConfigStore } from './workspace-config'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

import { authFetch } from '../lib/api'

beforeEach(() => {
  useWorkspaceConfigStore.setState({ config: null, loading: false })
  vi.clearAllMocks()
})

describe('WorkspaceConfigStore', () => {
  describe('fetchConfig', () => {
    it('loads config with rootDir from API', async () => {
      const config = { rootDir: '/custom/workspaces', setup: ['npm install'] }
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ config }),
      } as any)

      await useWorkspaceConfigStore.getState().fetchConfig('/tmp/project')
      const state = useWorkspaceConfigStore.getState()
      expect(state.config).toEqual(config)
      expect(state.loading).toBe(false)
    })

    it('loads config without rootDir', async () => {
      const config = { setup: ['npm install'] }
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ config }),
      } as any)

      await useWorkspaceConfigStore.getState().fetchConfig('/tmp/project')
      expect(useWorkspaceConfigStore.getState().config).toEqual(config)
    })

    it('sets config to null when API returns null', async () => {
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ config: null }),
      } as any)

      await useWorkspaceConfigStore.getState().fetchConfig('/tmp/project')
      expect(useWorkspaceConfigStore.getState().config).toBeNull()
    })

    it('handles fetch error gracefully', async () => {
      vi.mocked(authFetch).mockRejectedValue(new Error('Network error'))

      await useWorkspaceConfigStore.getState().fetchConfig('/tmp/project')
      expect(useWorkspaceConfigStore.getState().loading).toBe(false)
    })
  })

  describe('saveConfig with rootDir', () => {
    it('sends rootDir in request body', async () => {
      const config = { rootDir: '/custom/workspaces' }
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ config }),
      } as any)

      await useWorkspaceConfigStore.getState().saveConfig('/tmp/project', config)
      expect(authFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/workspace/config'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(config),
        }),
      )
      expect(useWorkspaceConfigStore.getState().config).toEqual(config)
    })

    it('saves config with both rootDir and setup', async () => {
      const config = { rootDir: '/custom/workspaces', setup: ['npm install'] }
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ config }),
      } as any)

      await useWorkspaceConfigStore.getState().saveConfig('/tmp/project', config)
      expect(authFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(config),
        }),
      )
    })

    it('throws on save error', async () => {
      vi.mocked(authFetch).mockResolvedValue({ ok: false } as any)

      await expect(useWorkspaceConfigStore.getState().saveConfig('/tmp/project', { rootDir: '/path' })).rejects.toThrow(
        'Failed to save workspace config',
      )
    })
  })
})
