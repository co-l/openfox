// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../hooks/useIsTouchDevice', () => ({ useIsTouchDevice: () => true }))

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'disconnected' }) })),
}))

const { providers, settings, storeStub } = vi.hoisted(() => ({
  providers: [
    {
      id: 'provider-1',
      name: 'OpenAI',
      url: 'https://api.openai.com/v1',
      backend: 'openai',
      isLocal: false,
      models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000, selected: true }],
    },
  ],
  settings: {} as Record<string, string>,
  storeStub: Object.assign(vi.fn(), { setState: vi.fn(), getState: () => ({}) }),
}))

vi.mock('../../hooks/useProviders', () => ({
  useProviders: () => ({ providers, activeProviderId: 'provider-1' }),
}))

vi.mock('../../hooks/useConfig', () => ({
  useConfig: () => ({ config: { defaultModelSelection: 'provider-1/gpt-4' } }),
}))

vi.mock('../../stores/config', () => ({
  useConfigStore: storeStub,
  getBackendDisplayName: (b: string) => b,
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: vi.fn(() => null),
}))

vi.mock('../../stores/session/session-scope', () => ({
  useSessionScope: () => null,
  useScopedPaneState: (_id: unknown, _sel: unknown, fallback: unknown) => fallback,
}))

vi.mock('../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: settings[key] ?? fallback, loading: false }),
}))

vi.mock('../../hooks/useResource', () => ({
  useResource: () => ({ data: { defaults: [], userItems: [], modelOverrides: {} }, loading: false }),
}))

vi.mock('../../hooks/useKeybindings', () => ({
  useKeybindings: () => ({}),
  useBinding: vi.fn(),
}))

vi.mock('../../components/plan/EffortChangeGate', () => ({
  useEffortChangeGate: () => ({ requestEffortSwitch: vi.fn() }),
}))

import { ProviderSelector } from './ProviderSelector'

function openDropdown() {
  fireEvent.click(screen.getByRole('button'))
}

describe('ProviderSelector touch modal panel', () => {
  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key]
  })
  afterEach(cleanup)

  it('renders a viewport-contained modal panel in default mode on touch', () => {
    render(<ProviderSelector />)
    openDropdown()
    expect(screen.getByTestId('provider-dropdown').getAttribute('data-panel')).toBe('modal')
  })

  it('renders a viewport-contained modal panel in full_height mode on touch', () => {
    settings['display.modelSelectorHeight'] = 'full_height'
    render(<ProviderSelector />)
    openDropdown()
    expect(screen.getByTestId('provider-dropdown').getAttribute('data-panel')).toBe('modal')
  })
})
