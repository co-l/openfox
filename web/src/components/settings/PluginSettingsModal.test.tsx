/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginSettingsModal } from './PluginSettingsModal'
import { setLocale } from '@shared/i18n/index.js'

const mockFetch = vi.fn()
vi.mock('../../lib/api', () => ({
  authFetch: (...args: Parameters<typeof fetch>) => mockFetch(...args),
}))

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PluginSettingsModal', () => {
  beforeEach(() => {
    setLocale('en')
    mockFetch.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders settings fields and saves changes', async () => {
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        hasSpec: true,
        spec: {
          title: 'ChatGPT Plugin Settings',
          description: 'Configure API settings',
          fields: [
            { key: 'apiKey', label: 'API Key', type: 'password', required: true },
            { key: 'enableStream', label: 'Stream Responses', type: 'boolean', defaultValue: true },
          ],
        },
        values: { enableStream: true },
      }),
    )

    const onClose = vi.fn()
    render(
      <PluginSettingsModal isOpen={true} onClose={onClose} pluginName="openfox-chatgpt" pluginDisplayName="ChatGPT" />,
    )

    await waitFor(() => {
      expect(screen.getByText('ChatGPT Plugin Settings')).toBeDefined()
    })
    expect(screen.getByText('Configure API settings')).toBeDefined()
    expect(screen.getByText('API Key')).toBeDefined()

    const passwordInput = screen.getByLabelText('API Key *') as HTMLInputElement
    expect(passwordInput.value).toBe('')

    await userEvent.setup().type(passwordInput, 'sk-456')

    mockFetch.mockResolvedValueOnce(
      createJsonResponse({ success: true, values: { apiKey: 'sk-456', enableStream: true } }),
    )

    const saveButton = screen.getByRole('button', { name: 'Save Settings' })
    await userEvent.setup().click(saveButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/plugins/openfox-chatgpt/settings',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })
  })

  it('blocks save when a required field is empty', async () => {
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        hasSpec: true,
        spec: {
          title: 'Required Plugin Settings',
          fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
        },
        values: {},
      }),
    )

    render(
      <PluginSettingsModal isOpen={true} onClose={vi.fn()} pluginName="openfox-req" pluginDisplayName="Required" />,
    )

    await waitFor(() => {
      expect(screen.getByText('Required Plugin Settings')).toBeDefined()
    })

    const saveButton = screen.getByRole('button', { name: 'Save Settings' })
    await userEvent.setup().click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('API Key is required')).toBeDefined()
    })
    expect(mockFetch).not.toHaveBeenCalledWith(
      '/api/plugins/openfox-req/settings',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders custom UI iframe when customUiUrl is set', async () => {
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        hasSpec: true,
        spec: {
          title: 'Custom Plugin Settings',
          customUiUrl: 'http://localhost:3000/plugin-ui',
        },
        values: {},
      }),
    )

    render(
      <PluginSettingsModal isOpen={true} onClose={vi.fn()} pluginName="openfox-custom" pluginDisplayName="Custom" />,
    )

    await waitFor(() => {
      expect(screen.getByTitle('Custom Custom UI')).toBeDefined()
    })
  })

  it('renders translated French labels in fr locale', async () => {
    setLocale('fr')
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        hasSpec: true,
        spec: {
          title: 'Paramètres du plugin',
          fields: [{ key: 'apiKey', label: 'Clé API', type: 'password', required: true }],
        },
        values: {},
      }),
    )

    render(
      <PluginSettingsModal isOpen={true} onClose={vi.fn()} pluginName="openfox-fr" pluginDisplayName="MonPlugin" />,
    )

    await waitFor(() => {
      expect(screen.getByText('Paramètres du plugin')).toBeDefined()
    })

    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Enregistrer les paramètres' })).toBeDefined()

    const saveButton = screen.getByRole('button', { name: 'Enregistrer les paramètres' })
    await userEvent.setup().click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('Clé API est requis')).toBeDefined()
    })
  })

  it('allows saving when required password was already configured', async () => {
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        hasSpec: true,
        spec: {
          title: 'Configured Plugin Settings',
          fields: [
            { key: 'apiKey', label: 'API Key', type: 'password', required: true },
            { key: 'port', label: 'Port', type: 'number', required: true },
          ],
        },
        values: { port: 8080 },
        configuredKeys: ['apiKey'],
      }),
    )

    render(
      <PluginSettingsModal isOpen={true} onClose={vi.fn()} pluginName="openfox-conf" pluginDisplayName="ConfPlugin" />,
    )

    await waitFor(() => {
      expect(screen.getByText('(configured)')).toBeDefined()
    })

    mockFetch.mockResolvedValueOnce(createJsonResponse({ success: true, values: { port: 9000 } }))

    const saveButton = screen.getByRole('button', { name: 'Save Settings' })
    await userEvent.setup().click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully!')).toBeDefined()
      expect(screen.getByText('Close')).toBeDefined()
    })
  })

  it('allows saving when required boolean field is false', async () => {
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        hasSpec: true,
        spec: {
          title: 'Boolean Plugin Settings',
          fields: [{ key: 'enabled', label: 'Enable Feature', type: 'boolean', required: true }],
        },
        values: { enabled: false },
      }),
    )

    render(
      <PluginSettingsModal isOpen={true} onClose={vi.fn()} pluginName="openfox-bool" pluginDisplayName="BoolPlugin" />,
    )

    await waitFor(() => {
      expect(screen.getByText('Enable Feature')).toBeDefined()
    })

    mockFetch.mockResolvedValueOnce(createJsonResponse({ success: true, values: { enabled: false } }))

    const saveButton = screen.getByRole('button', { name: 'Save Settings' })
    await userEvent.setup().click(saveButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/plugins/openfox-bool/settings',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
