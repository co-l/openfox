import { describe, expect, it } from 'vitest'
import { resolveEffortForModel, splitModeSuffix, groupModeFamilies } from './reasoning-effort.js'

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
  it('strips a trailing low/medium/high/xhigh/max suffix from a model id', () => {
    expect(splitModeSuffix('gemini-3.6-flash-high')).toEqual({ base: 'gemini-3.6-flash', level: 'high' })
    expect(splitModeSuffix('claude-sonnet-4-6-low')).toEqual({ base: 'claude-sonnet-4-6', level: 'low' })
  })

  it('handles prefixed ids and keeps the path segment base', () => {
    expect(splitModeSuffix('antigravity/gemini-3.6-flash-medium')).toEqual({
      base: 'antigravity/gemini-3.6-flash',
      level: 'medium',
    })
  })

  it('returns undefined when there is no trailing mode suffix', () => {
    expect(splitModeSuffix('gemini-3.6-flash')).toBeUndefined()
    expect(splitModeSuffix('claude-sonnet-4-6')).toBeUndefined()
  })
})

describe('groupModeFamilies', () => {
  it('groups models that differ only by a trailing mode suffix', () => {
    const groups = groupModeFamilies([
      { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High)' },
      { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' },
      { id: 'gemini-3.6-flash-medium', name: 'Gemini 3.6 Flash (Medium)' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.baseId).toBe('gemini-3.6-flash')
    expect(groups[0]?.members).toHaveLength(3)
  })

  it('uses the stripped base id as the stable name when no un-suffixed model exists', () => {
    const groups = groupModeFamilies([{ id: 'claude-sonnet-4-6-low' }, { id: 'claude-sonnet-4-6-high' }])
    expect(groups[0]?.name).toBe('claude-sonnet-4-6')
  })

  it('returns empty for a single mode (not a real duplicate family)', () => {
    expect(groupModeFamilies([{ id: 'gemini-3.6-flash-high' }])).toHaveLength(0)
  })

  it('keeps separate families distinct', () => {
    const groups = groupModeFamilies([
      { id: 'gemini-3.6-flash-low' },
      { id: 'gemini-3.6-flash-high' },
      { id: 'claude-opus-4-6-low' },
      { id: 'claude-opus-4-6-high' },
    ])
    expect(groups).toHaveLength(2)
  })
})
