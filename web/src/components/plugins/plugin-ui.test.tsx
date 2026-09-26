/**
 * @vitest-environment jsdom
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSlot } from './PluginSlot'
import { PluginBadges } from './PluginBadges'
import { PluginPanelHost } from './PluginPanelHost'
import { PluginZone } from './PluginZone'
import { DeclarativeRenderer } from './DeclarativeRenderer'
import { activatePluginAction } from './plugin-ui-utils'
import { usePluginUiStore } from '../../stores/pluginUi'
import { useLocaleStore } from '../../stores/locale'
import { clearBadgeCache } from '../../lib/plugin-badge-cache'
import { EMPTY_PLUGIN_CONTRIBUTIONS } from '@shared/plugin.js'
import type { PluginUiContributions } from '@shared/plugin.js'

const contributionsRef: { current: PluginUiContributions } = {
  current: { actions: [], badges: [], panels: [], sections: [], settingsTabs: [], components: [], overrides: [] },
}

vi.mock('../../hooks/usePlugins', () => ({
  usePlugins: () => ({
    plugins: [],
    contributions: contributionsRef.current,
    loading: false,
    error: undefined,
    refresh: vi.fn(),
  }),
}))

const invokePluginRpc = vi.fn()
vi.mock('../../lib/plugin-actions', () => ({
  invokePluginRpc: (...args: unknown[]) => invokePluginRpc(...args),
}))

const refreshItemResources = vi.fn()
vi.mock('../../lib/resources', () => ({
  providersResource: { refresh: vi.fn() },
  refreshItemResources: (kinds: string[]) => refreshItemResources(kinds),
}))

const openSettings = vi.fn()
vi.mock('../settings/GlobalSettingsModal', () => ({
  openSettings: (...args: unknown[]) => openSettings(...args),
}))

describe('plugin UI slots', () => {
  beforeEach(() => {
    contributionsRef.current = {
      actions: [],
      badges: [],
      panels: [],
      sections: [],
      settingsTabs: [],
      components: [],
      overrides: [],
    }
    invokePluginRpc.mockReset()
    refreshItemResources.mockReset()
    openSettings.mockReset()
    usePluginUiStore.setState({ values: {}, activePanel: null })
    useLocaleStore.setState({ locale: 'en' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing for empty slots', () => {
    const { container } = render(<PluginSlot slot="header.actions" context={{}} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders an action and invokes its RPC with context', async () => {
    invokePluginRpc.mockResolvedValue('ok')
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'refresh',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Refresh quota', fr: 'Actualiser le quota' },
          icon: 'refresh',
          onActivate: { kind: 'rpc', method: 'refresh', params: { force: true } },
        },
      ],
    }
    render(<PluginSlot slot="header.actions" context={{ sessionId: 's1', workdir: '/tmp' }} />)

    const button = screen.getByRole('button', { name: 'Refresh quota' })
    await userEvent.setup().click(button)

    await waitFor(() =>
      expect(invokePluginRpc).toHaveBeenCalledWith(
        'demo',
        'refresh',
        { force: true },
        {
          sessionId: 's1',
          workdir: '/tmp',
        },
      ),
    )
  })

  it('refreshes the item resources named by the RPC invalidate list', async () => {
    invokePluginRpc.mockResolvedValue({ invalidate: ['agents', 'commands', 'skills'] })
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'install',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Install pack', fr: 'Installer le pack' },
          onActivate: { kind: 'rpc', method: 'install' },
        },
      ],
    }
    render(<PluginSlot slot="header.actions" context={{}} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Install pack' }))

    await waitFor(() => expect(refreshItemResources).toHaveBeenCalledWith(['agents', 'commands', 'skills']))
  })

  it('ignores a non-array invalidate value', async () => {
    invokePluginRpc.mockResolvedValue({ invalidate: 'agents' })
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'install',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Install pack', fr: 'Installer le pack' },
          onActivate: { kind: 'rpc', method: 'install' },
        },
      ],
    }
    render(<PluginSlot slot="header.actions" context={{}} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Install pack' }))

    await waitFor(() => expect(invokePluginRpc).toHaveBeenCalled())
    expect(refreshItemResources).not.toHaveBeenCalled()
  })

  it('localizes action labels in French', () => {
    useLocaleStore.setState({ locale: 'fr' })
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'refresh',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Refresh quota', fr: 'Actualiser le quota' },
          onActivate: { kind: 'rpc', method: 'refresh' },
        },
      ],
    }
    render(<PluginSlot slot="header.actions" context={{}} />)
    expect(screen.getByRole('button', { name: 'Actualiser le quota' })).toBeDefined()
  })

  it('opens a panel action through the plugin UI store', async () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'open',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Open quota', fr: 'Ouvrir le quota' },
          onActivate: { kind: 'openPanel', panelId: 'quota' },
        },
      ],
    }
    render(<PluginSlot slot="header.actions" context={{}} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open quota' }))
    expect(usePluginUiStore.getState().activePanel).toEqual({ pluginId: 'demo', panelId: 'quota' })
  })

  it('preserves session context when opening a panel', async () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'open-session-panel',
          pluginId: 'demo',
          slot: 'session.header.actions',
          label: { en: 'Open session panel', fr: 'Ouvrir le panneau de session' },
          onActivate: { kind: 'openPanel', panelId: 'session-panel' },
        },
      ],
    }
    render(
      <PluginSlot
        slot="session.header.actions"
        context={{ sessionId: 's1', projectId: 'p1', workdir: '/workspace/project' }}
      />,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open session panel' }))
    expect(usePluginUiStore.getState().activePanel).toEqual({
      pluginId: 'demo',
      panelId: 'session-panel',
      context: {
        sessionId: 's1',
        projectId: 'p1',
        workdir: '/workspace/project',
      },
    })
  })

  it('renders static and RPC-sourced badges', async () => {
    invokePluginRpc.mockResolvedValue(42)
    contributionsRef.current = {
      ...contributionsRef.current,
      badges: [
        {
          id: 'static',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Dev', fr: 'Dev' },
          tone: 'success',
          value: 'up',
        },
        {
          id: 'dynamic',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Quota', fr: 'Quota' },
          source: { kind: 'rpc', method: 'quota' },
        },
      ],
    }
    render(<PluginBadges slot="session.row.badges" context={{ sessionId: 's1' }} />)
    expect(screen.getByText('Dev up')).toBeDefined()
    await waitFor(() => expect(screen.getByText('Quota 42')).toBeDefined())
    expect(invokePluginRpc).toHaveBeenCalledWith('demo', 'quota', {}, { sessionId: 's1' })
  })

  it('dedupes badge RPCs across rows of the same session', async () => {
    clearBadgeCache()
    invokePluginRpc.mockResolvedValue(7)
    contributionsRef.current = {
      ...contributionsRef.current,
      badges: [
        {
          id: 'dynamic',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Quota', fr: 'Quota' },
          source: { kind: 'rpc', method: 'quota' },
        },
      ],
    }
    render(
      <>
        <PluginBadges slot="session.row.badges" context={{ sessionId: 's1' }} />
        <PluginBadges slot="session.row.badges" context={{ sessionId: 's1' }} />
      </>,
    )
    await waitFor(() => expect(screen.getAllByText('Quota 7')).toHaveLength(2))
    expect(invokePluginRpc).toHaveBeenCalledTimes(1)
  })

  it('applies dynamic badge visibility, tone, tooltip and icon overrides', async () => {
    clearBadgeCache()
    invokePluginRpc.mockResolvedValue({
      visible: true,
      tone: 'success',
      tooltip: { en: 'Dev server running', fr: 'Serveur dev actif' },
      icon: 'M3 4h18v6H3z M3 14h18v6H3z',
    })
    contributionsRef.current = {
      ...contributionsRef.current,
      badges: [
        {
          id: 'status',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Dev server', fr: 'Serveur dev' },
          appearance: 'icon',
          source: { kind: 'rpc', method: 'status' },
        },
      ],
    }

    render(<PluginBadges slot="session.row.badges" context={{ sessionId: 's1', workdir: '/tmp/a' }} />)

    await waitFor(() => expect(screen.getByTitle('Dev server running')).toBeDefined())
    const badge = screen.getByTestId('plugin-badge')
    expect(badge.className).toContain('text-accent-success')
  })

  it('does not flash an unresolved RPC badge before its first result', async () => {
    clearBadgeCache()
    let resolveRpc: ((value: unknown) => void) | undefined
    invokePluginRpc.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveRpc = resolve
        }),
    )
    contributionsRef.current = {
      ...contributionsRef.current,
      badges: [
        {
          id: 'status',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Dev server', fr: 'Serveur dev' },
          source: { kind: 'rpc', method: 'status' },
        },
      ],
    }

    const view = render(<PluginBadges slot="session.row.badges" context={{ sessionId: 's1', workdir: '/tmp/a' }} />)
    expect(view.container.innerHTML).toBe('')

    resolveRpc?.({ visible: true, tone: 'success' })
    await waitFor(() => expect(view.container.textContent).toContain('Dev server'))
  })

  it('hides a dynamic badge when its RPC result sets visible false', async () => {
    clearBadgeCache()
    invokePluginRpc.mockResolvedValue({ visible: false })
    contributionsRef.current = {
      ...contributionsRef.current,
      badges: [
        {
          id: 'status',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Dev server', fr: 'Serveur dev' },
          source: { kind: 'rpc', method: 'status' },
        },
      ],
    }

    const view = render(<PluginBadges slot="session.row.badges" context={{ sessionId: 's1', workdir: '/tmp/a' }} />)
    await waitFor(() => expect(view.container.innerHTML).toBe(''))
  })

  it('dedupes RPC badges by workdir when cacheScope is workdir', async () => {
    clearBadgeCache()
    invokePluginRpc.mockResolvedValue(7)
    contributionsRef.current = {
      ...contributionsRef.current,
      badges: [
        {
          id: 'dynamic',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Quota', fr: 'Quota' },
          source: { kind: 'rpc', method: 'quota', cacheScope: 'workdir' },
        },
      ],
    }

    render(
      <>
        <PluginBadges slot="session.row.badges" context={{ sessionId: 's1', workdir: '/tmp/shared' }} />
        <PluginBadges slot="session.row.badges" context={{ sessionId: 's2', workdir: '/tmp/shared' }} />
      </>,
    )

    await waitFor(() => expect(screen.getAllByText('Quota 7')).toHaveLength(2))
    expect(invokePluginRpc).toHaveBeenCalledTimes(1)
  })

  it('renders an action for every documented action slot', () => {
    const slots = ['header.actions', 'session.header.actions', 'message.actions', 'composer.actions'] as const
    for (const slot of slots) {
      contributionsRef.current = {
        ...contributionsRef.current,
        actions: [
          {
            id: `action-${slot}`,
            pluginId: 'demo',
            slot,
            label: { en: `Label ${slot}`, fr: `Libellé ${slot}` },
            onActivate: { kind: 'rpc', method: 'ping' },
          },
        ],
      }
      const { container, unmount } = render(<PluginSlot slot={slot} context={{}} />)
      expect(container.textContent).toContain(`Label ${slot}`)
      unmount()
    }
  })

  it('renders a badge for every documented badge slot', () => {
    const slots = ['session.row.badges', 'session.header.badges'] as const
    for (const slot of slots) {
      contributionsRef.current = {
        ...contributionsRef.current,
        badges: [
          {
            id: `badge-${slot}`,
            pluginId: 'demo',
            slot,
            label: { en: `Badge ${slot}`, fr: `Badge ${slot}` },
          },
        ],
      }
      const { container, unmount } = render(<PluginBadges slot={slot} context={{}} />)
      expect(container.textContent).toContain(`Badge ${slot}`)
      unmount()
    }
  })

  it('filters actions and badges with visibleWhen', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'needs-session',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Session only', fr: 'Session uniquement' },
          visibleWhen: { hasSession: true },
          onActivate: { kind: 'rpc', method: 'ping' },
        },
      ],
      badges: [
        {
          id: 'needs-message',
          pluginId: 'demo',
          slot: 'session.row.badges',
          label: { en: 'Message only', fr: 'Message uniquement' },
          visibleWhen: { hasMessage: true },
        },
      ],
    }

    const withoutSession = render(<PluginSlot slot="header.actions" context={{}} />)
    expect(withoutSession.container.innerHTML).toBe('')
    withoutSession.unmount()

    const withSession = render(<PluginSlot slot="header.actions" context={{ sessionId: 's1' }} />)
    expect(withSession.container.textContent).toContain('Session only')
    withSession.unmount()

    const withoutMessage = render(<PluginBadges slot="session.row.badges" context={{ sessionId: 's1' }} />)
    expect(withoutMessage.container.innerHTML).toBe('')
    withoutMessage.unmount()

    const withMessage = render(<PluginBadges slot="session.row.badges" context={{ messageId: 'm1' }} />)
    expect(withMessage.container.textContent).toContain('Message only')
  })

  it('opens a panel from a header action and renders it in the panel host', async () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'open-quota',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Open quota', fr: 'Ouvrir le quota' },
          onActivate: { kind: 'openPanel', panelId: 'quota' },
        },
      ],
      panels: [
        {
          id: 'quota',
          pluginId: 'demo',
          title: { en: 'Usage', fr: 'Utilisation' },
          kind: 'declarative',
          content: [{ type: 'text', text: { en: 'Live usage', fr: 'Utilisation en direct' } }],
        },
      ],
    }

    render(
      <>
        <PluginSlot slot="header.actions" context={{}} />
        <PluginPanelHost />
      </>,
    )
    expect(screen.queryByText('Usage')).toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Open quota' }))
    expect(screen.getByText('Usage')).toBeDefined()
    expect(screen.getByText('Live usage')).toBeDefined()
  })

  it('renders declarative panels with published values and closes on demand', async () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      panels: [
        {
          id: 'quota',
          pluginId: 'demo',
          title: { en: 'Usage', fr: 'Utilisation' },
          kind: 'declarative',
          content: [
            { type: 'keyValue', items: [{ key: { en: 'Remaining', fr: 'Restant' }, value: '{{tokens}}' }] },
            { type: 'progress', label: { en: 'Budget', fr: 'Budget' }, value: 25, max: 100 },
            { type: 'divider' },
          ],
        },
      ],
    }
    usePluginUiStore.setState({ activePanel: { pluginId: 'demo', panelId: 'quota' }, values: {} })
    usePluginUiStore.getState().setState('demo', 'quota', 'tokens', 1234)

    render(<PluginPanelHost />)
    expect(screen.getByText('Usage')).toBeDefined()
    expect(screen.getByText('1234')).toBeDefined()
    expect(screen.getByText('25 / 100')).toBeDefined()
  })

  it('renders iframe panels sandboxed from the plugin asset route', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      panels: [
        {
          id: 'board',
          pluginId: 'demo',
          title: { en: 'Board', fr: 'Tableau' },
          kind: 'iframe',
          url: 'board.html',
        },
      ],
    }
    usePluginUiStore.setState({
      activePanel: {
        pluginId: 'demo',
        panelId: 'board',
        context: { sessionId: 's1', projectId: 'p1', workdir: '/workspace/project' },
      },
      values: {},
    })
    render(<PluginPanelHost />)
    const iframe = screen.getByTitle('Board')
    const src = iframe.getAttribute('src') ?? ''
    const url = new URL(src, 'http://localhost')
    expect(url.pathname).toBe('/api/plugins/demo/assets/board.html')
    expect(url.searchParams.get('sessionId')).toBe('s1')
    expect(url.searchParams.get('projectId')).toBe('p1')
    expect(url.searchParams.get('workdir')).toBe('/workspace/project')
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
  })

  it('forwards the panel RPC context when refreshing an opened panel via initPanel', async () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'open-quota',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Open quota', fr: 'Ouvrir le quota' },
          onActivate: { kind: 'openPanel', panelId: 'quota' },
        },
      ],
      panels: [
        {
          id: 'quota',
          pluginId: 'demo',
          title: { en: 'Usage', fr: 'Utilisation' },
          kind: 'declarative',
          content: [{ type: 'text', text: { en: 'Live usage', fr: 'Utilisation en direct' } }],
        },
      ],
    }
    invokePluginRpc.mockResolvedValue(undefined)

    render(
      <>
        <PluginSlot slot="header.actions" context={{ sessionId: 's1', workdir: '/workspace/project' }} />
        <PluginPanelHost />
      </>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open quota' }))

    await waitFor(() =>
      expect(invokePluginRpc).toHaveBeenCalledWith(
        'demo',
        'initPanel',
        { panelId: 'quota' },
        { sessionId: 's1', workdir: '/workspace/project' },
      ),
    )
  })

  it('does not let an initPanel refresh clobber content supplied by the opening action', async () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'edit-pack',
          pluginId: 'demo',
          slot: 'header.actions',
          label: { en: 'Edit pack', fr: 'Modifier le pack' },
          onActivate: { kind: 'rpc', method: 'editPack' },
        },
      ],
      panels: [
        {
          id: 'publish',
          pluginId: 'demo',
          title: { en: 'Publish', fr: 'Publier' },
          kind: 'declarative',
          content: [],
        },
      ],
    }
    invokePluginRpc.mockImplementation(async (_pluginId: string, method: string) => {
      if (method === 'editPack') {
        return {
          ok: true,
          openPanel: 'publish',
          content: [{ type: 'text', text: { en: 'Prefilled pack', fr: 'Pack prérempli' } }],
        }
      }
      return { content: [{ type: 'text', text: { en: 'Default empty', fr: 'Vide par défaut' } }] }
    })

    render(
      <>
        <PluginSlot slot="header.actions" context={{}} />
        <PluginPanelHost />
      </>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit pack' }))

    expect(screen.getByText('Prefilled pack')).toBeDefined()
    expect(screen.queryByText('Default empty')).toBeNull()
    expect(invokePluginRpc).not.toHaveBeenCalledWith('demo', 'initPanel', expect.anything(), expect.anything())
  })

  it('pre-fills all pack fields (name, description, incremented version, components, MCP configs) upon opening publish modal via Edit RPC flow', async () => {
    const user = userEvent.setup()

    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'edit-pack-action',
          pluginId: 'pack-manager',
          slot: 'header.actions',
          label: { en: 'Modifier', fr: 'Modifier' },
          onActivate: { kind: 'rpc', method: 'editPack', params: { packId: 'pack-123' } },
        },
      ],
      panels: [
        {
          id: 'pack-publish',
          pluginId: 'pack-manager',
          title: { en: 'Publish Pack', fr: 'Publier le pack' },
          kind: 'declarative',
          content: [
            { type: 'input', id: 'pack-name', label: { en: 'Pack Name', fr: 'Nom du pack' }, defaultValue: '' },
            {
              type: 'input',
              id: 'pack-desc',
              inputType: 'textarea',
              label: { en: 'Description', fr: 'Description' },
              defaultValue: '',
            },
            { type: 'input', id: 'pack-version', label: { en: 'Version', fr: 'Version' }, defaultValue: '1.0.0' },
            {
              type: 'input',
              id: 'pack-component-toggle',
              inputType: 'checkbox',
              label: { en: 'Include Components', fr: 'Inclure les composants' },
              defaultChecked: false,
            },
            {
              type: 'input',
              id: 'pack-mcp-configs',
              label: { en: 'MCP Configs', fr: 'Configs MCP' },
              defaultValue: '',
            },
          ],
        },
      ],
    }

    invokePluginRpc.mockImplementation(async (pluginId, method) => {
      if (pluginId === 'pack-manager' && method === 'editPack') {
        return {
          openPanel: 'pack-publish',
          content: [
            {
              type: 'input',
              id: 'pack-name',
              label: { en: 'Pack Name', fr: 'Nom du pack' },
              defaultValue: 'Existing Pack',
            },
            {
              type: 'input',
              id: 'pack-desc',
              inputType: 'textarea',
              label: { en: 'Description', fr: 'Description' },
              defaultValue: 'Existing pack description for update',
            },
            { type: 'input', id: 'pack-version', label: { en: 'Version', fr: 'Version' }, defaultValue: '1.1.0' },
            {
              type: 'input',
              id: 'pack-component-toggle',
              inputType: 'checkbox',
              label: { en: 'Include Components', fr: 'Inclure les composants' },
              defaultChecked: true,
            },
            {
              type: 'input',
              id: 'pack-mcp-configs',
              label: { en: 'MCP Configs', fr: 'Configs MCP' },
              defaultValue: '{"server": "custom-mcp"}',
            },
          ],
        }
      }
      return undefined
    })

    render(
      <>
        <PluginSlot slot="header.actions" context={{}} />
        <PluginPanelHost />
      </>,
    )

    // Trigger Modifier (Edit) action
    const editBtn = screen.getByRole('button', { name: 'Modifier' })
    await user.click(editBtn)

    // Verify modal opens and all pre-filled fields are rendered with their updated values
    await waitFor(() => expect(screen.getByText('Publish Pack')).toBeDefined())

    const nameInput = screen.getByLabelText('Pack Name') as HTMLInputElement
    expect(nameInput.value).toBe('Existing Pack')

    const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement
    expect(descInput.value).toBe('Existing pack description for update')

    const versionInput = screen.getByLabelText('Version') as HTMLInputElement
    expect(versionInput.value).toBe('1.1.0')

    const checkbox = screen.getByLabelText('Include Components') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    const mcpInput = screen.getByLabelText('MCP Configs') as HTMLInputElement
    expect(mcpInput.value).toBe('{"server": "custom-mcp"}')
  })

  it('opens a clean empty form when clicking Share a Pack and isolates state from previous pre-filled sessions', async () => {
    const user = userEvent.setup()

    contributionsRef.current = {
      ...contributionsRef.current,
      actions: [
        {
          id: 'share-pack-action',
          pluginId: 'pack-manager',
          slot: 'header.actions',
          label: { en: 'Share a Pack', fr: 'Partager un pack' },
          onActivate: { kind: 'openPanel', panelId: 'pack-publish' },
        },
        {
          id: 'edit-pack-action',
          pluginId: 'pack-manager',
          slot: 'header.actions',
          label: { en: 'Modifier', fr: 'Modifier' },
          onActivate: { kind: 'rpc', method: 'editPack' },
        },
      ],
      panels: [
        {
          id: 'pack-publish',
          pluginId: 'pack-manager',
          title: { en: 'Publish Pack', fr: 'Publier le pack' },
          kind: 'declarative',
          content: [
            { type: 'input', id: 'pack-name', label: { en: 'Pack Name', fr: 'Nom du pack' }, defaultValue: '' },
            {
              type: 'input',
              id: 'pack-desc',
              inputType: 'textarea',
              label: { en: 'Description', fr: 'Description' },
              defaultValue: '',
            },
            { type: 'input', id: 'pack-version', label: { en: 'Version', fr: 'Version' }, defaultValue: '1.0.0' },
            {
              type: 'input',
              id: 'pack-component-toggle',
              inputType: 'checkbox',
              label: { en: 'Include Components', fr: 'Inclure les composants' },
              defaultChecked: false,
            },
          ],
        },
      ],
    }

    invokePluginRpc.mockImplementation(async (pluginId, method) => {
      if (pluginId === 'pack-manager' && method === 'editPack') {
        return {
          openPanel: 'pack-publish',
          content: [
            {
              type: 'input',
              id: 'pack-name',
              label: { en: 'Pack Name', fr: 'Nom du pack' },
              defaultValue: 'Modified Pack',
            },
            {
              type: 'input',
              id: 'pack-desc',
              inputType: 'textarea',
              label: { en: 'Description', fr: 'Description' },
              defaultValue: 'Modified pack description',
            },
            { type: 'input', id: 'pack-version', label: { en: 'Version', fr: 'Version' }, defaultValue: '2.0.0' },
            {
              type: 'input',
              id: 'pack-component-toggle',
              inputType: 'checkbox',
              label: { en: 'Include Components', fr: 'Inclure les composants' },
              defaultChecked: true,
            },
          ],
        }
      }
      return undefined
    })

    render(
      <>
        <PluginSlot slot="header.actions" context={{}} />
        <PluginPanelHost />
      </>,
    )

    // 1. Direct Share a Pack click -> clean empty form
    const shareBtn = screen.getByRole('button', { name: 'Share a Pack' })
    await user.click(shareBtn)

    expect(screen.getByText('Publish Pack')).toBeDefined()
    expect((screen.getByLabelText('Pack Name') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('Version') as HTMLInputElement).value).toBe('1.0.0')
    expect((screen.getByLabelText('Include Components') as HTMLInputElement).checked).toBe(false)

    // Close modal
    const closeBtn = screen.getByLabelText('Close')
    await user.click(closeBtn)
    await waitFor(() => expect(screen.queryByText('Publish Pack')).toBeNull())

    // 2. Click Modifier -> pre-filled form
    const editBtn = screen.getByRole('button', { name: 'Modifier' })
    await user.click(editBtn)
    await waitFor(() => expect(screen.getByText('Publish Pack')).toBeDefined())
    expect((screen.getByLabelText('Pack Name') as HTMLInputElement).value).toBe('Modified Pack')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Modified pack description')
    expect((screen.getByLabelText('Version') as HTMLInputElement).value).toBe('2.0.0')
    expect((screen.getByLabelText('Include Components') as HTMLInputElement).checked).toBe(true)

    // Close modal again (which clears panel-specific published state)
    const closeBtn2 = screen.getByLabelText('Close')
    await user.click(closeBtn2)
    await waitFor(() => expect(screen.queryByText('Publish Pack')).toBeNull())

    // 3. Re-open Share a Pack -> verify it opens clean again, not retaining previous edit pre-fills
    await user.click(shareBtn)
    await waitFor(() => expect(screen.getByText('Publish Pack')).toBeDefined())
    expect((screen.getByLabelText('Pack Name') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('Version') as HTMLInputElement).value).toBe('1.0.0')
    expect((screen.getByLabelText('Include Components') as HTMLInputElement).checked).toBe(false)
  })
})

describe('PluginZone and DeclarativeRenderer', () => {
  beforeEach(() => {
    contributionsRef.current = {
      actions: [],
      badges: [],
      panels: [],
      sections: [],
      settingsTabs: [],
      components: [],
      overrides: [],
    }
    invokePluginRpc.mockReset()
    usePluginUiStore.setState({ values: {}, activePanel: null })
    useLocaleStore.setState({ locale: 'en' })
  })

  it('renders native children when no components or overrides exist', () => {
    render(
      <PluginZone id="header.brand">
        <span data-testid="native-brand">My App</span>
      </PluginZone>,
    )
    expect(screen.getByTestId('native-brand').textContent).toBe('My App')
  })

  it('hides native content when override mode is hide', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      overrides: [
        {
          id: 'hide-brand',
          pluginId: 'demo',
          zone: 'header.brand',
          mode: 'hide',
        },
      ],
    }

    render(
      <PluginZone id="header.brand">
        <span data-testid="native-brand">My App</span>
      </PluginZone>,
    )
    expect(screen.queryByTestId('native-brand')).toBeNull()
  })

  it('replaces native content with declarative replacement when override mode is replace', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      overrides: [
        {
          id: 'replace-brand',
          pluginId: 'demo',
          zone: 'header.brand',
          mode: 'replace',
          replacement: {
            type: 'text',
            text: { en: 'Custom Brand', fr: 'Marque Custom' },
          },
        },
      ],
    }

    render(
      <PluginZone id="header.brand">
        <span data-testid="native-brand">My App</span>
      </PluginZone>,
    )
    expect(screen.queryByTestId('native-brand')).toBeNull()
    expect(screen.getByText('Custom Brand')).toBeDefined()
  })

  it('injects components before, inside, and after native content with proper ordering', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      components: [
        {
          id: 'after-comp',
          pluginId: 'demo',
          zone: 'sidebar.header',
          position: 'after',
          order: 100,
          component: { type: 'text', text: { en: 'After Text', fr: 'Texte Après' } },
        },
        {
          id: 'before-comp',
          pluginId: 'demo',
          zone: 'sidebar.header',
          position: 'before',
          order: 10,
          component: { type: 'text', text: { en: 'Before Text', fr: 'Texte Avant' } },
        },
      ],
    }

    const { container } = render(
      <PluginZone id="sidebar.header">
        <span data-testid="native-header">Native Header</span>
      </PluginZone>,
    )

    expect(screen.getByText('Before Text')).toBeDefined()
    expect(screen.getByTestId('native-header')).toBeDefined()
    expect(screen.getByText('After Text')).toBeDefined()
    expect(container.textContent).toBe('Before TextNative HeaderAfter Text')
  })

  it('renders nothing for an empty stack so a hidden header component leaves no full-width gap', () => {
    const { container } = render(<DeclarativeRenderer node={{ type: 'stack', direction: 'row', children: [] }} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders all rich declarative primitives (stack, card, callout, icon, input, select, button)', async () => {
    render(
      <DeclarativeRenderer
        node={{
          type: 'stack',
          direction: 'column',
          children: [
            {
              type: 'card',
              title: { en: 'Card Title', fr: 'Titre Carte' },
              children: [
                {
                  type: 'callout',
                  tone: 'warning',
                  title: { en: 'Warning', fr: 'Attention' },
                  text: { en: 'Be careful', fr: 'Attention' },
                },
                {
                  type: 'input',
                  id: 'test-input',
                  label: { en: 'Your Name', fr: 'Votre Nom' },
                  defaultValue: 'Alice',
                },
                {
                  type: 'select',
                  id: 'test-select',
                  label: { en: 'Choose', fr: 'Choisir' },
                  options: [{ value: 'opt1', label: { en: 'Option 1', fr: 'Option 1' } }],
                },
                {
                  type: 'button',
                  label: { en: 'Click Me', fr: 'Cliquez-moi' },
                  variant: 'primary',
                  onActivate: { kind: 'rpc', method: 'testAction' },
                },
              ],
            },
          ],
        }}
        context={{ pluginId: 'demo-plugin' }}
      />,
    )

    expect(screen.getByText('Card Title')).toBeDefined()
    expect(screen.getByText('Warning')).toBeDefined()
    expect(screen.getByText('Be careful')).toBeDefined()
    expect(screen.getByText('Your Name')).toBeDefined()
    expect(screen.getByDisplayValue('Alice')).toBeDefined()
    expect(screen.getByText('Choose')).toBeDefined()
    expect(screen.getByText('Option 1')).toBeDefined()

    const btn = screen.getByRole('button', { name: 'Click Me' })
    await userEvent.setup().click(btn)
    expect(invokePluginRpc).toHaveBeenCalledWith('demo-plugin', 'testAction', {}, {})
  })

  it('renders a ghost button matching native header buttons with icon and tooltip', async () => {
    invokePluginRpc.mockResolvedValue('ok')
    const { container } = render(
      <DeclarativeRenderer
        node={{
          type: 'button',
          label: { en: 'Plugin Button', fr: 'Bouton Plugin' },
          icon: 'puzzle',
          variant: 'ghost',
          onActivate: { kind: 'rpc', method: 'pluginAction' },
        }}
        context={{ pluginId: 'demo-plugin' }}
      />,
    )
    const btn = container.querySelector('button')
    expect(btn).toBeTruthy()
    expect(btn?.className).toContain('p-2.5 rounded hover:bg-bg-tertiary')
    expect(btn?.getAttribute('title')).toBe('Plugin Button')
    expect(btn?.getAttribute('aria-label')).toBe('Plugin Button')
    expect(btn?.textContent).toBe('') // icon only, no inner label span
    await userEvent.setup().click(btn!)
    expect(invokePluginRpc).toHaveBeenCalledWith('demo-plugin', 'pluginAction', {}, {})
  })

  it('renders ghost button text label when no icon is provided', () => {
    const { container } = render(
      <DeclarativeRenderer
        node={{
          type: 'button',
          label: { en: 'Cancel Action', fr: 'Annuler action' },
          variant: 'ghost',
          onActivate: { kind: 'rpc', method: 'cancel' },
        }}
        context={{ pluginId: 'demo-plugin' }}
      />,
    )
    const btn = container.querySelector('button')
    expect(btn).toBeTruthy()
    expect(btn?.textContent).toBe('Cancel Action')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders a custom SVG path icon provided directly by a plugin', () => {
    const customSvgPath = 'M3 13.5V11a9 9 0 0118 0v2.5M3 13.5h2.5M21 13.5h-2.5'
    const { container } = render(
      <DeclarativeRenderer
        node={{
          type: 'button',
          label: { en: 'Custom Gauge', fr: 'Jauge personnalisée' },
          icon: customSvgPath,
          variant: 'ghost',
          onActivate: { kind: 'rpc', method: 'gauge' },
        }}
        context={{ pluginId: 'demo-plugin' }}
      />,
    )
    const pathEl = container.querySelector('svg path')
    expect(pathEl).toBeTruthy()
    expect(pathEl?.getAttribute('d')).toBe(customSvgPath)
  })

  it('dynamically resolves icon from shared/icons without being in static whitelist', () => {
    const { container } = render(
      <DeclarativeRenderer
        node={{
          type: 'button',
          label: { en: 'Clock', fr: 'Horloge' },
          icon: 'ClockIcon',
          variant: 'ghost',
          onActivate: { kind: 'rpc', method: 'clock' },
        }}
        context={{ pluginId: 'demo-plugin' }}
      />,
    )
    const svgEl = container.querySelector('svg')
    expect(svgEl).toBeTruthy()
  })

  it('updates dynamic PluginZone components when plugin publishes reactive values', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      components: [
        {
          id: 'stats-cost-card',
          pluginId: 'model-pricing',
          zone: 'stats.modal.summary',
          position: 'after',
          component: {
            type: 'card',
            title: { en: 'Price', fr: 'Prix' },
            children: [{ type: 'text', text: { en: 'Cost: {{cost}}', fr: 'Coût: {{cost}}' } }],
          },
        },
      ],
    }

    usePluginUiStore.getState().setState('model-pricing', 'stats-cost-card', 'cost', '$0.42')

    render(
      <PluginZone id="stats.modal.summary">
        <span data-testid="native-summary">Native Summary</span>
      </PluginZone>,
    )

    expect(screen.getByTestId('native-summary')).toBeDefined()
    expect(screen.getByText('Price')).toBeDefined()
    expect(screen.getByText('Cost: $0.42')).toBeDefined()
  })

  it('resolves session-scoped reactive values in PluginZone when sessionId is present', () => {
    contributionsRef.current = {
      ...contributionsRef.current,
      components: [
        {
          id: 'headroom-stats-summary',
          pluginId: 'openfox-headroom',
          zone: 'stats.modal.summary',
          component: {
            type: 'card',
            title: { en: 'Headroom Token Optimization', fr: 'Optimisation des tokens Headroom' },
            children: [{ type: 'text', text: { en: 'Tokens Saved: {{saved}}', fr: 'Jetons économisés : {{saved}}' } }],
          },
        },
      ],
    }

    usePluginUiStore.getState().setState('openfox-headroom', 'headroom-stats-summary', 'sess-abc:saved', '1,250 tokens')

    render(
      <PluginZone id="stats.modal.summary" context={{ sessionId: 'sess-abc' }}>
        <span data-testid="native-summary">Native Summary</span>
      </PluginZone>,
    )

    expect(screen.getByText('Headroom Token Optimization')).toBeDefined()
    expect(screen.getByText('Tokens Saved: 1,250 tokens')).toBeDefined()
  })

  it('keeps focus and preserves typing flow across continuous input keystrokes in DeclarativeRenderer', async () => {
    const user = userEvent.setup()

    function InteractiveHost() {
      const [val] = useState('')
      return (
        <DeclarativeRenderer
          node={{
            type: 'input',
            id: 'pack-name-input',
            label: { en: 'Pack Name', fr: 'Nom du pack' },
            defaultValue: val,
            onChange: { kind: 'rpc', method: 'updateName' },
          }}
          values={{ 'pack-name-input': val }}
          context={{
            pluginId: 'test-plugin',
            fieldId: 'pack-name-input',
          }}
        />
      )
    }

    const { container } = render(<InteractiveHost />)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()

    input.focus()
    expect(document.activeElement).toBe(input)

    await user.type(input, 'SuperPack')

    // Verify input retains focus after continuous typing
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('SuperPack')
  })

  it('maintains focus in DeclarativeRenderer textarea during multiline typing', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <DeclarativeRenderer
        node={{
          type: 'input',
          id: 'desc-textarea',
          inputType: 'textarea',
          label: { en: 'Description', fr: 'Description' },
          defaultValue: '',
          onChange: { kind: 'rpc', method: 'updateDesc' },
        }}
        context={{ pluginId: 'test-plugin' }}
      />,
    )
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()

    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    await user.type(textarea, 'Line 1{enter}Line 2')
    expect(document.activeElement).toBe(textarea)
    expect(textarea.value).toBe('Line 1\nLine 2')
  })

  it('preserves keyboard focus when toggling a DeclarativeRenderer checkbox via Spacebar', async () => {
    const user = userEvent.setup()

    function CheckboxHost() {
      const [checked] = useState(false)
      return (
        <DeclarativeRenderer
          node={{
            type: 'input',
            id: 'option-check',
            inputType: 'checkbox',
            label: { en: 'Option', fr: 'Option' },
            defaultChecked: checked,
            onChange: { kind: 'rpc', method: 'toggleOption' },
          }}
          values={{ 'option-check': checked }}
          context={{ pluginId: 'test-plugin' }}
        />
      )
    }

    const { container } = render(<CheckboxHost />)
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).toBeTruthy()

    checkbox.focus()
    expect(document.activeElement).toBe(checkbox)

    await user.keyboard(' ')
    expect(document.activeElement).toBe(checkbox)
  })

  it('applies an external value that arrives while a text field is focused, once focus is released', async () => {
    const user = userEvent.setup()
    const node = {
      type: 'input' as const,
      id: 'pack-name',
      defaultValue: '{{name}}',
      onChange: { kind: 'rpc' as const, method: 'updateName' },
    }
    const context = { pluginId: 'test-plugin' }

    const view = render(<DeclarativeRenderer node={node} values={{ name: 'first' }} context={context} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('first')

    await user.click(input)
    expect(document.activeElement).toBe(input)

    // Server-side change lands mid-typing: it must not fight the user...
    view.rerender(<DeclarativeRenderer node={node} values={{ name: 'server-value' }} context={context} />)
    expect(input.value).toBe('first')

    // ...but it must not be dropped either — it applies when focus is released.
    await user.tab()
    await waitFor(() => expect(input.value).toBe('server-value'))
  })

  it('syncs a select with refreshed panel content while it is not focused', async () => {
    const node = {
      type: 'select' as const,
      id: 'install-scope',
      defaultValue: '{{scope}}',
      options: [
        { value: 'project', label: { en: 'Project', fr: 'Projet' } },
        { value: 'global', label: { en: 'Global', fr: 'Global' } },
      ],
      onChange: { kind: 'rpc' as const, method: 'updateScope' },
    }
    const context = { pluginId: 'test-plugin' }

    const view = render(<DeclarativeRenderer node={node} values={{ scope: 'project' }} context={context} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('project')

    view.rerender(<DeclarativeRenderer node={node} values={{ scope: 'global' }} context={context} />)
    expect(select.value).toBe('global')

    await userEvent.setup().selectOptions(select, 'project')
    expect(invokePluginRpc).toHaveBeenCalledWith(
      'test-plugin',
      'updateScope',
      { fieldId: 'install-scope', value: 'project' },
      {},
    )
  })
})

describe('activatePluginAction', () => {
  it('opens the settings modal on the tab requested by the plugin', async () => {
    await activatePluginAction('hello', { kind: 'openSettings', tab: 'plugin:hello:hello-tab' })
    await waitFor(() => expect(openSettings).toHaveBeenCalledWith('plugin:hello:hello-tab'))
  })

  it('opens the settings modal on its default tab when no tab is requested', async () => {
    await activatePluginAction('hello', { kind: 'openSettings' })
    await waitFor(() => expect(openSettings).toHaveBeenCalledWith(undefined))
  })
})

describe('EMPTY_PLUGIN_CONTRIBUTIONS', () => {
  it('is all zeros', () => {
    expect(Object.values(EMPTY_PLUGIN_CONTRIBUTIONS).every((value) => value === 0)).toBe(true)
  })
})
