/**
 * Agent Model Overrides Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ProviderManager } from '../provider-manager.js'

const { getSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
}))

vi.mock('../db/settings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../db/settings.js')>()
  return {
    ...original,
    getSetting: getSettingMock,
  }
})

import {
  parseAgentModelOverrides,
  parseStepModelOverride,
  getAgentModelOverride,
  resolveLLMClientForAgent,
  resolveLLMClientForOverride,
  AGENT_MODEL_OVERRIDES_KEY,
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

describe('parseAgentModelOverrides', () => {
  it('returns empty map for null/undefined/invalid JSON', () => {
    expect(parseAgentModelOverrides(null)).toEqual({})
    expect(parseAgentModelOverrides(undefined)).toEqual({})
    expect(parseAgentModelOverrides('not json')).toEqual({})
    expect(parseAgentModelOverrides('[]')).toEqual({})
    expect(parseAgentModelOverrides('"str"')).toEqual({})
  })

  it('parses valid overrides and drops malformed entries', () => {
    const raw = JSON.stringify({
      explorer: { providerId: 'p1', model: 'm1' },
      bad1: { providerId: 'p1' },
      bad2: { model: 'm1' },
      bad3: 'nope',
      verifier: { providerId: 'p2', model: 'm2' },
    })
    expect(parseAgentModelOverrides(raw)).toEqual({
      explorer: { providerId: 'p1', model: 'm1' },
      verifier: { providerId: 'p2', model: 'm2' },
    })
  })

  it('preserves an optional reasoningEffort on overrides', () => {
    const raw = JSON.stringify({
      explorer: { providerId: 'p1', model: 'm1', reasoningEffort: 'high' },
      verifier: { providerId: 'p2', model: 'm2', reasoningEffort: '' },
    })
    expect(parseAgentModelOverrides(raw)).toEqual({
      explorer: { providerId: 'p1', model: 'm1', reasoningEffort: 'high' },
    })
  })
})

describe('getAgentModelOverride', () => {
  it('returns undefined when no setting stored', () => {
    getSettingMock.mockReturnValue(null)
    expect(getAgentModelOverride('explorer')).toBeUndefined()
    expect(getSettingMock).toHaveBeenCalledWith(AGENT_MODEL_OVERRIDES_KEY)
  })

  it('returns the override for a known agent', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ explorer: { providerId: 'p1', model: 'm1' } }))
    expect(getAgentModelOverride('explorer')).toEqual({ providerId: 'p1', model: 'm1' })
    expect(getAgentModelOverride('verifier')).toBeUndefined()
  })
})

describe('resolveLLMClientForAgent', () => {
  const fallback = fakeClient('global-model')

  it('returns fallback client when no override exists', () => {
    getSettingMock.mockReturnValue(null)
    const pm = fakeProviderManager(fakeClient('other'))
    const result = resolveLLMClientForAgent('explorer', fallback, pm)
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toBeUndefined()
    expect(pm.createClient).not.toHaveBeenCalled()
  })

  it('returns dedicated client when override resolves', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ explorer: { providerId: 'p1', model: 'm1' } }))
    const dedicated = fakeClient('m1')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForAgent('explorer', fallback, pm)
    expect(result.client).toBe(dedicated)
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'p1', model: 'm1' })
    expect(result.warning).toBeUndefined()
    expect(pm.createClient).toHaveBeenCalledWith('p1', 'm1', undefined)
  })

  it('passes the override reasoningEffort to createClient', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({ explorer: { providerId: 'p1', model: 'm1', reasoningEffort: 'xhigh' } }),
    )
    const dedicated = fakeClient('m1')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForAgent('explorer', fallback, pm)
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'p1', model: 'm1', reasoningEffort: 'xhigh' })
    expect(pm.createClient).toHaveBeenCalledWith('p1', 'm1', 'xhigh')
  })

  it('a session-pinned effort wins over the override reasoningEffort', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({ explorer: { providerId: 'p1', model: 'm1', reasoningEffort: 'low' } }),
    )
    const dedicated = fakeClient('m1')
    const pm = fakeProviderManager(dedicated)
    // "Keep current reasoning effort" pinned ':max' — the most recent explicit
    // intent wins over the agent override's ':low'.
    const result = resolveLLMClientForAgent('explorer', fallback, pm, 'max')
    expect(result.usedOverride).toBe(true)
    expect(result.override).toEqual({ providerId: 'p1', model: 'm1', reasoningEffort: 'max' })
    expect(pm.createClient).toHaveBeenCalledWith('p1', 'm1', 'max')
  })

  it('uses the override effort when no pin is set', () => {
    getSettingMock.mockReturnValue(
      JSON.stringify({ explorer: { providerId: 'p1', model: 'm1', reasoningEffort: 'low' } }),
    )
    const dedicated = fakeClient('m1')
    const pm = fakeProviderManager(dedicated)
    resolveLLMClientForAgent('explorer', fallback, pm, undefined)
    expect(pm.createClient).toHaveBeenCalledWith('p1', 'm1', 'low')
  })

  it('falls back with warning when provider no longer exists', () => {
    getSettingMock.mockReturnValue(JSON.stringify({ explorer: { providerId: 'gone', model: 'm1' } }))
    const pm = fakeProviderManager(undefined)
    const result = resolveLLMClientForAgent('explorer', fallback, pm)
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toContain('gone')
    expect(result.warning).toContain('m1')
    expect(result.warning).toContain('explorer')
  })
})

describe('parseStepModelOverride', () => {
  it('parses string formatted model overrides', () => {
    expect(parseStepModelOverride('openai/gpt-4o')).toEqual({ providerId: 'openai', model: 'gpt-4o' })
    expect(parseStepModelOverride('anthropic/claude-3-7-sonnet:high')).toEqual({
      providerId: 'anthropic',
      model: 'claude-3-7-sonnet',
      reasoningEffort: 'high',
    })
  })

  it('parses object formatted step overrides', () => {
    expect(parseStepModelOverride({ model: 'anthropic/claude-3-5-sonnet' })).toEqual({
      providerId: 'anthropic',
      model: 'claude-3-5-sonnet',
    })
    expect(
      parseStepModelOverride({ providerId: 'anthropic', model: 'claude-3-5-sonnet', reasoningEffort: 'low' }),
    ).toEqual({
      providerId: 'anthropic',
      model: 'claude-3-5-sonnet',
      reasoningEffort: 'low',
    })
  })

  it('returns undefined for empty/invalid inputs', () => {
    expect(parseStepModelOverride(undefined)).toBeUndefined()
    expect(parseStepModelOverride(null)).toBeUndefined()
    expect(parseStepModelOverride('')).toBeUndefined()
    expect(parseStepModelOverride({})).toBeUndefined()
  })
})

describe('resolveLLMClientForOverride', () => {
  const fallback = fakeClient('global-model')

  it('resolves dedicated client for override', () => {
    const dedicated = fakeClient('custom-model')
    const pm = fakeProviderManager(dedicated)
    const result = resolveLLMClientForOverride(
      { providerId: 'p1', model: 'custom-model', reasoningEffort: 'high' },
      fallback,
      pm,
    )
    expect(result.client).toBe(dedicated)
    expect(result.usedOverride).toBe(true)
    expect(pm.createClient).toHaveBeenCalledWith('p1', 'custom-model', 'high')
  })

  it('falls back with warning when provider model cannot be created', () => {
    const pm = fakeProviderManager(undefined)
    const result = resolveLLMClientForOverride(
      { providerId: 'missing', model: 'custom-model' },
      fallback,
      pm,
      undefined,
      'Workflow step',
    )
    expect(result.client).toBe(fallback)
    expect(result.usedOverride).toBe(false)
    expect(result.warning).toContain('Workflow step')
    expect(result.warning).toContain('missing')
  })
})
