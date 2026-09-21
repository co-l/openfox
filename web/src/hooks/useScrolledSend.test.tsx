// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EffortChangeGateProvider } from '../components/plan/EffortChangeGate'
import type { ReactNode } from 'react'

const mockLaunch = vi.fn()
const mockPinEffort = vi.fn().mockResolvedValue({})
const mockClearPin = vi.fn().mockResolvedValue({})
const { mockFetchWorkflow } = vi.hoisted(() => ({
  mockFetchWorkflow: vi.fn(),
}))

vi.mock('../stores/session', () => ({
  useSessionStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        sendMessage: vi.fn(),
        launchWorkflow: mockLaunch,
        pinSessionEffort: mockPinEffort,
        clearSessionEffortPin: mockClearPin,
      }),
    { getState: () => ({ currentSession: null, panes: {} }) },
  ),
}))

const mockOverrides: Record<string, string> = {}

vi.mock('../lib/resources', () => ({
  readAgents: () => ({ defaults: [], userItems: [], projectItems: [], modelOverrides: mockOverrides }),
  readAllWorkflows: () => [{ id: 'w1', name: 'Deep Dive', description: '', version: '1', scope: 'builtin' }],
  workflowResource: { refresh: mockFetchWorkflow },
}))

vi.mock('../lib/workflow-scope', () => ({
  resolveWorkflowForLaunch: (workflows: Array<{ id: string }>, id: string) => workflows.find((w) => w.id === id),
}))

vi.mock('../lib/model-value', () => ({
  parseModelValue: (value: string | undefined) => {
    if (!value) return undefined
    const [providerId, modelEffort] = value.split('/')
    const [model, reasoningEffort] = (modelEffort ?? '').split(':')
    return { providerId, model, reasoningEffort }
  },
}))

vi.mock('../lib/effort-gate', () => ({
  shouldGateEffortChange: (opts: { warmCache?: boolean; currentEffort?: string; proposedEffort?: string }) =>
    !!opts.warmCache && !!opts.proposedEffort && opts.proposedEffort !== opts.currentEffort,
  resolveWorkflowFirstAgentId: (workflow: {
    entryStep: string
    steps: Array<{ id: string; type: string; agentId?: string }>
  }) => workflow.steps.find((s) => s.id === workflow.entryStep)?.agentId,
}))

vi.mock('./useEffortGateContext', () => ({
  useEffortGateContext: () => ({
    sessionId: 's1',
    currentEffort: mockCurrentEffort,
    warmCache: mockWarmCache,
    gate: { requestEffortSwitch: mockRequestEffortSwitch },
  }),
}))

let mockCurrentEffort: string | undefined = 'high'
let mockWarmCache = true
const mockRequestEffortSwitch = vi.fn()

import { useScrolledSend } from './useScrolledSend'

const fullWorkflow = {
  metadata: { id: 'w1', name: 'Deep Dive', description: '', version: '1' },
  entryStep: 'step1',
  settings: { maxIterations: 10 },
  steps: [{ id: 'step1', name: 'Plan', type: 'agent', agentId: 'planner', phase: 'build', transitions: [] }],
}

function wrapper({ children }: { children: ReactNode }) {
  return <EffortChangeGateProvider>{children}</EffortChangeGateProvider>
}

describe('useScrolledSend — workflow launch gate (case 2b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOverrides.planner = 'provider-1/model:max'
    mockCurrentEffort = 'high'
    mockWarmCache = true
    mockRequestEffortSwitch.mockResolvedValue('apply')
    mockFetchWorkflow.mockResolvedValue(fullWorkflow)
  })

  it('launches directly when the workflow has no agent override effort (short-circuits the fetch)', async () => {
    mockOverrides.planner = 'provider-1/model'
    const { result } = renderHook(() => useScrolledSend(vi.fn(), 's1'), { wrapper })
    await result.current.launchWorkflow(undefined, undefined, 'w1')
    expect(mockRequestEffortSwitch).not.toHaveBeenCalled()
    expect(mockFetchWorkflow).not.toHaveBeenCalled()
    expect(mockLaunch).toHaveBeenCalledWith('s1', undefined, undefined, 'w1', undefined, undefined, 'auto')
  })

  it('launches directly on a cold cache even with an effort override (no fetch needed)', async () => {
    mockWarmCache = false
    const { result } = renderHook(() => useScrolledSend(vi.fn(), 's1'), { wrapper })
    await result.current.launchWorkflow(undefined, undefined, 'w1')
    expect(mockRequestEffortSwitch).not.toHaveBeenCalled()
    expect(mockFetchWorkflow).not.toHaveBeenCalled()
    expect(mockLaunch).toHaveBeenCalled()
  })

  it('gates and clears the pin on Apply before launching', async () => {
    const { result } = renderHook(() => useScrolledSend(vi.fn(), 's1'), { wrapper })
    await result.current.launchWorkflow(undefined, undefined, 'w1')
    expect(mockFetchWorkflow).toHaveBeenCalled()
    expect(mockRequestEffortSwitch).toHaveBeenCalledWith({
      fromEffort: 'high',
      toEffort: 'max',
      contextLabel: 'Deep Dive',
    })
    expect(mockClearPin).toHaveBeenCalledWith('s1')
    expect(mockPinEffort).not.toHaveBeenCalled()
    expect(mockLaunch).toHaveBeenCalled()
  })

  it('gates and pins the current effort on Keep before launching', async () => {
    mockRequestEffortSwitch.mockResolvedValue('keep')
    const { result } = renderHook(() => useScrolledSend(vi.fn(), 's1'), { wrapper })
    await result.current.launchWorkflow(undefined, undefined, 'w1')
    expect(mockPinEffort).toHaveBeenCalledWith('s1', 'high')
    expect(mockClearPin).not.toHaveBeenCalled()
    expect(mockLaunch).toHaveBeenCalled()
  })

  it('does not resolve a workflow when launch has no workflowId', async () => {
    const { result } = renderHook(() => useScrolledSend(vi.fn(), 's1'), { wrapper })
    await result.current.launchWorkflow(undefined, undefined, undefined)
    expect(mockFetchWorkflow).not.toHaveBeenCalled()
    expect(mockLaunch).toHaveBeenCalledWith('s1', undefined, undefined, undefined, undefined, undefined, 'auto')
  })
})
