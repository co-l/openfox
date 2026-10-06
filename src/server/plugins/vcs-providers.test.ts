import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setPluginVcsProviders,
  clearPluginVcsProviders,
  listPluginVcsProviders,
  findActiveVcsProvider,
  resolveVcsDiffFiles,
  resolveVcsBranch,
  resolveVcsModifiedFiles,
} from './vcs-providers.js'
import type { PluginVcsProvider } from '../../plugin/index.js'

describe('vcs-providers', () => {
  beforeEach(() => {
    clearPluginVcsProviders()
    vi.clearAllMocks()
  })

  it('returns null/undefined when no providers are registered', async () => {
    const context = { workdir: '/test/repo', sessionId: 's1' }
    expect(await findActiveVcsProvider(context)).toBeNull()
    expect(await resolveVcsDiffFiles(context)).toBeNull()
    expect(await resolveVcsBranch(context)).toBeUndefined()
    expect(await resolveVcsModifiedFiles(context)).toBeNull()
  })

  it('sorts providers by ascending priority order', () => {
    const p1: PluginVcsProvider = {
      id: 'p1',
      priority: 200,
      detect: () => true,
      getDiffFiles: async () => [],
    }
    const p2: PluginVcsProvider = {
      id: 'p2',
      priority: 50,
      detect: () => true,
      getDiffFiles: async () => [],
    }
    const p3: PluginVcsProvider = {
      id: 'p3',
      priority: 100,
      detect: () => true,
      getDiffFiles: async () => [],
    }

    setPluginVcsProviders([
      { pluginId: 'plugin-1', provider: p1 },
      { pluginId: 'plugin-2', provider: p2 },
      { pluginId: 'plugin-3', provider: p3 },
    ])

    const list = listPluginVcsProviders()
    expect(list.map((item) => item.provider.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('selects the first matching provider by priority', async () => {
    const multiRepoProvider: PluginVcsProvider = {
      id: 'multirepo',
      priority: 10,
      detect: (ctx) => ctx.workdir === '/workspace/multi',
      getDiffFiles: async () => [
        { path: 'backend/server.ts', status: 'modified' },
        { path: 'frontend/App.tsx', status: 'added' },
      ],
      getBranch: async () => 'multi (main)',
    }

    const genericProvider: PluginVcsProvider = {
      id: 'generic',
      priority: 100,
      detect: () => true,
      getDiffFiles: async () => [{ path: 'root.ts', status: 'modified' }],
      getBranch: async () => 'main',
    }

    setPluginVcsProviders([
      { pluginId: 'plug-generic', provider: genericProvider },
      { pluginId: 'plug-multi', provider: multiRepoProvider },
    ])

    const multiActive = await findActiveVcsProvider({ workdir: '/workspace/multi' })
    expect(multiActive?.id).toBe('multirepo')

    const multiDiff = await resolveVcsDiffFiles({ workdir: '/workspace/multi' })
    expect(multiDiff).toEqual([
      { path: 'backend/server.ts', status: 'modified' },
      { path: 'frontend/App.tsx', status: 'added' },
    ])

    const multiBranch = await resolveVcsBranch({ workdir: '/workspace/multi' })
    expect(multiBranch).toBe('multi (main)')

    const singleActive = await findActiveVcsProvider({ workdir: '/workspace/single' })
    expect(singleActive?.id).toBe('generic')
  })

  it('formats modified files with provider formatModifiedFiles or fallback format', async () => {
    const customFormatProvider: PluginVcsProvider = {
      id: 'custom-format',
      priority: 10,
      detect: () => true,
      getDiffFiles: async () => [
        { path: 'pkg-a/foo.ts', status: 'modified' },
        { path: 'pkg-b/bar.ts', status: 'added' },
      ],
      formatModifiedFiles: (files) => `Sub-repos:\n${files.map((f) => `  * ${f.path}`).join('\n')}`,
    }

    setPluginVcsProviders([{ pluginId: 'custom', provider: customFormatProvider }])

    const formatted = await resolveVcsModifiedFiles({ workdir: '/test' })
    expect(formatted).toBe('Sub-repos:\n  * pkg-a/foo.ts\n  * pkg-b/bar.ts')

    const defaultFormatProvider: PluginVcsProvider = {
      id: 'default-format',
      priority: 10,
      detect: () => true,
      getDiffFiles: async () => [
        { path: 'pkg-a/foo.ts', status: 'modified' },
        { path: 'pkg-b/bar.ts', status: 'added' },
      ],
    }

    setPluginVcsProviders([{ pluginId: 'default', provider: defaultFormatProvider }])

    const defaultFormatted = await resolveVcsModifiedFiles({ workdir: '/test' })
    expect(defaultFormatted).toBe('- pkg-a/foo.ts (modified)\n- pkg-b/bar.ts (added)')
  })

  it('handles provider errors and timeouts gracefully', async () => {
    const failingProvider: PluginVcsProvider = {
      id: 'failing',
      priority: 10,
      detect: () => {
        throw new Error('Detection crash')
      },
      getDiffFiles: async () => [],
    }

    const fallbackProvider: PluginVcsProvider = {
      id: 'fallback',
      priority: 50,
      detect: () => true,
      getDiffFiles: async () => [{ path: 'fallback.ts', status: 'modified' }],
    }

    setPluginVcsProviders([
      { pluginId: 'p-fail', provider: failingProvider },
      { pluginId: 'p-fallback', provider: fallbackProvider },
    ])

    const active = await findActiveVcsProvider({ workdir: '/test' })
    expect(active?.id).toBe('fallback')

    const diff = await resolveVcsDiffFiles({ workdir: '/test' })
    expect(diff).toEqual([{ path: 'fallback.ts', status: 'modified' }])
  })
})
