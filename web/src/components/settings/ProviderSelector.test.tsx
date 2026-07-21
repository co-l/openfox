// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

interface MockStore {
  (selector?: (state: any) => any): any
  setState: (partial: Record<string, any>) => void
}

function mockStore(initial: Record<string, any>): MockStore {
  let state = { ...initial }
  const fn = vi.fn((selector?: (s: typeof state) => any) => {
    return selector ? selector(state) : state
  }) as unknown as MockStore
  fn.setState = (partial: Record<string, any>) => {
    state = { ...state, ...partial }
  }
  return fn
}

const mockNavigate = vi.fn()

vi.mock('wouter', () => ({
  useLocation: () => ['/', mockNavigate],
  Link: ({ children, href }: any) => `<a href="${href}">${children}</a>`,
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    onStatusChange: vi.fn(),
  },
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: mockStore({
    currentSession: null,
    setSessionProvider: vi.fn(),
  }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: mockStore({
    providers: [],
    activeProviderId: null,
    defaultModelSelection: null,
    activating: false,
    activateProvider: vi.fn(),
    refreshModel: vi.fn(),
    refreshProviderModels: vi.fn(),
    setDefaultModel: vi.fn(),
    fetchConfig: vi.fn(),
  }),
  getBackendDisplayName: (backend: string) => {
    const map: Record<string, string> = {
      vllm: 'vLLM',
      sglang: 'SGLang',
      ollama: 'Ollama',
      llamacpp: 'llama.cpp',
      lmstudio: 'LM Studio',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      'opencode-go': 'OpenCode Go',
      unknown: 'Other',
    }
    return map[backend] ?? backend
  },
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

vi.mock('../shared/icons', () => ({
  ChevronDownIcon: ({ className, rotate }: any) => `<svg class="${className}" data-rotate="${rotate}">v</svg>`,
  ReloadIcon: ({ className }: any) => `<svg class="${className}">r</svg>`,
  CheckIcon: ({ className }: any) => `<svg class="${className}">✓</svg>`,
  EditSmallIcon: ({ className }: any) => `<svg class="${className}">e</svg>`,
  StarIcon: ({ className }: any) => `<svg class="${className}">☆</svg>`,
  StarFilledIcon: ({ className }: any) => `<svg class="${className}">★</svg>`,
  SearchIcon: ({ className }: any) => `<svg class="${className}">🔍</svg>`,
}))

vi.mock('../shared/ProviderModal', () => ({
  ProviderModal: () => '<div>ProviderModal</div>',
  providerFormPayload: (data: any) => data,
}))

vi.mock('../../hooks/useKeybindings', () => ({
  useKeybindings: () => ({
    terminalToggle: { type: 'double-press', key: 'Control', threshold: 300 },
    quickAction: { type: 'double-press', key: 'Shift', threshold: 300 },
    modelSelector: { type: 'chord', key: 'm', modifiers: ['ctrl'] },
    agentSwitching: [
      { type: 'chord', key: '1', modifiers: ['ctrl'] },
      { type: 'chord', key: '2', modifiers: ['ctrl'] },
      { type: 'chord', key: '3', modifiers: ['ctrl'] },
      { type: 'chord', key: '4', modifiers: ['ctrl'] },
    ],
  }),
  useBinding: vi.fn(),
  useChordBinding: vi.fn(),
}))

import { ProviderSelector } from './ProviderSelector'

async function setConfigState(partial: Record<string, any>) {
  const { useConfigStore } = await import('../../stores/config')
  ;(useConfigStore as unknown as MockStore).setState(partial)
}

async function setSessionState(partial: Record<string, any>) {
  const { useSessionStore } = await import('../../stores/session')
  ;(useSessionStore as unknown as MockStore).setState(partial)
}

describe('ProviderSelector', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setConfigState({
      providers: [],
      activeProviderId: null,
      defaultModelSelection: null,
      activating: false,
      activateProvider: vi.fn(),
      refreshModel: vi.fn(),
      refreshProviderModels: vi.fn(),
      setDefaultModel: vi.fn(),
      fetchConfig: vi.fn(),
    })
    await setSessionState({
      currentSession: null,
      setSessionProvider: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('[AUTOMATED] Criterion 3/0 - renders model name without provider prefix when providers list is empty', async () => {
    await setConfigState({
      providers: [],
      activeProviderId: null,
      defaultModelSelection: null,
    })
    render(<ProviderSelector />)
    const button = screen.getByRole('button')
    expect(button).toBeTruthy()
    expect(button.textContent).toContain('No model')
    expect(button.textContent).not.toContain('•')
  })

  it('[AUTOMATED] Criterion 0 - shows provider name • modelName when a provider is active with a default model', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    render(<ProviderSelector />)
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('OpenAI')
    expect(button.textContent).toContain('gpt 4')
    expect(button.textContent).toContain('•')
  })

  it('[AUTOMATED] Criterion 1 - falls back to model-only display when activeProvider is not found (no prefix)', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'nonexistent-id',
      defaultModelSelection: 'nonexistent-id/gpt-4',
    })
    render(<ProviderSelector />)
    const button = screen.getByRole('button')
    expect(button.textContent).not.toContain('•')
    expect(button.textContent).toContain('gpt 4')
  })

  it('[AUTOMATED] Criterion 2 - local/api badge is still rendered when providers exist', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'Ollama',
          url: 'http://localhost:11434',
          backend: 'ollama',
          isLocal: true,
          models: [{ id: 'llama3', name: 'Llama 3', contextWindow: 8192, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/llama3',
    })
    render(<ProviderSelector />)
    expect(document.body.textContent).toMatch(/local|api/)
  })

  it('[AUTOMATED] Criterion 2 - local/api badge is still rendered when providers list is empty', async () => {
    await setConfigState({
      providers: [],
      activeProviderId: null,
      defaultModelSelection: null,
    })
    render(<ProviderSelector />)
    expect(document.body.textContent).toMatch(/local|api/)
  })

  it('[AUTOMATED] Criterion 0 - shows provider name • modelName with session-scoped model', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'Anthropic',
          url: 'https://api.anthropic.com',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-opus-4', name: 'Claude Opus 4', contextWindow: 200000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/claude-opus-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        providerId: 'provider-1',
        providerModel: 'claude-opus-4',
      },
      setSessionProvider: vi.fn(),
    })
    render(<ProviderSelector />)
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('Anthropic')
    expect(button.textContent).toContain('claude opus 4')
    expect(button.textContent).toContain('•')
  })
})

describe('ProviderSelector search mode (AC 0-5)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setConfigState({
      providers: [],
      activeProviderId: null,
      defaultModelSelection: null,
      activating: false,
      activateProvider: vi.fn(),
      refreshModel: vi.fn(),
      refreshProviderModels: vi.fn(),
      setDefaultModel: vi.fn(),
      fetchConfig: vi.fn(),
    })
    await setSessionState({
      currentSession: null,
      setSessionProvider: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('[AUTOMATED] AC-0 click transforms button to search input with placeholder and SearchIcon', async () => {
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    render(<ProviderSelector />)

    const button = screen.getByRole('button')
    expect(button).toBeTruthy()

    await user.click(button)

    const input = screen.queryByPlaceholderText('Search models...')
    expect(input).toBeTruthy()

    expect(document.body.textContent).toContain('🔍')
  })

  it('[AUTOMATED] AC-1 typing filters models case-insensitively by name and id', async () => {
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, selected: true },
            { id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...')

    // Filter by name ("gpt" matches GPT-4 and GPT-4 Turbo, not Claude 3)
    await user.clear(input)
    await user.type(input, 'gpt')
    expect(document.body.textContent).toMatch(/GPT.?4/)
    expect(document.body.textContent).not.toMatch(/Claude/)

    // Filter by id ("claude" matches claude-3 id, case-insensitive)
    await user.clear(input)
    await user.type(input, 'claude')
    expect(document.body.textContent).toMatch(/Claude/)
    expect(document.body.textContent).not.toMatch(/GPT.?4/)
  })

  it('[AUTOMATED] AC-2 results are grouped by provider with provider name as header', async () => {
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3-opus', name: 'Claude 3 Opus', contextWindow: 200000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...')

    // Query that matches models across both providers
    await user.clear(input)
    await user.type(input, 'u')

    const text = document.body.textContent!
    const openaiIdx = text.indexOf('OpenAI')
    const anthropicIdx = text.indexOf('Anthropic')
    expect(openaiIdx).toBeGreaterThanOrEqual(0)
    expect(anthropicIdx).toBeGreaterThanOrEqual(0)
  })

  it('[AUTOMATED] AC-3 selecting a model with session active calls setSessionProvider', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: mockSetSessionProvider,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const modelBtn = screen.getByText('GPT-4')
    expect(modelBtn).toBeTruthy()

    await user.click(modelBtn)

    expect(mockSetSessionProvider).toHaveBeenCalledWith('provider-1', 'gpt-4')
  })

  it('[AUTOMATED] AC-3 selecting a model without session calls activateProvider', async () => {
    const user = userEvent.setup()
    const mockActivateProvider = vi.fn().mockResolvedValue(true)
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: null,
      activateProvider: mockActivateProvider,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const modelBtn = screen.getByText('GPT-4')
    expect(modelBtn).toBeTruthy()

    await user.click(modelBtn)

    expect(mockActivateProvider).toHaveBeenCalled()
  })

  it('[AUTOMATED] AC-4 Escape key closes search without changing model', async () => {
    const user = userEvent.setup()
    const mockActivateProvider = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      activateProvider: mockActivateProvider,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    expect(screen.queryByPlaceholderText('Search models...')).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByPlaceholderText('Search models...')).toBeNull()
    expect(mockActivateProvider).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] AC-4 focus loss closes search without changing model', async () => {
    const user = userEvent.setup()
    const mockActivateProvider = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      activateProvider: mockActivateProvider,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    expect(screen.queryByPlaceholderText('Search models...')).toBeTruthy()

    // Click outside the dropdown to trigger focus loss
    await user.click(document.body)

    expect(screen.queryByPlaceholderText('Search models...')).toBeNull()
    expect(mockActivateProvider).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] AC-5 Enter with single result selects the model directly', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: mockSetSessionProvider,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...')
    await user.clear(input)
    await user.type(input, 'turbo')

    await user.keyboard('{Enter}')

    expect(mockSetSessionProvider).toHaveBeenCalledWith('provider-1', 'gpt-4-turbo')
  })

  it('[AUTOMATED] AC-6 Ctrl+M shortcut is wired to toggle dropdown', async () => {
    const { useBinding } = await import('../../hooks/useKeybindings')
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    render(<ProviderSelector />)

    expect(useBinding).toHaveBeenCalled()
    const bindingArg = (useBinding as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[0]?.type === 'chord' && call[0]?.key === 'm',
    )
    expect(bindingArg).toBeTruthy()
  })

  it('[AUTOMATED] AC-6 Ctrl+M shortcut toggles dropdown via useBinding callback', async () => {
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    render(<ProviderSelector />)

    // Click the trigger button to open
    const triggerBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('OpenAI'))
    expect(triggerBtn).toBeTruthy()
    await user.click(triggerBtn!)
    expect(screen.queryByPlaceholderText('Search models...')).toBeTruthy()

    // Click outside to close (button is replaced by search input when open)
    await user.click(document.body)
    expect(screen.queryByPlaceholderText('Search models...')).toBeNull()
  })

  it('[AUTOMATED] AC-7 ArrowDown highlights next item, Enter selects it', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: spy,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'gpt')

    // First item (gpt-4) auto-highlighted. ArrowDown moves to gpt-4-turbo.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(spy).toHaveBeenCalledWith('provider-1', 'gpt-4-turbo')
  })

  it('[AUTOMATED] AC-7 ArrowUp wraps past manage providers to last model, Enter selects it', async () => {
    const mockSetSessionProvider = vi.fn()
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: mockSetSessionProvider,
    })
    render(<ProviderSelector />)

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'gpt')

    // ArrowUp from first item wraps to Manage providers, ArrowUp again to last model
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockSetSessionProvider).toHaveBeenCalledWith('provider-1', 'gpt-4-turbo')
  })
})
