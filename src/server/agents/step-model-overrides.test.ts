/**
 * Step Model Overrides Tests
 *
 * Per-step model overrides keyed by `${workflowId}:${stepId}`. Stored in DB
 * settings as JSON under `step.modelOverrides`. Precedence when resolving the
 * LLM client for a step: step override > agent override > session fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ProviderManager } from '../provider-manager.js'

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
}))

vi.mock('../db/settings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../db/settings.js')>()
  return {
    ...original,
    getSetting: getSettingMock,
    setSetting: setSettingMock,
  }
})

import {
  parseStepModelOverrides,
  getStepModelOverride,
  setStepModelOverride,
  resolveLLMClientForStep,
  STEP_MODEL_OVERRIDES_KEY,
} from './model-overrides.js'

function fakeClient(model: string): LLMClientWithModel {
  return { getModel: () => model } as unknown as LLMClientWithModel
}

function fakeProviderManager(createResult?: LLMClientWithModel): ProviderManager {
  return {
    createClient: vi.fn(() => createResult),
  } as unknown as ProviderManager
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseStepModelOverrides', () => {
  it('returns empty map for null/undefined/invalid JSON', () => {
    expect(parseStepModelOverrides(null)).toEqual({})
    expect(parseStepModelOverrides(undefined)).toEqual({})
    expect(parseStepModelOverrides('not json')).toEqual({})
    expect(parseStepModelOverrides('[]')).toEqual({})
    expect(parseStepModelOverrides('"str"')).toEqual({})
  })

  it('parses valid overrides keyed by workflowId:stepId and drops malformed entries', () => {
    const raw = JSON.stringify({
      'wf:build': { providerId: 'p1', model: 'm1' },
      bad1: { providerId: 'p1' },
      bad2: { model: 'm1' },
      bad3: 'nope',
      'wf:verify': { providerId: 'p2', model: 'm2' },
    })
    expect(parseStepModelOverrides(raw)).toEqual({
      'wf:build': { providerId: 'p1', model: 'm1' },
      'wf:verify': { providerId: 'p2', model: 'm2' },
    })
  })

  it('preserves an optional reasoningEffort', () => {
    const raw = JSON.stringify({
      'wf:build': { providerId: 'p1', model: 'm1', reasoningEffort: 'high' },
      'wf:verify': { providerId: 'p2', model: 'm2', reasoningEffort: '' },
    })
    expect(parseStepModelOverrides(raw)).toEqual({
      'wf:build': { providerId: 'p1', model: 'm1', reasoningEffort: 'high' },
    })
  })
})

describe('getStepModelOverride', () => {
  it('returns undefined when no setting stored', () => {
    getSettingMock.mockReturnValue(null)
    expect(getStepModelOverride('wf', 'build')).toBeUndefined()
    expect(getSettingMock).toHaveBeenCalledWith(STEP_MODEL_OVERRIDES_KEY)
  })

  it('returns the override for a known workflowId:stepId', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ 'wf:build': { providerId: 'p1', model: 'm1' } }))
    expect(getStepModelOverride('wf', 'build')).toEqual({ providerId: 'p1', model: 'm1' })
    expect(getStepModelOverride('wf', 'verify')).toBeUndefined()
    expect(getStepModelOverride('other', 'build')).toBeUndefined()
  })
})

describe('setStepModelOverride', () => {
  it('writes a new override under the workflowId:stepId key', () => {
    getSettingMock.mockReturnValue(null)
    setStepModelOverride('wf', 'build', { providerId: 'p1', model: 'm1' })
    expect(setSettingMock).toHaveBeenCalledWith(
      STEP_MODEL_OVERRIDES_KEY,
      JSON.stringify({ 'wf:build': { providerId: 'p1', model: 'm1' } }),
    )
  })

  it('merges with existing overrides without clobbering others', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ 'wf:verify': { providerId: 'p2', model: 'm2' } }))
    setStepModelOverride('wf', 'build', { providerId: 'p1', model: 'm1' })
    expect(setSettingMock).toHaveBeenCalledWith(
      STEP_MODEL_OVERRIDES_KEY,
      JSON.stringify({
        'wf:verify': { providerId: 'p2', model: 'm2' },
        'wf:build': { providerId: 'p1', model: 'm1' },
      }),
    )
  })

  it('removes the override when passed null', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({
        'wf:verify': { providerId: 'p2', model: 'm2' },
        'wf:build': { providerId: 'p1', model: 'm1' },
      }),
    )
    setStepModelOverride('wf', 'build', null)
    expect(setSettingMock).toHaveBeenCalledWith(
      STEP_MODEL_OVERRIDES_KEY,
      JSON.stringify({ 'wf:verify': { providerId: 'p2', model: 'm2' } }),
    )
  })
})

describe('resolveLLMClientForStep', () => {
  const fallback = fakeClient('global-model')

  it('returns fallback when no step override and no agent override exist', () => {
    getSettingMock.mockReturnValue(null)
    const pm = fakeProviderManager(fakeClient('other'))
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toBeUndefined()
  })

  it('step override wins over agent override', () => {
    // agent overrides + step overrides both populated; step must win.
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      if (key === 'step.modelOverrides')
        return JSON.stringify({ 'wf:build': { providerId: 'ps', model: 'step-model' } })
      return null
    })
    const dedicated = fakeClient('step-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'ps', model: 'step-model' })
    expect(pm.createClient).toHaveBeenCalledWith('ps', 'step-model', undefined)
  })

  it('falls back to agent override when no step override exists', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      return null
    })
    const dedicated = fakeClient('agent-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'pa', model: 'agent-model' })
    expect(pm.createClient).toHaveBeenCalledWith('pa', 'agent-model', undefined)
  })

  it('passes pinned effort to the step override createClient', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'step.modelOverrides')
        return JSON.stringify({ 'wf:build': { providerId: 'ps', model: 'm1', reasoningEffort: 'low' } })
      return null
    })
    const dedicated = fakeClient('m1')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm, 'max')
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'ps', model: 'm1', reasoningEffort: 'max' })
    expect(pm.createClient).toHaveBeenCalledWith('ps', 'm1', 'max')
  })

  it('falls back with warning when step override provider no longer exists', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'step.modelOverrides') return JSON.stringify({ 'wf:build': { providerId: 'gone', model: 'm1' } })
      return null
    })
    const pm = fakeProviderManager(undefined)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toContain('gone')
    expect(result.warning).toContain('m1')
  })

  it('step override missing provider does NOT fall through to agent override', () => {
    // A configured-but-broken step override is a hard error for that step:
    // it must not silently pick up the agent override. Surface the warning + fallback.
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      if (key === 'step.modelOverrides') return JSON.stringify({ 'wf:build': { providerId: 'gone', model: 'm1' } })
      return null
    })
    const pm = fakeProviderManager(undefined)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toContain('gone')
  })
})

describe('resolveLLMClientForStep — team assignment', () => {
  const fallback = fakeClient('global-model')

  function teamStore(teamId: string, assignments: Record<string, unknown>): string {
    return JSON.stringify({ [teamId]: { id: teamId, name: teamId, assignments } })
  }

  it('uses the team assignment when the workflow is bound to a team', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'teams') return teamStore('team-a', { build: { providerId: 'pt', model: 'team-model' } })
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-a' })
      return null
    })
    const dedicated = fakeClient('team-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'pt', model: 'team-model' })
    expect(pm.createClient).toHaveBeenCalledWith('pt', 'team-model', undefined)
  })

  it('explicit step override wins over team assignment', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'step.modelOverrides')
        return JSON.stringify({ 'wf:build': { providerId: 'ps', model: 'step-model' } })
      if (key === 'teams') return teamStore('team-a', { build: { providerId: 'pt', model: 'team-model' } })
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-a' })
      return null
    })
    const dedicated = fakeClient('step-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.override).toEqual({ providerId: 'ps', model: 'step-model' })
  })

  it('team assignment wins over agent override', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      if (key === 'teams') return teamStore('team-a', { build: { providerId: 'pt', model: 'team-model' } })
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-a' })
      return null
    })
    const dedicated = fakeClient('team-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.override).toEqual({ providerId: 'pt', model: 'team-model' })
  })

  it('falls back to agent override when the team has no assignment for the step', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      if (key === 'teams') return teamStore('team-a', { verify: { providerId: 'pt', model: 'team-model' } })
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-a' })
      return null
    })
    const dedicated = fakeClient('agent-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.override).toEqual({ providerId: 'pa', model: 'agent-model' })
  })

  it('falls back to agent override when the bound team no longer exists', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      if (key === 'teams') return JSON.stringify({})
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-gone' })
      return null
    })
    const dedicated = fakeClient('agent-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.override).toEqual({ providerId: 'pa', model: 'agent-model' })
  })

  it('team assignment with a missing provider falls back with warning (no fallthrough to agent)', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'agent.modelOverrides') return JSON.stringify({ builder: { providerId: 'pa', model: 'agent-model' } })
      if (key === 'teams') return teamStore('team-a', { build: { providerId: 'gone', model: 'm1' } })
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-a' })
      return null
    })
    const pm = fakeProviderManager(undefined)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm)
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toContain('gone')
  })

  it('pinned effort is applied to the team assignment', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'teams')
        return teamStore('team-a', { build: { providerId: 'pt', model: 'm1', reasoningEffort: 'low' } })
      if (key === 'workflow.team') return JSON.stringify({ wf: 'team-a' })
      return null
    })
    const dedicated = fakeClient('m1')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForStep('wf', 'build', 'builder', fallback, pm, 'max')
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'pt', model: 'm1', reasoningEffort: 'max' })
    expect(pm.createClient).toHaveBeenCalledWith('pt', 'm1', 'max')
  })
})
