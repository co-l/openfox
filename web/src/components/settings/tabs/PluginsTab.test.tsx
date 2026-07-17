/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginsTab } from './PluginsTab'

const mockFetch = vi.fn()
vi.mock('../../../lib/api', () => ({
  authFetch: (...args: Parameters<typeof fetch>) => mockFetch(...args),
}))

const REGISTRY_RESPONSE = {
  plugins: [
    {
      name: 'openfox-chatgpt',
      displayName: 'ChatGPT',
      description: 'ChatGPT integration',
      githubUrl: 'https://github.com/arthurlacoste/openfox-chatgpt',
    },
    {
      name: 'openfox-github-copilot',
      displayName: 'GitHub Copilot',
      description: 'Copilot integration',
      githubUrl: 'https://github.com/JamesDAdams/openfox-github-copilot',
    },
  ],
}

const INSTALLED_RESPONSE = {
  installed: [
    { name: 'openfox-chatgpt', version: 'v1.0.0' },
  ],
}

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PluginsTab', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows loading state initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))
    render(<PluginsTab />)
    expect(screen.getByText('Loading plugins...')).toBeDefined()
  })

  it('renders registry plugins after loading', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse(REGISTRY_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(INSTALLED_RESPONSE))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText('ChatGPT')).toBeDefined()
    })
    expect(screen.getByText('GitHub Copilot')).toBeDefined()
    expect(screen.getByText('(openfox-chatgpt)')).toBeDefined()
  })

  it('shows error banner when registry fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse(null, 500))
      .mockResolvedValueOnce(createJsonResponse(INSTALLED_RESPONSE))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load plugin registry/)).toBeDefined()
    })
  })

  it('shows installed badge for installed plugins', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse(REGISTRY_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(INSTALLED_RESPONSE))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText('Installed ✓')).toBeDefined()
    })
  })

  it('shows empty state when no plugins exist', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse({ plugins: [] }))
      .mockResolvedValueOnce(createJsonResponse({ installed: [] }))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText('No plugins found.')).toBeDefined()
    })
  })

  it('shows duplicate warning when adding a plugin already in registry', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse(REGISTRY_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(INSTALLED_RESPONSE))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText('ChatGPT')).toBeDefined()
    })

    const nameInput = screen.getByPlaceholderText('my-plugin')
    const urlInput = screen.getByPlaceholderText('https://github.com/user/repo')
    const addButton = screen.getByRole('button', { name: 'Add' })

    await userEvent.setup().type(nameInput, 'openfox-chatgpt')
    await userEvent.setup().type(urlInput, 'https://github.com/arthurlacoste/openfox-chatgpt')
    await userEvent.setup().click(addButton)

    await waitFor(() => {
      expect(screen.getByText(/already listed in the registry/)).toBeDefined()
    })
  })

  it('can install a plugin via the install button', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse(REGISTRY_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(INSTALLED_RESPONSE))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText('GitHub Copilot')).toBeDefined()
    })

    mockFetch.mockResolvedValueOnce(createJsonResponse({ success: true, loaded: true }))

    const installButtons = screen.getAllByRole('button', { name: 'Install' })
    await userEvent.setup().click(installButtons[0]!)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/install', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  it('can remove an installed plugin', async () => {
    mockFetch
      .mockResolvedValueOnce(createJsonResponse(REGISTRY_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(INSTALLED_RESPONSE))

    render(<PluginsTab />)

    await waitFor(() => {
      expect(screen.getByText('Installed ✓')).toBeDefined()
    })

    mockFetch.mockResolvedValueOnce(createJsonResponse({ success: true }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const removeButton = screen.getByRole('button', { name: 'Remove' })
    await userEvent.setup().click(removeButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/openfox-chatgpt', expect.objectContaining({
        method: 'DELETE',
      }))
    })
  })
})
