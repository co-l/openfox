import { describe, expect, it } from 'vitest'
import { resolveEffortForModel, splitModeSuffix, collapseModeFamilies } from './reasoning-effort.js'

describe('resolveEffortForModel', () => {
  it('passes an in-list candidate through unchanged', () => {
    expect(
      resolveEffortForModel({
        reasoningEfforts: ['low', 'medium', 'high'],
        candidate: 'high',
        defaultEffort: 'medium',
      }),
    ).toBe('high')
  })

  it('clamps an out-of-list candidate to the override (escape hatch) when set', () => {
    expect(
      resolveEffortForModel({
        reasoningEfforts: ['low', 'high'],
        candidate: 'max',
        defaultEffort: 'low',
        override: 'deep',
      }),
    ).toBe('deep')
  })

  it('clamps an out-of-list candidate to the advertised default, else the first list value', () => {
    expect(
      resolveEffortForModel({ reasoningEfforts: ['low', 'medium', 'high'], candidate: 'max', defaultEffort: 'high' }),
    ).toBe('high')
    expect(resolveEffortForModel({ reasoningEfforts: ['low', 'medium', 'high'], candidate: 'max' })).toBe('low')
  })

  it('sends the override verbatim when no explicit candidate is set (never clamped)', () => {
    expect(
      resolveEffortForModel({ reasoningEfforts: ['low', 'medium', 'high'], override: 'deep', defaultEffort: 'medium' }),
    ).toBe('deep')
  })

  it('uses the advertised default when no explicit candidate or override is set', () => {
    expect(resolveEffortForModel({ reasoningEfforts: ['low', 'medium', 'high'], defaultEffort: 'high' })).toBe('high')
  })

  it('sends nothing when the only default is not advertised', () => {
    expect(resolveEffortForModel({ reasoningEfforts: ['low', 'high'], defaultEffort: 'turbo' })).toBeUndefined()
  })

  it('never treats an explicit none as an out-of-list candidate (universal off switch)', () => {
    expect(resolveEffortForModel({ reasoningEfforts: ['low', 'high'], candidate: 'none', defaultEffort: 'low' })).toBe(
      'none',
    )
  })

  it('without a list the candidate (or default/override) is used as-is', () => {
    expect(resolveEffortForModel({ candidate: 'max' })).toBe('max')
    expect(resolveEffortForModel({ candidate: 'none' })).toBe('none')
    expect(resolveEffortForModel({ override: 'deep' })).toBe('deep')
    expect(resolveEffortForModel({ defaultEffort: 'medium' })).toBe('medium')
    expect(resolveEffortForModel({})).toBeUndefined()
  })
})

describe('splitModeSuffix', () => {
  it('strips a trailing mode suffix generically from a model id', () => {
    expect(splitModeSuffix('gemini-3.6-flash-high')).toEqual({ base: 'gemini-3.6-flash', level: 'high' })
    expect(splitModeSuffix('claude-sonnet-4-6-low')).toEqual({ base: 'claude-sonnet-4-6', level: 'low' })
  })

  it('rejects models whose suffix is not a recognized mode suffix', () => {
    expect(splitModeSuffix('custom-model-light')).toBeUndefined()
    expect(splitModeSuffix('claude-3-5-sonnet')).toBeUndefined()
    expect(splitModeSuffix('qwen-2.5-coder-7b')).toBeUndefined()
  })

  it('handles prefixed ids and keeps the path segment base', () => {
    expect(splitModeSuffix('custom/gemini-3.6-flash-medium')).toEqual({
      base: 'custom/gemini-3.6-flash',
      level: 'medium',
    })
  })

  it('returns undefined when there is no trailing mode suffix or hyphen is at start/end', () => {
    expect(splitModeSuffix('gemini')).toBeUndefined()
    expect(splitModeSuffix('custom/gemini')).toBeUndefined()
    expect(splitModeSuffix('provider/-model')).toBeUndefined()
    expect(splitModeSuffix('provider/model-')).toBeUndefined()
  })
})

describe('collapseModeFamilies', () => {
  it('collapses suffixed variants into a single merged model with modes and an id-derived name', () => {
    const raw = [
      { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High)', contextWindow: 1048576, supportsVision: true },
      { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)', contextWindow: 1048576, supportsVision: true },
      {
        id: 'gemini-3.6-flash-medium',
        name: 'Gemini 3.6 Flash (Medium)',
        contextWindow: 1048576,
        supportsVision: true,
      },
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
    ]
    const collapsed = collapseModeFamilies(raw)
    expect(collapsed).toHaveLength(2)
    const flash = collapsed.find((m) => m.id === 'gemini-3.6-flash') as any
    expect(flash).toBeDefined()
    // No un-suffixed base model carries a clean display name, and the core must
    // not guess one from the members' mode-suffixed names.
    expect(flash?.name).toBe('gemini 3.6 flash')
    expect(flash?.reasoningEfforts).toEqual(['low', 'medium', 'high'])
    expect(flash?.modes).toHaveLength(3)
    expect(flash?.modes?.[0]?.level).toBe('low')
    expect(flash?.modes?.[0]?.apiModelId).toBe('gemini-3.6-flash-low')
    expect(flash?.supportsVision).toBe(true)
  })

  it('prefers the un-suffixed base model display name for the merged entry', () => {
    const raw = [
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', contextWindow: 1048576 },
      { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High)', contextWindow: 1048576 },
      { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)', contextWindow: 1048576 },
    ]
    const collapsed = collapseModeFamilies(raw)
    const flash = collapsed.find((m) => m.id === 'gemini-3.6-flash') as any
    expect(flash?.name).toBe('Gemini 3.6 Flash')
    expect(flash?.modes).toHaveLength(2)
  })

  it('preserves existing merged models and does not re-collapse them', () => {
    const raw = [
      {
        id: 'gemini-3.6-flash',
        name: 'Gemini 3.6 Flash',
        modes: [{ level: 'low', apiModelId: 'gemini-3.6-flash-low' }],
      },
    ]
    const collapsed = collapseModeFamilies(raw)
    expect(collapsed).toEqual(raw)
  })
})
