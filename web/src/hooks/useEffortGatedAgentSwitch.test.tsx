// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EffortChangeGateProvider } from '../components/plan/EffortChangeGate'
import type { ReactNode } from 'react'

const mockSwitchMode = vi.fn().mockResolvedValue(undefined)
const mockPinEffort = vi.fn().mockResolvedValue({})
const mockClearPin = vi.fn().mockResolvedValue({})

vi.mock('../stores/session', () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({
      switchMode: mockSwitchMode,
      pinSessionEffort: mockPinEffort,
      clearSessionEffortPin: mockClearPin,
    }),
}))

let mockWarmCache = true
let mockOverrides: Record<string, string> = {}
let mockSession: Record<string, unknown> = { id: 'session-1', mode: 'builder', providerReasoningEffort: 'high' }
let mockProviders: Array<Record<string, unknown>> = []
let mockDefaultModelSelection: string | null = null

vi.mock('../stores/session/session-scope', () => ({
  useSessionScope: () => 'session-1',
  useScopedPaneState: (_id: string, _pick: unknown, flatPick: (s: unknown) => unknown) =>
    flatPick({
      currentSession: mockSession,
      contextState: { warmCache: mockWarmCache },
    }),
}))

vi.mock('../hooks/useResource', () => ({
  useResource: () => ({
    data: { defaults: [], userItems: [], projectItems: [], modelOverrides: mockOverrides },
    loading: false,
    error: undefined,
    refresh: vi.fn(),
  }),
  useResourceWhen: () => ({ data: undefined, loading: false, refresh: vi.fn() }),
}))

vi.mock('../stores/config', () => ({
  useConfigStore: (selector: (s: unknown) => unknown) =>
    selector({ providers: mockProviders, defaultModelSelection: mockDefaultModelSelection }),
}))

import { useEffortGatedAgentSwitch } from './useEffortGateContext'

function wrapper({ children }: { children: ReactNode }) {
  return <EffortChangeGateProvider>{children}</EffortChangeGateProvider>
}

describe('useEffortGatedAgentSwitch (criterion 4 — all agent-selection entry points)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOverrides = {}
    mockWarmCache = true
    mockSession = { id: 'session-1', mode: 'builder', providerReasoningEffort: 'high' }
    mockProviders = []
    mockDefaultModelSelection = null
  })

  it('switches directly when the target agent has no effort override', async () => {
    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    await result.current('explorer', 'Explorer')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockClearPin).not.toHaveBeenCalled()
  })

  it('switches directly when the override effort matches the current effort', async () => {
    mockOverrides = { explorer: 'provider-1/model:high' }
    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    await result.current('explorer', 'Explorer')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('switches directly on a cold cache', async () => {
    mockOverrides = { explorer: 'provider-1/model:max' }
    mockWarmCache = false
    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    await result.current('explorer', 'Explorer')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('gates and clears the pin on Apply, then switches mode', async () => {
    mockOverrides = { explorer: 'provider-1/model:max' }
    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    const switching = result.current('explorer', 'Explorer')

    await vi.waitFor(() => expect(document.body.textContent).toContain('Reasoning effort change'))
    expect(mockSwitchMode).not.toHaveBeenCalled()

    const applyButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Apply the reasoning effort'),
    )
    applyButton?.click()
    await switching
    expect(mockClearPin).toHaveBeenCalledWith('session-1')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('gates and pins the current effort on Keep, then switches mode', async () => {
    mockOverrides = { explorer: 'provider-1/model:max' }
    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    const switching = result.current('explorer', 'Explorer')

    await vi.waitFor(() => expect(document.body.textContent).toContain('Reasoning effort change'))

    const keepButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Keep current reasoning effort'),
    )
    keepButton?.click()
    await switching
    expect(mockPinEffort).toHaveBeenCalledWith('session-1', 'high')
    expect(mockClearPin).not.toHaveBeenCalled()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('does not gate when the current effort is a non-vocabulary model default (nothing to keep)', async () => {
    // The session's effective effort comes from the model's custom thinkingLevel,
    // which is not a storable vocabulary value — Keep could never pin it, so the
    // transition applies directly without the gate.
    mockSession = { id: 'session-1', mode: 'builder' }
    mockProviders = [
      {
        id: 'provider-1',
        name: 'P',
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        isLocal: true,
        models: [
          {
            id: 'model',
            contextWindow: 100000,
            source: 'backend',
            thinkingEnabled: true,
            thinkingLevel: 'turbo',
          },
        ],
      },
    ]
    mockDefaultModelSelection = 'provider-1/model'
    mockOverrides = { explorer: 'provider-1/model:max' }
    mockWarmCache = true

    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    await result.current('explorer', 'Explorer')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockClearPin).not.toHaveBeenCalled()
  })

  it('gates when switching to a non-override agent restores a differing session effort', async () => {
    // The current agent (builder) carries a ':low' override; the session's own
    // stored effort is ':max'. Switching to explorer (no override) would change
    // the effort back to ':max' — that must gate like any other effort change.
    mockSession = { id: 'session-1', mode: 'builder', providerReasoningEffort: 'max' }
    mockOverrides = { builder: 'provider-1/model:low' }
    mockWarmCache = true

    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    const switching = result.current('explorer', 'Explorer')

    await vi.waitFor(() => expect(document.body.textContent).toContain('Reasoning effort change'))
    expect(mockSwitchMode).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('max')

    const applyButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Apply the reasoning effort'),
    )
    applyButton?.click()
    await switching
    expect(mockClearPin).toHaveBeenCalledWith('session-1')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('keeps the current effort when switching to a non-override agent (pin preserves it)', async () => {
    mockSession = { id: 'session-1', mode: 'builder', providerReasoningEffort: 'max' }
    mockOverrides = { builder: 'provider-1/model:low' }
    mockWarmCache = true

    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    const switching = result.current('explorer', 'Explorer')

    await vi.waitFor(() => expect(document.body.textContent).toContain('Reasoning effort change'))

    const keepButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Keep current reasoning effort'),
    )
    keepButton?.click()
    await switching
    expect(mockPinEffort).toHaveBeenCalledWith('session-1', 'low')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('does not gate a switch to a non-override agent that keeps the same effort', async () => {
    // Builder's override and the session's stored effort are both ':high' —
    // switching to explorer (no override) keeps ':high', so no gate.
    mockSession = { id: 'session-1', mode: 'builder', providerReasoningEffort: 'high' }
    mockOverrides = { builder: 'provider-1/model:high' }
    mockWarmCache = true

    const { result } = renderHook(() => useEffortGatedAgentSwitch(), { wrapper })
    await result.current('explorer', 'Explorer')
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockClearPin).not.toHaveBeenCalled()
  })
})
