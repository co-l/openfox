/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSettingsForm, resolveLinkButtonHref } from './PluginSettingsForm'
import { pluginSettingsResource } from '../../lib/resources'
import type { PluginSettingsData } from '../../lib/plugin-actions'

const settingsRef: { current: PluginSettingsData } = {
  current: {
    schema: {
      fields: [
        { key: 'endpoint', type: 'text', label: { en: 'Endpoint', fr: 'Endpoint' }, default: 'https://api.test' },
        { key: 'token', type: 'password', label: { en: 'Token', fr: 'Jeton' }, secret: true },
        { key: 'limit', type: 'number', label: { en: 'Limit', fr: 'Limite' }, required: true },
        { key: 'verbose', type: 'boolean', label: { en: 'Verbose', fr: 'Verbeux' } },
      ],
    },
    values: { limit: 5, verbose: true },
    secretsSet: ['token'],
  },
}

vi.mock('../../hooks/useResource', () => ({
  useResource: () => ({ data: settingsRef.current, loading: false, refresh: vi.fn() }),
}))

const savePluginSettings = vi.fn()
const invokePluginRpc = vi.fn()
vi.mock('../../lib/plugin-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plugin-actions')>()
  return {
    ...actual,
    savePluginSettings: (...args: unknown[]) => savePluginSettings(...args),
    invokePluginRpc: (...args: unknown[]) => invokePluginRpc(...args),
  }
})

describe('PluginSettingsForm', () => {
  beforeEach(() => {
    savePluginSettings.mockReset()
    savePluginSettings.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders schema fields with stored values and displays masked asterisks for configured secrets', () => {
    render(<PluginSettingsForm pluginId="demo" />)
    expect(screen.getByLabelText('Endpoint')).toHaveProperty('value', 'https://api.test')
    expect(screen.getByLabelText('Token')).toHaveProperty('value', '••••••••••••••••')
    expect(screen.getByLabelText('Limit')).toHaveProperty('value', '5')
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('auto-saves toggles and skips an untouched secret', async () => {
    render(<PluginSettingsForm pluginId="demo" />)
    await userEvent.setup().click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(savePluginSettings).toHaveBeenCalledWith(
        'demo',
        { endpoint: 'https://api.test', limit: 5, verbose: false },
        'global',
        undefined,
      ),
    )
  })

  it('saves values and skips an untouched secret', async () => {
    render(<PluginSettingsForm pluginId="demo" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(savePluginSettings).toHaveBeenCalledWith(
        'demo',
        { endpoint: 'https://api.test', limit: 5, verbose: true },
        'global',
        undefined,
      ),
    )
  })

  it('sends a secret when the user types one', async () => {
    render(<PluginSettingsForm pluginId="demo" />)
    await userEvent.setup().type(screen.getByLabelText('Token'), 'new-secret')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(savePluginSettings).toHaveBeenCalledWith(
        'demo',
        expect.objectContaining({ token: 'new-secret' }),
        'global',
        undefined,
      ),
    )
  })

  it('shows the server error on failure', async () => {
    savePluginSettings.mockResolvedValue({ ok: false, error: "Setting 'limit' must be a number" })
    render(<PluginSettingsForm pluginId="demo" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText("Setting 'limit' must be a number")).toBeDefined())
  })

  it('marks a freshly typed secret as set in the cache so the field switches to the mask', async () => {
    settingsRef.current = {
      schema: {
        fields: [{ key: 'token', type: 'password', secret: true, label: { en: 'Token', fr: 'Jeton' } }],
      },
      values: {},
      secretsSet: [],
    }
    const writeSpy = vi.spyOn(pluginSettingsResource, 'write')

    render(<PluginSettingsForm pluginId="demo" />)
    await userEvent.setup().type(screen.getByLabelText('Token'), 'new-secret')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(writeSpy).toHaveBeenCalled())
    const payload = writeSpy.mock.calls.at(-1)?.[0] as { secretsSet: string[] }
    expect(payload.secretsSet).toEqual(['token'])
  })

  it('saves project-scoped values when the user selects this project', async () => {
    settingsRef.current = {
      schema: {
        fields: [
          {
            key: 'endpoint',
            type: 'text',
            label: { en: 'Endpoint', fr: 'Endpoint' },
            scope: 'project',
          },
        ],
      },
      values: { endpoint: 'https://project.test' },
      secretsSet: [],
    }
    render(<PluginSettingsForm pluginId="demo" projectId="proj-1" />)

    const user = userEvent.setup()
    expect(screen.getByLabelText('Applies to')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Applies to'), 'project')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(savePluginSettings).toHaveBeenCalledWith(
        'demo',
        { endpoint: 'https://project.test' },
        'project',
        'proj-1',
      ),
    )
  })

  it('renders section headers when section is defined on fields', () => {
    settingsRef.current = {
      schema: {
        fields: [
          { key: 'general', type: 'boolean', label: { en: 'General Setting', fr: 'Paramètre Général' } },
          {
            key: 'usdInput',
            type: 'number',
            section: { en: 'USD Thresholds', fr: 'Seuils USD' },
            label: { en: 'USD Input', fr: 'Entrée USD' },
          },
          {
            key: 'usdOutput',
            type: 'number',
            section: { en: 'USD Thresholds', fr: 'Seuils USD' },
            label: { en: 'USD Output', fr: 'Sortie USD' },
          },
          {
            key: 'eurInput',
            type: 'number',
            section: { en: 'EUR Thresholds', fr: 'Seuils EUR' },
            label: { en: 'EUR Input', fr: 'Entrée EUR' },
          },
        ],
      },
      values: {},
      secretsSet: [],
    }
    render(<PluginSettingsForm pluginId="demo" />)
    expect(screen.getByText('USD Thresholds')).toBeDefined()
    expect(screen.getByText('EUR Thresholds')).toBeDefined()
    // USD Thresholds should only render once, not twice
    expect(screen.getAllByText('USD Thresholds')).toHaveLength(1)
  })

  it('hides the scope selector without project context', () => {
    settingsRef.current = {
      schema: {
        fields: [{ key: 'endpoint', type: 'text', label: { en: 'Endpoint', fr: 'Endpoint' }, scope: 'project' }],
      },
      values: {},
      secretsSet: [],
    }
    render(<PluginSettingsForm pluginId="demo" />)
    expect(screen.queryByLabelText('Applies to')).toBeNull()
  })

  it('renders a read-only field as disabled, shows its default and never saves it', async () => {
    settingsRef.current = {
      schema: {
        fields: [
          {
            key: 'officialUrl',
            type: 'text',
            readOnly: true,
            label: { en: 'Official URL', fr: 'URL officielle' },
            default: 'https://official.test/index.json',
          },
          {
            key: 'extraUrls',
            type: 'textarea',
            label: { en: 'Extra URLs', fr: 'URLs supplémentaires' },
            default: 'https://private.test/index.json',
          },
        ],
      },
      values: { officialUrl: 'https://stale.test/index.json', extraUrls: 'https://private.test/index.json' },
      secretsSet: [],
    }
    render(<PluginSettingsForm pluginId="demo" />)

    const official = screen.getByLabelText('Official URL') as HTMLInputElement
    expect(official.value).toBe('https://official.test/index.json')
    expect(official.disabled).toBe(true)

    const extra = screen.getByLabelText('Extra URLs') as HTMLTextAreaElement
    expect(extra.disabled).toBe(false)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(savePluginSettings).toHaveBeenCalledWith(
        'demo',
        { extraUrls: 'https://private.test/index.json' },
        'global',
        undefined,
      ),
    )
  })

  it('renders status field and refreshes after button action', async () => {
    invokePluginRpc.mockResolvedValueOnce({
      running: true,
      text: { en: 'Running (http://127.0.0.1:8787)', fr: 'Actif (http://127.0.0.1:8787)' },
      tone: 'success',
    })

    settingsRef.current = {
      schema: {
        fields: [
          {
            key: 'daemonStatus',
            type: 'status',
            label: { en: 'Server Status', fr: 'Statut du serveur' },
            rpcMethod: 'getStatus',
          },
          {
            key: 'restartProxy',
            type: 'button',
            label: { en: 'Restart', fr: 'Relancer' },
            buttonVariant: 'secondary',
            rpcMethod: 'restartProxy',
          },
        ],
      },
      values: {},
      secretsSet: [],
    }

    render(<PluginSettingsForm pluginId="demo" />)

    await waitFor(() => {
      expect(screen.getByText('Running (http://127.0.0.1:8787)')).toBeDefined()
    })

    invokePluginRpc.mockResolvedValueOnce({ success: true })
    invokePluginRpc.mockResolvedValueOnce({
      running: true,
      text: { en: 'Running after restart', fr: 'Actif après redémarrage' },
      tone: 'success',
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => {
      expect(invokePluginRpc).toHaveBeenCalledWith('demo', 'restartProxy', {})
      expect(screen.getByText('Running after restart')).toBeDefined()
    })
  })

  it('hides fields with hideWhenInstalled when status is installed', async () => {
    invokePluginRpc.mockResolvedValueOnce({
      installed: true,
      text: 'Installed (rtk 0.1.0)',
      tone: 'success',
    })

    settingsRef.current = {
      schema: {
        fields: [
          {
            key: 'daemonStatus',
            type: 'status',
            label: { en: 'CLI Status', fr: 'Statut du CLI' },
            rpcMethod: 'getStatus',
          },
          {
            key: 'installCli',
            type: 'button',
            label: { en: 'Install RTK CLI', fr: 'Installer le CLI RTK' },
            hideWhenInstalled: true,
            rpcMethod: 'installCli',
          },
        ],
      },
      values: {},
      secretsSet: [],
    }

    render(<PluginSettingsForm pluginId="demo" />)

    await waitFor(() => {
      expect(screen.getByText('Installed (rtk 0.1.0)')).toBeDefined()
    })

    expect(screen.queryByRole('button', { name: 'Install RTK CLI' })).toBeNull()
  })

  describe('list fields', () => {
    const listSchema = {
      fields: [
        {
          key: 'registries',
          type: 'list' as const,
          label: { en: 'Registries', fr: 'Registres' },
          addLabel: { en: 'Add registry', fr: 'Ajouter un registre' },
          itemFields: [
            {
              key: 'source',
              type: 'select' as const,
              label: { en: 'Source', fr: 'Source' },
              options: [
                { value: 'github', label: { en: 'GitHub', fr: 'GitHub' } },
                { value: 'gitlab', label: { en: 'GitLab', fr: 'GitLab' } },
              ],
              default: 'github',
            },
            { key: 'url', type: 'text' as const, label: { en: 'Registry URL', fr: 'URL du registre' } },
            { key: 'token', type: 'password' as const, secret: true, label: { en: 'Token', fr: 'Jeton' } },
          ],
        },
      ],
    }

    it('renders one inline row per item and keeps secrets masked', () => {
      settingsRef.current = {
        schema: listSchema,
        values: {
          registries: JSON.stringify([
            { source: 'github', url: 'https://github.test/index.json', token: '••••••••••••••••' },
            { source: 'gitlab', url: 'https://gitlab.test/index.json', token: '' },
          ]),
        },
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      const sources = screen.getAllByLabelText('Source') as HTMLSelectElement[]
      expect(sources).toHaveLength(2)
      expect(sources.map((select) => select.value)).toEqual(['github', 'gitlab'])

      const urls = screen.getAllByLabelText('Registry URL') as HTMLInputElement[]
      expect(urls.map((input) => input.value)).toEqual([
        'https://github.test/index.json',
        'https://gitlab.test/index.json',
      ])

      const tokens = screen.getAllByLabelText('Token') as HTMLInputElement[]
      expect(tokens.map((input) => input.type)).toEqual(['password', 'password'])
      expect(tokens.map((input) => input.value)).toEqual(['••••••••••••••••', ''])
    })

    it('appends a row with sub-field defaults and saves the whole list', async () => {
      settingsRef.current = {
        schema: listSchema,
        values: {
          registries: JSON.stringify([{ source: 'github', url: 'https://github.test/index.json', token: '' }]),
        },
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Add registry' }))
      const urls = screen.getAllByLabelText('Registry URL') as HTMLInputElement[]
      await user.type(urls[1]!, 'https://gitlab.test/index.json')

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(savePluginSettings).toHaveBeenCalledWith(
          'demo',
          {
            registries: JSON.stringify([
              { source: 'github', url: 'https://github.test/index.json', token: '' },
              { source: 'github', url: 'https://gitlab.test/index.json', token: '' },
            ]),
          },
          'global',
          undefined,
        ),
      )
    })

    it('removes a row and saves the remaining items', async () => {
      settingsRef.current = {
        schema: listSchema,
        values: {
          registries: JSON.stringify([
            { source: 'github', url: 'https://github.test/index.json', token: '••••••••••••••••' },
            { source: 'gitlab', url: 'https://gitlab.test/index.json', token: 'glpat_kept' },
          ]),
        },
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      const user = userEvent.setup()
      const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
      await user.click(removeButtons[0]!)
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(savePluginSettings).toHaveBeenCalledWith(
          'demo',
          {
            registries: JSON.stringify([
              { source: 'gitlab', url: 'https://gitlab.test/index.json', token: 'glpat_kept' },
            ]),
          },
          'global',
          undefined,
        ),
      )
    })

    it('edits a sub-field and sends the updated row', async () => {
      settingsRef.current = {
        schema: listSchema,
        values: {
          registries: JSON.stringify([{ source: 'github', url: '', token: '' }]),
        },
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      const user = userEvent.setup()
      await user.selectOptions(screen.getByLabelText('Source'), 'gitlab')
      await user.type(screen.getByLabelText('Token'), 'glpat_new')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(savePluginSettings).toHaveBeenCalledWith(
          'demo',
          { registries: JSON.stringify([{ source: 'gitlab', url: '', token: 'glpat_new' }]) },
          'global',
          undefined,
        ),
      )
    })
  })

  describe('link button', () => {
    const tokenLinkButton = {
      label: { en: 'Generate a token', fr: 'Générer un jeton' },
      href: 'https://github.com/settings/tokens/new',
      hrefByField: 'source',
      hrefByValue: {
        github: 'https://github.com/settings/tokens/new',
        gitlab: '{{url.origin}}/-/user_settings/personal_access_tokens',
      },
    }

    const linkSchema = {
      fields: [
        {
          key: 'registries',
          type: 'list' as const,
          label: { en: 'Registries', fr: 'Registres' },
          itemFields: [
            {
              key: 'source',
              type: 'select' as const,
              label: { en: 'Source', fr: 'Source' },
              options: [
                { value: 'github', label: { en: 'GitHub', fr: 'GitHub' } },
                { value: 'gitlab', label: { en: 'GitLab', fr: 'GitLab' } },
              ],
              default: 'github',
            },
            { key: 'url', type: 'text' as const, label: { en: 'Registry URL', fr: 'URL du registre' } },
            {
              key: 'token',
              type: 'password' as const,
              secret: true,
              label: { en: 'Token', fr: 'Jeton' },
              linkButton: tokenLinkButton,
            },
          ],
        },
      ],
    }

    it('resolves a static href, and the registry origin for a self-hosted GitLab', () => {
      expect(resolveLinkButtonHref(tokenLinkButton, { source: 'github', url: 'https://gitlab.test/x.json' })).toBe(
        'https://github.com/settings/tokens/new',
      )
      expect(resolveLinkButtonHref(tokenLinkButton, { source: 'gitlab', url: 'https://gitlab.test/g/x.json' })).toBe(
        'https://gitlab.test/-/user_settings/personal_access_tokens',
      )
      expect(resolveLinkButtonHref(tokenLinkButton, { source: 'gitlab', url: '' })).toBe(
        '/-/user_settings/personal_access_tokens',
      )
    })

    it('enables the GitHub row button and opens the token page on click', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      settingsRef.current = {
        schema: linkSchema,
        values: {
          registries: JSON.stringify([{ source: 'github', url: '', token: '' }]),
        },
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      const button = screen.getByRole('button', { name: 'Generate a token' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)

      await userEvent.setup().click(button)
      expect(openSpy).toHaveBeenCalledWith('https://github.com/settings/tokens/new', '_blank', 'noopener,noreferrer')
    })

    it('greys out the GitLab row button until the registry URL is filled, then targets its origin', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      settingsRef.current = {
        schema: linkSchema,
        values: {
          registries: JSON.stringify([{ source: 'gitlab', url: '', token: '' }]),
        },
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      const user = userEvent.setup()
      const button = screen.getByRole('button', { name: 'Generate a token' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)

      await user.click(button)
      expect(openSpy).not.toHaveBeenCalled()

      await user.type(screen.getByLabelText('Registry URL'), 'https://gitlab.example.com/g/r/-/raw/main/index.json')

      expect(button.disabled).toBe(false)
      await user.click(button)
      expect(openSpy).toHaveBeenCalledWith(
        'https://gitlab.example.com/-/user_settings/personal_access_tokens',
        '_blank',
        'noopener,noreferrer',
      )
    })

    it('renders the button next to a top-level field too', () => {
      settingsRef.current = {
        schema: {
          fields: [
            {
              key: 'token',
              type: 'password' as const,
              secret: true,
              label: { en: 'Token', fr: 'Jeton' },
              linkButton: { label: { en: 'Generate a token', fr: 'Générer un jeton' } },
            },
          ],
        },
        values: {},
        secretsSet: [],
      }

      render(<PluginSettingsForm pluginId="demo" />)

      expect((screen.getByRole('button', { name: 'Generate a token' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByLabelText('Token')).toBeDefined()
    })
  })
})
