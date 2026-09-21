/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginMenu } from './PluginMenu'
import { useLocaleStore } from '../../stores/locale'
import { EMPTY_PLUGIN_CONTRIBUTIONS } from '@shared/plugin.js'
import type { PluginUiContributions, PluginInfo } from '@shared/plugin.js'

const dataRef: { current: { plugins: PluginInfo[]; contributions: PluginUiContributions } } = {
  current: {
    plugins: [],
    contributions: {
      actions: [],
      badges: [],
      panels: [],
      sections: [],
      components: [],
      overrides: [],
      settingsTabs: [],
    },
  },
}

vi.mock('../../hooks/usePlugins', () => ({
  usePlugins: () => ({
    plugins: dataRef.current.plugins,
    contributions: dataRef.current.contributions,
    loading: false,
    error: undefined,
    refresh: vi.fn(),
  }),
}))

const invokePluginRpc = vi.fn()
vi.mock('../../lib/plugin-actions', () => ({
  invokePluginRpc: (...args: unknown[]) => invokePluginRpc(...args),
}))

const DEMO_PLUGIN: PluginInfo = {
  id: 'hello',
  displayName: 'Hello plugin',
  description: 'A friendly demo',
  version: '1.0.0',
  apiVersion: 2,
  source: 'github',
  enabled: true,
  loaded: true,
  capabilities: [],
  contributions: { ...EMPTY_PLUGIN_CONTRIBUTIONS },
  removable: true,
}

const DISABLED_PLUGIN: PluginInfo = { ...DEMO_PLUGIN, id: 'off', displayName: 'Disabled plugin', enabled: false }

describe('PluginMenu', () => {
  beforeEach(() => {
    dataRef.current = {
      plugins: [],
      contributions: {
        actions: [],
        badges: [],
        panels: [],
        sections: [],
        components: [],
        overrides: [],
        settingsTabs: [],
      },
    }
    invokePluginRpc.mockReset()
    useLocaleStore.setState({ locale: 'en' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a puzzle trigger button labelled Plugins', () => {
    render(<PluginMenu context={{}} onManage={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeDefined()
  })

  it('lists enabled plugins and invokes their header actions', async () => {
    dataRef.current = {
      plugins: [DEMO_PLUGIN],
      contributions: {
        components: [],
        overrides: [],
        settingsTabs: [],
        actions: [
          {
            id: 'open',
            pluginId: 'hello',
            slot: 'header.actions',
            label: { en: 'Open panel', fr: 'Ouvrir le panneau' },
            icon: 'puzzle',
            onActivate: { kind: 'rpc', method: 'ping', params: { force: true } },
          },
        ],
        badges: [],
        panels: [],
        sections: [],
      },
    }
    render(<PluginMenu context={{ sessionId: 's1', workdir: '/tmp' }} onManage={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('Hello plugin')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open panel' }))
    await waitFor(() =>
      expect(invokePluginRpc).toHaveBeenCalledWith(
        'hello',
        'ping',
        { force: true },
        { sessionId: 's1', workdir: '/tmp' },
      ),
    )
  })

  it('hides session actions when the context has no session and hides disabled plugins', async () => {
    dataRef.current = {
      plugins: [DEMO_PLUGIN, DISABLED_PLUGIN],
      contributions: {
        components: [],
        overrides: [],
        settingsTabs: [],
        actions: [
          {
            id: 'needs-session',
            pluginId: 'hello',
            slot: 'session.header.actions',
            label: { en: 'Session only', fr: 'Session uniquement' },
            visibleWhen: { hasSession: true },
            onActivate: { kind: 'rpc', method: 'ping' },
          },
          {
            id: 'always',
            pluginId: 'hello',
            slot: 'header.actions',
            label: { en: 'Always', fr: 'Toujours' },
            onActivate: { kind: 'rpc', method: 'ping' },
          },
        ],
        badges: [],
        panels: [],
        sections: [],
      },
    }
    render(<PluginMenu context={{}} onManage={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('Hello plugin')).toBeDefined()
    expect(screen.queryByText('Disabled plugin')).toBeNull()
    expect(screen.queryByText('Session only')).toBeNull()
    expect(screen.getByText('Always')).toBeDefined()
  })

  it('lists a plugin with no visible actions', async () => {
    dataRef.current = {
      plugins: [DEMO_PLUGIN],
      contributions: {
        actions: [],
        badges: [],
        panels: [],
        sections: [],
        components: [],
        overrides: [],
        settingsTabs: [],
      },
    }
    render(<PluginMenu context={{}} onManage={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('Hello plugin')).toBeDefined()
  })

  it('shows an empty state when no plugins are enabled', async () => {
    render(<PluginMenu context={{}} onManage={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('No plugins installed')).toBeDefined()
  })

  it('fires onManage from the Manage plugins footer item', async () => {
    dataRef.current = {
      plugins: [DEMO_PLUGIN],
      contributions: {
        actions: [],
        badges: [],
        panels: [],
        sections: [],
        components: [],
        overrides: [],
        settingsTabs: [],
      },
    }
    const onManage = vi.fn()
    render(<PluginMenu context={{}} onManage={onManage} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Plugins' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Manage plugins' }))
    expect(onManage).toHaveBeenCalled()
  })
})
