import { describe, it, expect } from 'vitest'
import { buildTopLevelSystemPrompt, buildPermissionsSection } from './prompts.js'
import type { PermissionRule } from '../permissions/schema.js'

const rule = (
  effect: PermissionRule['effect'],
  tool: string,
  pattern?: string,
  description?: string,
): PermissionRule => ({
  effect,
  tool,
  ...(pattern !== undefined ? { pattern } : {}),
  ...(description !== undefined ? { description } : {}),
})

describe('buildPermissionsSection', () => {
  it('returns empty string when no rules', () => {
    expect(buildPermissionsSection([])).toBe('')
  })

  it('returns empty string when undefined', () => {
    expect(buildPermissionsSection(undefined)).toBe('')
  })

  it('includes PERMISSIONS header when rules present', () => {
    const section = buildPermissionsSection([rule('DENY', 'run_command', 'rm -rf *')])
    expect(section).toContain('## PERMISSIONS')
  })

  it('lists each rule with effect, tool, and pattern', () => {
    const section = buildPermissionsSection([
      rule('DENY', 'run_command', 'rm -rf *'),
      rule('ALLOW', 'read_file', '/ubiquity/**'),
      rule('ASK', 'write_file', '**/.env*'),
    ])
    expect(section).toContain('DENY')
    expect(section).toContain('run_command')
    expect(section).toContain('rm -rf *')
    expect(section).toContain('ALLOW')
    expect(section).toContain('read_file')
    expect(section).toContain('/ubiquity/**')
    expect(section).toContain('ASK')
    expect(section).toContain('write_file')
  })

  it('handles rules without pattern (matches all calls to tool)', () => {
    const section = buildPermissionsSection([rule('DENY', 'run_command')])
    expect(section).toContain('DENY')
    expect(section).toContain('run_command')
  })

  it('includes description when present', () => {
    const section = buildPermissionsSection([rule('DENY', 'run_command', 'rm -rf *', 'Never delete recursively')])
    expect(section).toContain('Never delete recursively')
  })
})

describe('buildTopLevelSystemPrompt with permissions', () => {
  it('is byte-identical to no-permissions when rules empty (cache safety)', () => {
    const without = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined)
    const withEmpty = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined, undefined, [])
    expect(withEmpty).toBe(without)
  })

  it('is byte-identical to no-permissions when rules undefined (cache safety)', () => {
    const without = buildTopLevelSystemPrompt('/tmp', 'instr', undefined, undefined)
    const withUndefined = buildTopLevelSystemPrompt('/tmp', 'instr', undefined, undefined, undefined, undefined)
    expect(withUndefined).toBe(without)
  })

  it('appends PERMISSIONS section when rules present', () => {
    const without = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined)
    const withRules = buildTopLevelSystemPrompt('/tmp', undefined, undefined, undefined, undefined, [
      rule('DENY', 'run_command', 'rm -rf *'),
    ])
    expect(withRules).toContain('## PERMISSIONS')
    expect(withRules.length).toBeGreaterThan(without.length)
  })

  it('preserves base prompt contract (working directory, system-reminder override)', () => {
    const prompt = buildTopLevelSystemPrompt('/old/workdir', undefined, undefined, undefined, undefined, [
      rule('DENY', 'read_file', '/secret/**'),
    ])
    expect(prompt).toContain('Working directory: /old/workdir')
    expect(prompt).toMatch(/working directory[^.\n]*\b(may|can)\b[^.\n]*change/i)
    expect(prompt).toMatch(/<system-reminder>[^]*?trust[^]*?(workspace|that value|over this)/i)
    expect(prompt).toContain('authoritative')
    expect(prompt).toContain('operational constraints')
  })

  it('permissions section appears after sub-agents section', () => {
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
    const prompt = buildTopLevelSystemPrompt('/tmp', undefined, undefined, [subAgent], undefined, [
      rule('DENY', 'run_command', 'rm -rf *'),
    ])
    const subAgentsIdx = prompt.indexOf('AVAILABLE SUB-AGENTS')
    const permsIdx = prompt.indexOf('## PERMISSIONS')
    expect(subAgentsIdx).toBeGreaterThan(-1)
    expect(permsIdx).toBeGreaterThan(subAgentsIdx)
  })
})
