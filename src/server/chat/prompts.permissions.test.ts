import { describe, it, expect } from 'vitest'
import { buildTopLevelSystemPrompt } from './prompts.js'

describe('buildTopLevelSystemPrompt without permissions', () => {
  it('is byte-identical with or without rules (cache safety)', () => {
    const without = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined)
    const withEmpty = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined, undefined)
    const withUndefined = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined, undefined)
    const withRules = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined, undefined)
    expect(withEmpty).toBe(without)
    expect(withUndefined).toBe(without)
    expect(withRules).toBe(without)
  })

  it('does not include a PERMISSIONS section even when rules would have been provided', () => {
    const prompt = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined, undefined)
    expect(prompt).not.toContain('## PERMISSIONS')
    expect(prompt).not.toContain('PERMISSIONS')
  })

  it('preserves base prompt contract (working directory, system-reminder override)', () => {
    const prompt = buildTopLevelSystemPrompt('/old/workdir', undefined, undefined, undefined, undefined)
    expect(prompt).toContain('Working directory: /old/workdir')
    expect(prompt).toMatch(/working directory[^.\n]*\b(may|can)\b[^.\n]*change/i)
    expect(prompt).toMatch(/<system-reminder>[^]*?trust[^]*?(workspace|that value|over this)/i)
    expect(prompt).toContain('authoritative')
    expect(prompt).toContain('operational constraints')
  })

  it('sub-agents section still present (permissions section no longer appended)', () => {
    const subAgent = {
      metadata: {
        id: 'verifier',
        name: 'Verifier',
        description: 'Verifies',
        subagent: true,
        allowedTools: ['read_file'],
      },
      prompt: 'Verify.',
    }
    const prompt = buildTopLevelSystemPrompt('/tmp', undefined, undefined, [subAgent], undefined)
    expect(prompt).toContain('AVAILABLE SUB-AGENTS')
    expect(prompt).not.toContain('## PERMISSIONS')
  })
})
