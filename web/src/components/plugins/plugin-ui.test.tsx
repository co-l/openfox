/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSlot } from './PluginSlot'
import { PluginBadges } from './PluginBadges'
import { PluginPanelHost } from './PluginPanelHost'
import { PluginZone } from './PluginZone'
import { DeclarativeRenderer } from './DeclarativeRenderer'
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
})

describe('EMPTY_PLUGIN_CONTRIBUTIONS', () => {
  it('is all zeros', () => {
    expect(Object.values(EMPTY_PLUGIN_CONTRIBUTIONS).every((value) => value === 0)).toBe(true)
  })
})
