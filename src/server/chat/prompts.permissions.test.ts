import { describe, it, expect } from 'vitest'
import { buildTopLevelSystemPrompt } from './prompts.js'
import type { SkillMetadata } from '../skills/types.js'
import type { AgentDefinition } from '../agents/types.js'

describe('buildTopLevelSystemPrompt — cache-safety contract', () => {
  const skills: SkillMetadata[] = []
  const subAgentDefs: AgentDefinition[] = []

  it('does not include a PERMISSIONS section in the prompt', () => {
    const prompt = buildTopLevelSystemPrompt('/tmp', undefined, skills, subAgentDefs)
    expect(prompt).not.toContain('## PERMISSIONS')
    expect(prompt).not.toMatch(/PERMISSIONS/)
  })

  it('is byte-identical whether modelName is omitted or undefined', () => {
    const a = buildTopLevelSystemPrompt('/tmp', undefined, skills, subAgentDefs)
    const b = buildTopLevelSystemPrompt('/tmp', undefined, skills, subAgentDefs, undefined)
    expect(b).toBe(a)
  })

  it('preserves base prompt contract (working directory, system-reminder override)', () => {
    const prompt = buildTopLevelSystemPrompt('/old/workdir', undefined, skills, subAgentDefs)
    expect(prompt).toContain('Working directory: /old/workdir')
    expect(prompt).toMatch(/working directory[^.\n]*\b(may|can)\b[^.\n]*change/i)
    expect(prompt).toMatch(/<system-reminder>[^]*?trust[^]*?(workspace|that value|over this)/i)
    expect(prompt).toContain('authoritative')
    expect(prompt).toContain('operational constraints')
  })

  it('sub-agents section still present (no permissions section appended)', () => {
    const subAgent: AgentDefinition = {
      metadata: {
        id: 'verifier',
        name: 'Verifier',
        description: 'Verifies',
        subagent: true,
        allowedTools: ['read_file'],
      },
      prompt: 'Verify.',
    }
    const prompt = buildTopLevelSystemPrompt('/tmp', undefined, skills, [subAgent])
    expect(prompt).toContain('AVAILABLE SUB-AGENTS')
    expect(prompt).not.toContain('## PERMISSIONS')
  })
})
