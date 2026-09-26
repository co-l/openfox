/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginsTab } from './PluginsTab'
import type { PluginInfo } from '@shared/plugin.js'

const refresh = vi.fn()
const pluginsRef: { current: PluginInfo[] } = { current: [] }
const diagnosticsRef: { current: unknown[] } = { current: [] }
const registryLoadingRef: { current: boolean } = { current: false }
const registryErrorRef: { current: Error | undefined } = { current: undefined }

vi.mock('../../../hooks/usePlugins', () => ({
  usePlugins: () => ({
    plugins: pluginsRef.current,
    contributions: {
      actions: [],
      badges: [],
      panels: [],
      sections: pluginsRef.current
        .filter((plugin) => plugin.contributions.settingsFields > 0)
        .map((plugin) => ({
          id: plugin.id,
          pluginId: plugin.id,
          title: { en: 'Settings', fr: 'Paramètres' },
          schema: { fields: [] },
        })),
    },
    loading: false,
    error: undefined,
    refresh,
  }),
}))

vi.mock('../../../hooks/useResource', () => ({
  useResource: (resource: { keyOf: (...args: unknown[]) => string }) =>
    resource.keyOf().startsWith('plugins:diagnostics')
      ? { data: { diagnostics: diagnosticsRef.current }, loading: false, error: undefined, refresh: vi.fn() }
      : {
          data: {
            plugins: [
              {
                name: 'openfox-demo',
                displayName: 'Demo plugin registry entry',
                description: 'Installed demo plugin',
                githubUrl: 'https://github.com/user/openfox-demo',
              },
              {
                name: 'openfox-registry-only',
                displayName: 'Registry plugin',
                description: 'Available from the registry',
                githubUrl: 'https://github.com/user/openfox-registry-only',
              },
            ],
          },
          loading: registryLoadingRef.current,
          error: registryErrorRef.current,
          refresh: vi.fn(),
        },
}))

const installPlugin = vi.fn()
const reinstallPlugin = vi.fn()
const setPluginEnabled = vi.fn()
const uninstallPlugin = vi.fn()

vi.mock('../../../lib/plugin-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/plugin-actions')>()
  return {
    ...actual,
    installPlugin: (...args: unknown[]) => installPlugin(...args),
    reinstallPlugin: (...args: unknown[]) => reinstallPlugin(...args),
    setPluginEnabled: (...args: unknown[]) => setPluginEnabled(...args),
    uninstallPlugin: (...args: unknown[]) => uninstallPlugin(...args),
  }
})

vi.mock('../../plugins/PluginSettingsForm', () => ({
  PluginSettingsForm: ({ pluginId }: { pluginId: string }) => <div>{`settings-form:${pluginId}`}</div>,
}))

vi.mock('../../../lib/api', () => ({
  authFetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
}))

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: 'openfox-demo',
    displayName: 'Demo plugin',
    description: 'A demo plugin',
    version: '1.2.3',
    apiVersion: 2,
    source: '/tmp/demo',
    enabled: true,
    loaded: true,
    capabilities: ['tools', 'ui'],
    removable: true,
    contributions: {
      presets: 0,
      authAdapters: 0,
      transportAdapters: 0,
      modelMetadataProviders: 0,
      tools: 2,
      commands: 0,
      skillSources: 0,
      hooks: 1,
      rpcMethods: 1,
      transitions: 0,
      settingsFields: 2,
      uiActions: 1,
      uiBadges: 0,
      uiPanels: 0,
      settingsTabs: 0,
      uiComponents: 0,
      uiOverrides: 0,
      messageTransforms: 0,
      dangerLevels: 0,
    },
    ...overrides,
  }
}

describe('PluginsTab', () => {
  beforeEach(() => {
    pluginsRef.current = [makePlugin()]
    diagnosticsRef.current = []
    registryLoadingRef.current = false
    registryErrorRef.current = undefined
    refresh.mockReset()
    installPlugin.mockReset()
    setPluginEnabled.mockReset()
    uninstallPlugin.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders html in plugin description', () => {
    pluginsRef.current = [
      makePlugin({
        description: 'Using this plugin.\n<span class="text-accent-error font-medium">⚠️ Warning Terms</span>',
      }),
    ]

    const { container } = render(<PluginsTab />)
    const warningSpan = container.querySelector('.text-accent-error')
    expect(warningSpan).not.toBeNull()
    expect(warningSpan?.textContent).toBe('⚠️ Warning Terms')
  })

  it('renders installed plugins with status, capabilities and contribution summary', () => {
    pluginsRef.current = [makePlugin({ author: 'Alice Developer' })]
    render(<PluginsTab />)
    expect(screen.getByText('Demo plugin')).toBeDefined()
    expect(screen.getByText('v1.2.3')).toBeDefined()
    expect(screen.getByText('Loaded')).toBeDefined()
    expect(screen.getByText('tools')).toBeDefined()
    const authorEl = screen.getByText('by Alice Developer')
    const summaryEl = screen.getByText('2 tools · 1 actions · 1 hooks · 1 rpc · 2 settings')
    expect(authorEl).toBeDefined()
    expect(summaryEl).toBeDefined()
    expect(authorEl.parentElement).toBe(summaryEl.parentElement)
    expect(screen.getByText('ui')).toBeDefined()
  })

  it('disables a plugin from the toggle', async () => {
    setPluginEnabled.mockResolvedValue({ ok: true })
    render(<PluginsTab />)
    const toggle = screen.getByRole('switch')
    await userEvent.setup().click(toggle)
    await waitFor(() => expect(setPluginEnabled).toHaveBeenCalledWith('openfox-demo', false))
    expect(refresh).toHaveBeenCalled()
  })

  it('opens the schema-driven settings form when a section is declared', async () => {
    render(<PluginsTab />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('settings-form:openfox-demo')).toBeDefined()
  })

  it('uninstalls after confirmation', async () => {
    uninstallPlugin.mockResolvedValue({ ok: true })
    render(<PluginsTab />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(uninstallPlugin).toHaveBeenCalledWith('openfox-demo'))
  })

  it('installs a registry plugin', async () => {
    installPlugin.mockResolvedValue({ ok: true })
    render(<PluginsTab />)
    const installButtons = screen.getAllByRole('button', { name: 'Install' })
    await userEvent.setup().click(installButtons[installButtons.length - 1]!)
    await waitFor(() =>
      expect(installPlugin).toHaveBeenCalledWith({ githubUrl: 'https://github.com/user/openfox-registry-only' }),
    )
  })

  it('shows the empty state without installed plugins', () => {
    pluginsRef.current = []
    render(<PluginsTab />)
    expect(screen.getByText('No plugins installed.')).toBeDefined()
  })

  it('installs from a local path when that source is selected', async () => {
    installPlugin.mockResolvedValue({ ok: true })
    render(<PluginsTab />)

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Install source'), 'path')
    const input = screen.getByPlaceholderText('/home/user/openfox-plugin')
    await user.type(input, '/tmp/my-plugin')
    const installButton = input.parentElement!.querySelector('button')!
    await user.click(installButton)

    await waitFor(() => expect(installPlugin).toHaveBeenCalledWith({ path: '/tmp/my-plugin' }))
  })

  it('surfaces plugin load diagnostics', () => {
    diagnosticsRef.current = [
      {
        packageName: 'broken-plugin',
        version: '0.1.0',
        source: '/tmp/plugins/broken-plugin',
        loaded: false,
        enabled: true,
        error: 'Intentional failure',
        capabilities: [],
      },
    ]
    render(<PluginsTab />)
    expect(screen.getByText('Diagnostics')).toBeDefined()
    expect(screen.getByText('broken-plugin')).toBeDefined()
    expect(screen.getByText('Intentional failure')).toBeDefined()
  })

  it('hides Remove for plugins managed outside OpenFox', () => {
    pluginsRef.current = [makePlugin({ removable: false })]
    render(<PluginsTab />)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.getByText('Managed outside OpenFox')).toBeDefined()
  })

  it('reinstalls an installed plugin via reinstallPlugin', async () => {
    reinstallPlugin.mockResolvedValue({ ok: true })
    render(<PluginsTab />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reinstall' }))
    await waitFor(() => expect(reinstallPlugin).toHaveBeenCalledWith('openfox-demo'))
  })

  it('omits developer line in installed card when author is not available and not in registry', () => {
    pluginsRef.current = [makePlugin({ id: 'standalone-custom', author: undefined })]
    render(<PluginsTab />)
    const installedSection = screen.getByText('Installed plugins').closest('section')!
    expect(installedSection.textContent).not.toContain('by ')
  })

  it('surfaces a registry load error', () => {
    registryErrorRef.current = new Error('boom')
    render(<PluginsTab />)
    expect(screen.getByText('Failed to load the plugin registry.')).toBeDefined()
  })
})
