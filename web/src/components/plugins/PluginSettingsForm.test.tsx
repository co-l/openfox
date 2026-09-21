/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSettingsForm } from './PluginSettingsForm'
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
vi.mock('../../lib/plugin-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plugin-actions')>()
  return { ...actual, savePluginSettings: (...args: unknown[]) => savePluginSettings(...args) }
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

  it('renders schema fields with stored values and never echoes secrets', () => {
    render(<PluginSettingsForm pluginId="demo" />)
    expect(screen.getByLabelText('Endpoint')).toHaveProperty('value', 'https://api.test')
    expect(screen.getByLabelText('Token')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Limit')).toHaveProperty('value', '5')
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
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
})
