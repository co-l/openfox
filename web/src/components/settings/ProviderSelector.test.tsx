// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EffortChangeGateProvider } from '../plan/EffortChangeGate'

interface MockStore {
  (selector?: (state: any) => any): any
  setState: (partial: Record<string, any>) => void
  getState: () => Record<string, any>
}

function mockStore(initial: Record<string, any>): MockStore {
  let state = { ...initial }
  const fn = vi.fn((selector?: (s: typeof state) => any) => {
    return selector ? selector(state) : state
  }) as unknown as MockStore
  fn.setState = (partial: Record<string, any> | ((s: Record<string, any>) => Record<string, any>)) => {
    state =
      typeof partial === 'function'
        ? { ...state, ...(partial as (s: Record<string, any>) => Record<string, any>)(state) }
        : { ...state, ...partial }
  }
  fn.getState = () => state
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
    resetSessionProvider: vi.fn(),
  }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: mockStore({
    activating: false,
    activateProvider: vi.fn(),
    refreshModel: vi.fn(),
    refreshProviderModels: vi.fn(),
    setDefaultModel: vi.fn(),
    updateModelSettings: vi.fn(),
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

const providerHookState = {
  providers: [] as any[],
  activeProviderId: null as string | null,
  defaultModelSelection: null as string | null,
}

vi.mock('../../hooks/useProviders', () => ({
  useProviders: () => ({
    providers: providerHookState.providers,
    activeProviderId: providerHookState.activeProviderId,
    refresh: vi.fn(),
    loading: false,
  }),
}))

vi.mock('../../hooks/useConfig', () => ({
  useConfig: () => ({
    config: { defaultModelSelection: providerHookState.defaultModelSelection },
    refresh: vi.fn(),
    loading: false,
  }),
}))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ providerId: null, model: null }),
    }),
  ),
}))

vi.mock('../shared/icons', () => ({
  ChevronDownIcon: ({ className, rotate }: any) => `<svg class="${className}" data-rotate="${rotate}">v</svg>`,
  ReloadIcon: ({ className }: any) => `<svg class="${className}">r</svg>`,
  CheckIcon: ({ className }: any) => `<svg class="${className}">✓</svg>`,
  EditSmallIcon: ({ className }: any) => `<svg class="${className}">e</svg>`,
  StarIcon: ({ className }: any) => `<svg class="${className}">☆</svg>`,
  StarFilledIcon: ({ className }: any) => `<svg class="${className}">★</svg>`,
  HeartIcon: ({ className }: any) => `<svg class="${className}">♡</svg>`,
  HeartFilledIcon: ({ className }: any) => `<svg class="${className}">♥</svg>`,
  SearchIcon: ({ className }: any) => `<svg class="${className}">🔍</svg>`,
  PinIcon: ({ className }: any) => `<svg class="${className}">📍</svg>`,
  PlusLgIcon: ({ className }: any) => `<svg class="${className}">+</svg>`,
}))

vi.mock('../shared/ProviderModal', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  return {
    ProviderModal: ({ editProvider }: any) =>
      React.createElement(
        'div',
        {
          'data-testid': 'provider-modal',
          'data-provider-id': editProvider?.id ?? '',
          'data-provider-name': editProvider?.name ?? '',
        },
        'ProviderModal',
      ),
    providerFormPayload: (data: any) => data,
  }
})

vi.mock('../onboarding/steps/ConnectLLMStep', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  return {
    ConnectLLMStep: ({ onNext }: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'connect-llm-step' },
        React.createElement('button', { onClick: () => onNext({ providers: [] }) }, 'mock next'),
      ),
  }
})

const { mockAgentsData } = vi.hoisted(() => ({
  mockAgentsData: {
    defaults: [
      { id: 'planner', name: 'Planner', color: '#a855f7', subagent: false, allowedTools: [], description: '' },
      { id: 'builder', name: 'Builder', color: '#3b82f6', subagent: false, allowedTools: [], description: '' },
    ],
    userItems: [] as unknown[],
    projectItems: [] as unknown[],
    modelOverrides: {} as Record<string, string>,
  },
}))

vi.mock('../../lib/agents-actions', () => ({
  getAgentColor: () => '#a855f7',
}))

vi.mock('../../hooks/useResource', () => ({
  useResource: () => ({ data: mockAgentsData, loading: false, error: undefined, refresh: vi.fn() }),
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

const { mockSettings, mockSetSetting } = vi.hoisted(() => ({
  mockSettings: {} as Record<string, string>,
  mockSetSetting: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: mockSettings[key] ?? fallback, loading: false }),
}))

vi.mock('../../lib/resources', async (importOriginal) => ({
  ...(await importOriginal()),
  setSetting: mockSetSetting,
}))

import { ProviderSelector } from './ProviderSelector'

const { SETTINGS_KEYS } = await import('../../lib/resources')

async function setSettingsState(partial: Record<string, any>) {
  // Replace, not merge — mirror the store's setState({ settings }) semantics so
  // a setting from a previous test can never leak into the next one.
  for (const key of Object.keys(mockSettings)) delete mockSettings[key]
  Object.assign(mockSettings, partial.settings ?? {})
}

async function setConfigState(partial: Record<string, any>) {
  const { useConfigStore } = await import('../../stores/config')
  ;(useConfigStore as unknown as MockStore).setState(partial)
  if ('providers' in partial) providerHookState.providers = partial.providers
  if ('activeProviderId' in partial) providerHookState.activeProviderId = partial.activeProviderId
  if ('defaultModelSelection' in partial) providerHookState.defaultModelSelection = partial.defaultModelSelection
}

async function setSessionState(partial: Record<string, any>) {
  const { useSessionStore } = await import('../../stores/session')
  ;(useSessionStore as unknown as MockStore).setState(partial)
}

async function setAgentsState(partial: Record<string, any>) {
  Object.assign(mockAgentsData, partial)
}

function renderProviderSelector(): ReturnType<typeof render> {
  return render(
    <EffortChangeGateProvider>
      <ProviderSelector />
    </EffortChangeGateProvider>,
  )
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
    await setSettingsState({
      settings: {},
      loading: {},
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
    renderProviderSelector()
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
    renderProviderSelector()
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
    renderProviderSelector()
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
    renderProviderSelector()
    expect(document.body.textContent).toMatch(/local|api/)
  })

  it('[AUTOMATED] Criterion 2 - local/api badge is still rendered when providers list is empty', async () => {
    await setConfigState({
      providers: [],
      activeProviderId: null,
      defaultModelSelection: null,
    })
    renderProviderSelector()
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
    renderProviderSelector()
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('Anthropic')
    expect(button.textContent).toContain('claude opus 4')
    expect(button.textContent).toContain('•')
  })

  it('[AUTOMATED] shows agent override indicator when current agent has model override in store', async () => {
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
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: { planner: 'provider-1/gpt-4' },
    })
    renderProviderSelector()
    // Colored dot should be rendered (indicates override is active)
    const dot = document.querySelector('.w-2\\.5')
    expect(dot).toBeTruthy()
  })

  it('[AUTOMATED] no agent override indicator when agent has no model override', async () => {
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
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: {},
    })
    renderProviderSelector()
    const dot = document.querySelector('.w-2\\.5')
    expect(dot).toBeFalsy()
  })

  it('[AUTOMATED] reacts to modelOverrides store changes', async () => {
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
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: {},
    })
    const { rerender } = renderProviderSelector()
    // Initially no dot
    let dot = document.querySelector('.w-2\\.5')
    expect(dot).toBeFalsy()

    // Update store with override
    await setAgentsState({
      modelOverrides: { planner: 'provider-1/gpt-4' },
    })
    rerender(
      <EffortChangeGateProvider>
        <ProviderSelector />
      </EffortChangeGateProvider>,
    )

    // Dot should appear
    dot = document.querySelector('.w-2\\.5')
    expect(dot).toBeTruthy()
  })
})

describe('ProviderSelector search mode (AC 0-5)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await setAgentsState({ modelOverrides: {} })
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
    renderProviderSelector()

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
    renderProviderSelector()

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
    renderProviderSelector()

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
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4-mini', name: 'GPT-4 Mini', contextWindow: 128000, selected: true },
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const modelBtn = screen.getByText('GPT-4 Mini')
    expect(modelBtn).toBeTruthy()

    await user.click(modelBtn)

    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4-mini', null)
  })

  it('[AUTOMATED] starring a model with an active session sets the default AND selects it for the session', async () => {
    const user = userEvent.setup()
    const mockSetDefaultModel = vi.fn().mockResolvedValue(true)
    const mockSetSessionProvider = vi.fn().mockResolvedValue({ id: 'session-1' })
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
            { id: 'gpt-4-mini', name: 'GPT-4 Mini', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      setDefaultModel: mockSetDefaultModel,
    })
    await setSessionState({
      currentSession: { id: 'session-1', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const starBtn = screen.getByTitle('Set as default model')
    await user.click(starBtn)

    expect(mockSetDefaultModel).toHaveBeenCalledWith('provider-1', 'gpt-4-mini')
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4-mini', null)
    // Starring behaves like picking a model: the picker closes
    expect(screen.queryByPlaceholderText('Search models...')).toBeNull()
  })

  it('[AUTOMATED] no session renders no star button (default-only path is unreachable via UI)', async () => {
    const user = userEvent.setup()
    const mockSetDefaultModel = vi.fn()
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
      setDefaultModel: mockSetDefaultModel,
    })
    await setSessionState({ currentSession: null })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    expect(screen.queryByTitle('Set as default model')).toBeNull()
    expect(screen.queryByTitle('Default model')).toBeNull()
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
    renderProviderSelector()

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
    renderProviderSelector()

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
    renderProviderSelector()

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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...')
    await user.clear(input)
    await user.type(input, 'turbo')

    await user.keyboard('{Enter}')

    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4-turbo', null)
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
    renderProviderSelector()

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
    renderProviderSelector()

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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'gpt')

    // First item (gpt-4) auto-highlighted. ArrowDown moves to gpt-4-turbo.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(spy).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4-turbo', null)
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'gpt')

    // ArrowUp from first item wraps to Manage providers, ArrowUp again to last model
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4-turbo', null)
  })

  it('[AUTOMATED] Manage providers opens a modal instead of navigating to /onboarding', async () => {
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Manage providers'))

    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding')
    expect(screen.queryByTestId('connect-llm-step')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Add Provider/ })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined()
  })

  it('[AUTOMATED] Enter on the highlighted Manage providers entry opens the modal, not onboarding', async () => {
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const input = screen.getByPlaceholderText('Search models...') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'gpt')

    // ArrowUp wraps from the first model to Manage providers, Enter activates it
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding')
    expect(screen.queryByTestId('connect-llm-step')).not.toBeNull()
  })

  it('[AUTOMATED] Manage providers modal closes and refreshes the provider list', async () => {
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Manage providers'))
    expect(screen.queryByTestId('connect-llm-step')).not.toBeNull()

    await user.click(screen.getByText('mock next'))

    expect(screen.queryByTestId('connect-llm-step')).toBeNull()
    const { useConfigStore } = await import('../../stores/config')
    const state = (useConfigStore as unknown as MockStore)((s: any) => s)
    expect(state.fetchConfig).toHaveBeenCalled()
  })

  it('[AUTOMATED] provider header shows an edit button that opens the provider modal for that provider', async () => {
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3-opus', name: 'Claude 3 Opus', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const editButtons = screen.getAllByRole('button', { name: /Edit provider/i })
    expect(editButtons).toHaveLength(2)

    // Click the edit button for the Anthropic provider
    await user.click(screen.getByRole('button', { name: /Edit provider Anthropic/ }))

    const modal = screen.getByTestId('provider-modal')
    expect(modal).toBeTruthy()
    expect(modal.getAttribute('data-provider-id')).toBe('provider-2')
    expect(modal.getAttribute('data-provider-name')).toBe('Anthropic')
  })

  it('[AUTOMATED] highlights the effective override model as active, not the session preference', async () => {
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com/v1',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', mode: 'planner', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: { planner: 'provider-2/claude-3' },
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const overrideRow = screen.getByText('Claude 3').parentElement!
    const sessionRow = screen.getByText('GPT-4').parentElement!
    expect(overrideRow.textContent).toContain('✓')
    expect(sessionRow.textContent).not.toContain('✓')
  })

  it('[AUTOMATED] highlights the session model as active when no override is set', async () => {
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com/v1',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', mode: 'planner', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: {},
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const overrideRow = screen.getByText('Claude 3').parentElement!
    const sessionRow = screen.getByText('GPT-4').parentElement!
    expect(sessionRow.textContent).toContain('✓')
    expect(overrideRow.textContent).not.toContain('✓')
  })

  it('[AUTOMATED] provider header pick marks the session manual without touching the agent override', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn()
    const { authFetch } = await import('../../lib/api')
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com/v1',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: { id: 'session-1', mode: 'planner', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: mockSetSessionProvider,
    })
    await setAgentsState({ modelOverrides: { planner: 'provider-2/claude-3' } })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // Click the Anthropic provider header (a provider-level pick)
    await user.click(screen.getAllByText('Anthropic')[0]!)

    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-2', undefined)
    // The agent override must NOT be deleted — the manual pick suppresses it
    // for this session only, leaving the agent's stored config intact.
    expect(authFetch).not.toHaveBeenCalledWith('/api/agents/planner/model', { method: 'DELETE' })
    expect(mockAgentsData.modelOverrides).toEqual({ planner: 'provider-2/claude-3' })
  })

  it('[AUTOMATED] a manual pick suppresses the override highlight for the session', async () => {
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com/v1',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerManual: true,
        providerManualActive: true,
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: { planner: 'provider-2/claude-3' },
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // The manual pick wins over the agent override within this session.
    const overrideRow = screen.getByText('Claude 3').parentElement!
    const sessionRow = screen.getByText('GPT-4').parentElement!
    expect(sessionRow.textContent).toContain('✓')
    expect(overrideRow.textContent).not.toContain('✓')
    // No override dot — the override is suppressed, not active.
    expect(document.querySelector('.w-2\\.5')).toBeFalsy()
  })

  it('[AUTOMATED] an inactive manual pick yields to the override highlight', async () => {
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com/v1',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerManual: true,
        providerManualActive: false,
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({
      modelOverrides: { planner: 'provider-2/claude-3' },
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // The agent override (label) wins when the manual pick is inactive.
    const overrideRow = screen.getByText('Claude 3').parentElement!
    const sessionRow = screen.getByText('GPT-4').parentElement!
    expect(overrideRow.textContent).toContain('✓')
    expect(sessionRow.textContent).not.toContain('✓')
  })

  it('[AUTOMATED] reset to default clears the manual pick', async () => {
    const user = userEvent.setup()
    const mockReset = vi.fn()
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
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerManual: true,
      },
      setSessionProvider: vi.fn(),
      resetSessionProvider: mockReset,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const resetBtn = screen.getByText('Reset to default')
    expect(resetBtn).toBeTruthy()
    await user.click(resetBtn)

    expect(mockReset).toHaveBeenCalledWith('session-1')
  })

  it('[AUTOMATED] reset to default is available for a legacy stored preference', async () => {
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
        {
          id: 'provider-2',
          name: 'Anthropic',
          url: 'https://api.anthropic.com/v1',
          backend: 'anthropic',
          isLocal: false,
          models: [{ id: 'claude-3', name: 'Claude 3', contextWindow: 200000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-2',
        providerModel: 'claude-3',
        // Legacy row: provider_manual defaults to 0, but the stored provider
        // differs from the global default and must be clearable.
        providerManual: false,
      },
      setSessionProvider: vi.fn(),
      resetSessionProvider: vi.fn(),
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Reset to default')).toBeTruthy()
  })

  it('[AUTOMATED] reset to default is hidden for a fresh inherited default preference', async () => {
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
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerManual: false,
      },
      setSessionProvider: vi.fn(),
      resetSessionProvider: vi.fn(),
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('Reset to default')).toBeNull()
  })

  it('[AUTOMATED] shows model:effort in the stats-bar label for a session effort pick', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerReasoningEffort: 'high',
        providerManual: true,
        providerManualActive: true,
      },
      setSessionProvider: vi.fn(),
    })
    renderProviderSelector()
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('gpt 4')
    expect(button.textContent).toContain(':high')
  })

  it('[AUTOMATED] falls back to the model thinkingLevel for the stats-bar label when no explicit effort', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              thinkingEnabled: true,
              thinkingLevel: 'high',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    renderProviderSelector()
    const button = screen.getByRole('button')
    expect(button.textContent).toContain(':high')
  })

  it('[AUTOMATED] renders effort chips in the dropdown and switching effort calls setSessionProvider', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // Effort chips are rendered for the model
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    expect(chips.length).toBe(3)

    // Clicking an effort chip picks the model at that effort (manual session pick)
    await user.click(chips[0]!)
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'low')
  })

  it('[AUTOMATED] agent override effort appears in the stats-bar label', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high', 'max'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({ modelOverrides: { planner: 'provider-1/gpt-4:max' } })
    renderProviderSelector()
    const button = screen.getByRole('button')
    expect(button.textContent).toContain(':max')
  })

  it('[AUTOMATED] a pinned effort (Keep current) wins over the agent override in the stats-bar label', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high', 'max'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerPinnedEffort: 'medium',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({ modelOverrides: { planner: 'provider-1/gpt-4:max' } })
    renderProviderSelector()
    const button = screen.getByRole('button')
    // The pin ("Keep current reasoning effort") wins over the agent's max.
    expect(button.textContent).toContain(':medium')
    expect(button.textContent).not.toContain(':max')
    // A pin indicator is shown so the label distinguishes a pinned effort from
    // an agent override or a plain session pick.
    expect(button.textContent).toContain('📍')
  })

  it('[AUTOMATED] no pin indicator when the effort is not pinned', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({ modelOverrides: { planner: 'provider-1/gpt-4:max' } })
    renderProviderSelector()
    expect(screen.getByRole('button').textContent).not.toContain('📍')
  })

  it('[AUTOMATED] a pinned effort wins over an active manual pick in the label', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerReasoningEffort: 'none',
        providerManual: true,
        providerManualActive: true,
        providerPinnedEffort: 'high',
      },
      setSessionProvider: vi.fn(),
    })
    renderProviderSelector()
    // The pin (the most recent "keep" intent) beats the active manual pick.
    expect(screen.getByRole('button').textContent).toContain(':high')
    expect(screen.getByRole('button').textContent).toContain('📍')
  })

  it('[AUTOMATED] unpin affordance clears the pinned effort from the dropdown', async () => {
    const user = userEvent.setup()
    const mockClearPin = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high', 'max'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerPinnedEffort: 'medium',
      },
      setSessionProvider: vi.fn(),
      clearSessionEffortPin: mockClearPin,
    })
    await setAgentsState({ modelOverrides: { planner: 'provider-1/gpt-4:max' } })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const unpin = screen.getByText('Unpin reasoning effort')
    expect(unpin).toBeTruthy()
    await user.click(unpin)
    expect(mockClearPin).toHaveBeenCalledWith('session-1')
  })

  it('[AUTOMATED] no unpin affordance when nothing is pinned', async () => {
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
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
      clearSessionEffortPin: vi.fn(),
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('Unpin reasoning effort')).toBeNull()
  })

  it('[AUTOMATED] effort pick on a warm cache shows the gate; Apply commits the pick', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: true },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // Click an effort chip that differs from the current (thinkingLevel medium).
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)

    // The gate modal appears; Apply commits the manual pick.
    expect(screen.getByText('Reasoning effort change')).toBeTruthy()
    await user.click(screen.getByText('Apply the reasoning effort (invalidates cache)'))
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'low')
  })

  it('[AUTOMATED] effort pick gate: Keep proceeds with the model pick but preserves the current effort', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: true },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)

    expect(screen.getByText('Reasoning effort change')).toBeTruthy()
    await user.click(screen.getByText('Keep current reasoning effort'))
    // Keep does NOT discard the pick: it commits the model at the current
    // effort (thinkingLevel medium) so the pick continues cache-safely.
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'medium')
  })

  it('[AUTOMATED] effort pick on a cold cache applies immediately without the gate', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: false },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)

    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'low')
  })

  it('[AUTOMATED] effort pick does not gate when the current effort is a non-vocabulary model default', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'turbo',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: true },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)

    // The current effort is a custom thinkingLevel — not storable, so "Keep"
    // could never pin it. The transition applies directly without the gate.
    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'low')
  })

  it('[AUTOMATED] a failed provider write rolls back the optimistic session update', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn().mockResolvedValue(null)
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerReasoningEffort: 'high',
      },
      contextState: { warmCache: false },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    const { useSessionStore } = await import('../../stores/session')

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)
    await vi.waitFor(() => expect(mockSetSessionProvider).toHaveBeenCalled())

    // The optimistic pick was rolled back once the server rejected the write:
    // the session keeps its original provider/model and effort.
    const current = (useSessionStore as unknown as MockStore)((s: any) => s.currentSession)
    expect(current?.providerReasoningEffort).toBe('high')
    expect(current?.providerModel).toBe('gpt-4')
  })

  it('[AUTOMATED] the dropdown stays open when the provider write fails (no silent success)', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn().mockResolvedValue(null)
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerReasoningEffort: 'high',
      },
      contextState: { warmCache: false },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)
    await vi.waitFor(() => expect(mockSetSessionProvider).toHaveBeenCalled())

    // The write failed: the dropdown is still open (search input present) so the
    // user can retry instead of being shown a silent no-op.
    expect(screen.queryByPlaceholderText('Search models...')).toBeTruthy()
  })

  it('[AUTOMATED] the label shows the sent (clamped) effort, not the raw agent override', async () => {
    // The agent override carries ':max', but the model's preset list only
    // advertises low/medium/high — the server clamps 'max' to 'low', so the
    // label must show ':low' (the value actually sent), not ':max'.
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    await setAgentsState({ modelOverrides: { planner: 'provider-1/gpt-4:max' } })
    renderProviderSelector()

    expect(screen.getByRole('button').textContent).toContain(':low')
    expect(screen.getByRole('button').textContent).not.toContain(':max')
  })

  it('[AUTOMATED] clicking the already-active model row is a no-op and does not clear the effort', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
        providerReasoningEffort: 'high',
      },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const activeRow = screen.getByText('GPT-4')
    await user.click(activeRow)

    // No write at all: re-clicking the active model must not silently clear the
    // session effort (it is a no-op pick).
    expect(mockSetSessionProvider).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] a non-vocabulary reasoningEffortOverride is shown in the label as the fallback effort', async () => {
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
              reasoningEffortOverride: 'deep',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    renderProviderSelector()

    // The override (raw value) is the model default shown in the selector.
    expect(screen.getByRole('button').textContent).toContain(':deep')
  })

  it('[AUTOMATED] a non-vocabulary override does not gate an effort pick (nothing storable to keep)', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
              reasoningEffortOverride: 'deep',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: true },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)

    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'low')
  })

  it('[AUTOMATED] a vocabulary reasoningEffortOverride highlights its preset chip', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
              reasoningEffortOverride: 'high',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // The override (a vocabulary value) is the effective default → the 'high'
    // preset chip is highlighted as the active effort.
    const highChip = screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'high')
    expect(highChip?.className).toContain('bg-accent-primary/10')
    const mediumChip = screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'medium')
    expect(mediumChip?.className).not.toContain('bg-accent-primary/10')
  })

  it('[AUTOMATED] a non-active model with a pinned effort highlights its chip in the dropdown', async () => {
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
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
            {
              id: 'gpt-5',
              name: 'GPT-5',
              contextWindow: 128000,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'high',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      setSessionProvider: vi.fn(),
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // gpt-5 is not selected but has 'high' pinned → its chip is highlighted.
    const gpt5EffortBox = screen.getByLabelText('Reasoning efforts for gpt-5')
    const gpt5High = Array.from(gpt5EffortBox.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'high')
    expect(gpt5High?.className).toContain('bg-accent-primary/10')
    const gpt5Medium = Array.from(gpt5EffortBox.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'medium',
    )
    expect(gpt5Medium?.className).not.toContain('bg-accent-primary/10')

    // The active model keeps its own highlight (medium).
    const gpt4EffortBox = screen.getByLabelText('Reasoning efforts for gpt-4')
    const gpt4Medium = Array.from(gpt4EffortBox.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'medium',
    )
    expect(gpt4Medium?.className).toContain('bg-accent-primary/10')
    const gpt4High = Array.from(gpt4EffortBox.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'high')
    expect(gpt4High?.className).not.toContain('bg-accent-primary/10')
  })

  it('[AUTOMATED] effort pick on a warm cache + Apply persists the effort as the model default', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn().mockResolvedValue(true)
    const mockUpdateModelSettings = vi.fn().mockResolvedValue(true)
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      updateModelSettings: mockUpdateModelSettings,
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: true },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)
    await user.click(screen.getByText('Apply the reasoning effort (invalidates cache)'))

    // The committed effort becomes the model's default for future sessions.
    expect(mockUpdateModelSettings).toHaveBeenCalledWith('provider-1', 'gpt-4', {
      thinkingLevel: 'low',
      thinkingEnabled: true,
    })
  })

  it('[AUTOMATED] effort pick on a cold cache persists the effort as the model default', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn().mockResolvedValue(true)
    const mockUpdateModelSettings = vi.fn().mockResolvedValue(true)
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      updateModelSettings: mockUpdateModelSettings,
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: false },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)

    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockUpdateModelSettings).toHaveBeenCalledWith('provider-1', 'gpt-4', {
      thinkingLevel: 'low',
      thinkingEnabled: true,
    })
  })

  it('[AUTOMATED] effort pick gate: Keep does NOT change the model default', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn()
    const mockUpdateModelSettings = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      updateModelSettings: mockUpdateModelSettings,
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: true },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)
    await user.click(screen.getByText('Keep current reasoning effort'))

    // Keep declines the clicked effort entirely: the session keeps the current
    // effort and the model default stays untouched.
    expect(mockUpdateModelSettings).not.toHaveBeenCalled()
    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4', 'medium')
  })

  it('[AUTOMATED] a plain model click (no effort) does not touch the model default', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn()
    const mockUpdateModelSettings = vi.fn()
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
            { id: 'gpt-4-mini', name: 'GPT-4 Mini', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      updateModelSettings: mockUpdateModelSettings,
    })
    await setSessionState({
      currentSession: { id: 'session-1', providerId: 'provider-1', providerModel: 'gpt-4' },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('GPT-4 Mini'))

    expect(mockSetSessionProvider).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4-mini', null)
    expect(mockUpdateModelSettings).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] a failed session write does not persist the effort as the model default', async () => {
    const user = userEvent.setup()
    const mockSetSessionProvider = vi.fn().mockResolvedValue(null)
    const mockUpdateModelSettings = vi.fn()
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              contextWindow: 128000,
              selected: true,
              reasoningEfforts: ['low', 'medium', 'high'],
              thinkingEnabled: true,
              thinkingLevel: 'medium',
            },
          ],
          isActive: true,
        },
      ],
      activeProviderId: 'provider-1',
      defaultModelSelection: 'provider-1/gpt-4',
      updateModelSettings: mockUpdateModelSettings,
    })
    await setSessionState({
      currentSession: {
        id: 'session-1',
        mode: 'planner',
        providerId: 'provider-1',
        providerModel: 'gpt-4',
      },
      contextState: { warmCache: false },
      setSessionProvider: mockSetSessionProvider,
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))
    const chips = screen.getAllByRole('button').filter((b) => ['low', 'medium', 'high'].includes(b.textContent ?? ''))
    await user.click(chips[0]!)
    await vi.waitFor(() => expect(mockSetSessionProvider).toHaveBeenCalled())

    // The pick was rejected, so the model default must stay untouched.
    expect(mockUpdateModelSettings).not.toHaveBeenCalled()
  })

  it('renders with full_height height classes when configured in display settings', async () => {
    const user = userEvent.setup()
    await setSettingsState({
      settings: {
        'display.modelSelectorHeight': 'full_height',
      },
    })
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    const dropdown = screen.getByPlaceholderText('Search models...').closest('div[class*="absolute bottom-full"]')
    expect(dropdown?.className).toContain('h-[calc(100vh-6.5rem)]')
  })

  it('collapses provider model lists on open when collapseProvidersByDefault is true', async () => {
    const user = userEvent.setup()
    await setSettingsState({
      settings: {
        'display.collapseProvidersByDefault': 'true',
      },
    })
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI Provider',
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
    const { rerender } = render(
      <EffortChangeGateProvider>
        <ProviderSelector />
      </EffortChangeGateProvider>,
    )

    await user.click(screen.getByRole('button'))

    // Provider header is visible, but model list is collapsed
    expect(screen.getByText('OpenAI Provider')).toBeTruthy()
    expect(screen.queryByText('GPT-4')).toBeNull()

    // Clicking provider expands models
    await user.click(screen.getByTitle('Show models'))
    expect(screen.getByText('GPT-4')).toBeTruthy()

    // When provider list in store updates (e.g. models reloaded), expanded state persists
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI Provider',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [
            { id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true },
            { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, selected: true },
          ],
          isActive: true,
        },
      ],
    })
    rerender(
      <EffortChangeGateProvider>
        <ProviderSelector />
      </EffortChangeGateProvider>,
    )

    expect(screen.getByText('GPT-4')).toBeTruthy()
    expect(screen.getByText('GPT-4o')).toBeTruthy()
  })

  it('shows favorites section at the top and toggles favorite heart', async () => {
    const user = userEvent.setup()
    await setSettingsState({
      settings: {
        'display.modelFavorites': JSON.stringify(['provider-1/gpt-4']),
      },
    })
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI Provider',
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // Favorites section appears at the top
    const favoritesHeader = screen.getByText('Favorites')
    expect(favoritesHeader).toBeTruthy()
    const providerHeader = screen.getByText('OpenAI Provider')
    expect(favoritesHeader.compareDocumentPosition(providerHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Favorite model is visible and heart is filled
    const removeButtons = screen.getAllByTitle('Remove from favorites')
    expect(removeButtons.length).toBeGreaterThanOrEqual(1)

    // Toggle off favorite (click the first one — in the Favorites section)
    await user.click(removeButtons[0]!)
    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_MODEL_FAVORITES, '[]')
  })

  it('hides favorites that no longer exist after provider/model removed', async () => {
    const user = userEvent.setup()
    await setSettingsState({
      settings: {
        'display.modelFavorites': JSON.stringify(['provider-1/gpt-4', 'provider-2/missing']),
      },
    })
    await setConfigState({
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI Provider',
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
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    // Only the valid favorite is shown; the missing one is filtered out
    expect(screen.getByText('Favorites')).toBeTruthy()
    const removeButtons = screen.getAllByTitle('Remove from favorites')
    expect(removeButtons.length).toBe(2)
  })

  it('does not display backend subtitle for plugin providers (authAdapter / transportAdapter)', async () => {
    const user = userEvent.setup()
    await setConfigState({
      providers: [
        {
          id: 'copilot-plugin',
          name: 'GitHub Copilot',
          url: 'https://api.githubcopilot.com',
          backend: 'openai',
          authAdapter: 'github-copilot-auth',
          transportAdapter: 'github-copilot-transport',
          isLocal: false,
          models: [{ id: 'copilot-gpt-4', name: 'Copilot GPT-4', contextWindow: 128000, selected: true }],
          isActive: false,
        },
        {
          id: 'standard-openai',
          name: 'Direct OpenAI',
          url: 'https://api.openai.com/v1',
          backend: 'openai',
          isLocal: false,
          models: [{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, selected: true }],
          isActive: false,
        },
      ],
      activeProviderId: 'standard-openai',
    })
    renderProviderSelector()

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('GitHub Copilot')).toBeTruthy()
    expect(screen.getByText('Direct OpenAI')).toBeTruthy()

    // OpenAI backend subtitle should be displayed for standard-openai but not for copilot-plugin
    const openaiSubtitles = screen.getAllByText('OpenAI')
    expect(openaiSubtitles.length).toBe(1)
  })
})
