// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EffortChangeGateProvider } from './EffortChangeGate'
import { clearCache } from '../../lib/resourceCache'
import { readAgents } from '../../lib/resources'

const mockSwitchMode = vi.fn().mockResolvedValue(undefined)
const mockPinEffort = vi.fn().mockResolvedValue({})
const mockClearPin = vi.fn().mockResolvedValue({})

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (s: unknown) => unknown) =>
    selector({
      switchMode: mockSwitchMode,
      pinSessionEffort: mockPinEffort,
      clearSessionEffortPin: mockClearPin,
    }),
}))

let mockSessionMode = 'builder'
let mockWarmCache = true

vi.mock('../../stores/session/session-scope', () => ({
  useSessionScope: () => 'session-1',
  useScopedPaneState: (_id: string, _pick: unknown, flatPick: (s: unknown) => unknown) =>
    flatPick({
      currentSession: { id: 'session-1', mode: mockSessionMode, providerReasoningEffort: 'high' },
      contextState: { warmCache: mockWarmCache },
    }),
}))

const mockAuthFetch = vi.hoisted(() => vi.fn())
let mockOverrides: Record<string, string> = {}

vi.mock('../../lib/api', () => ({
  authFetch: mockAuthFetch,
}))

vi.mock('../../lib/agents-actions', () => ({
  getAgentColor: () => '#3b82f6',
}))

vi.mock('../../hooks/useProviders', () => ({
  useProviders: () => ({ providers: [], activeProviderId: null, refresh: vi.fn(), loading: false }),
}))

vi.mock('../../hooks/useConfig', () => ({
  useConfig: () => ({
    config: { defaultModelSelection: null },
    refresh: vi.fn(),
    loading: false,
  }),
}))

vi.mock('../../hooks/useKeybindings', () => ({
  useKeybindings: () => ({ agentSwitching: [] }),
}))

vi.mock('../../hooks/useClickOutside', () => ({
  useClickOutside: () => {},
}))

vi.mock('../settings/AgentsModal', () => ({
  AgentsModal: () => null,
}))

vi.mock('../shared/icons', () => ({
  ChevronDownIcon: () => <svg>v</svg>,
  CheckIcon: () => <svg>✓</svg>,
}))

import { AgentSelector } from './AgentSelector'

function agentsPayload(overrides: Record<string, string>) {
  return {
    defaults: [
      { id: 'builder', name: 'Builder', subagent: false, allowedTools: [], description: '' },
      { id: 'explorer', name: 'Explorer', subagent: false, allowedTools: [], description: '' },
    ],
    userItems: [],
    projectItems: [],
    modelOverrides: overrides,
  }
}

async function renderSelector() {
  mockAuthFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => agentsPayload(mockOverrides),
  }))
  const utils = render(
    <EffortChangeGateProvider>
      <AgentSelector />
    </EffortChangeGateProvider>,
  )
  // Loadership is implicit: wait for the resource cache to land the payload so
  // the effort gate reads the current overrides.
  await waitFor(() => expect(readAgents()?.modelOverrides).toEqual(mockOverrides))
  await userEvent.click(screen.getByTitle('Switch agent'))
  return utils
}

function dropdownAgent(agentName: string): HTMLElement {
  // The trigger button echoes the current agent's name, so scope queries to
  // the dropdown menu (the absolutely-positioned list under the trigger).
  const buttons = screen.getAllByText(agentName)
  const target = buttons.find((b) => b.closest('div.absolute'))
  if (!target) throw new Error(`Dropdown entry for "${agentName}" not found`)
  return target
}

describe('AgentSelector — effort-change gate (case 2a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
    mockOverrides = {}
    mockSessionMode = 'builder'
    mockWarmCache = true
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('switches directly when the target agent has no effort override', async () => {
    await renderSelector()
    await userEvent.click(dropdownAgent('Explorer'))
    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockClearPin).not.toHaveBeenCalled()
  })

  it('switches directly when the target override effort matches the current effort', async () => {
    mockOverrides = { explorer: 'provider-1/model:high' }
    await renderSelector()
    await userEvent.click(dropdownAgent('Explorer'))
    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('switches directly on a cold cache even when efforts differ', async () => {
    mockOverrides = { explorer: 'provider-1/model:max' }
    mockWarmCache = false
    await renderSelector()
    await userEvent.click(dropdownAgent('Explorer'))
    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('gates and clears the pin on Apply', async () => {
    mockOverrides = { explorer: 'provider-1/model:max' }
    await renderSelector()
    await userEvent.click(dropdownAgent('Explorer'))

    expect(screen.getByText('Reasoning effort change')).toBeTruthy()
    expect(document.body.textContent).toContain('Explorer runs with reasoning effort max (currently high)')
    await userEvent.click(screen.getByText('Apply the reasoning effort (invalidates cache)'))
    expect(mockClearPin).toHaveBeenCalledWith('session-1')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('gates and pins the current effort on Keep', async () => {
    mockOverrides = { explorer: 'provider-1/model:max' }
    await renderSelector()
    await userEvent.click(dropdownAgent('Explorer'))
    await userEvent.click(screen.getByText('Keep current reasoning effort'))
    expect(mockPinEffort).toHaveBeenCalledWith('session-1', 'high')
    expect(mockClearPin).not.toHaveBeenCalled()
    expect(mockSwitchMode).toHaveBeenCalledWith('session-1', 'explorer')
  })

  it('ignores a click on the already-active agent', async () => {
    mockOverrides = { builder: 'provider-1/model:max' }
    await renderSelector()
    await userEvent.click(dropdownAgent('Builder'))
    expect(screen.queryByText('Reasoning effort change')).toBeNull()
    expect(mockSwitchMode).not.toHaveBeenCalled()
  })

  it('does not fetch agents again on re-render (loadership is implicit, not per-render)', async () => {
    const { rerender } = render(
      <EffortChangeGateProvider>
        <AgentSelector />
      </EffortChangeGateProvider>,
    )
    await waitFor(() => expect(readAgents()?.defaults.length).toBe(2))
    expect(mockAuthFetch).toHaveBeenCalledTimes(1)

    mockSessionMode = 'explorer'
    rerender(
      <EffortChangeGateProvider>
        <AgentSelector />
      </EffortChangeGateProvider>,
    )

    expect(mockAuthFetch).toHaveBeenCalledTimes(1)
  })
})
