import { describe, expect, it } from 'vitest'
import { formatSkillPrompt } from './load-skill.js'
import type { SkillDefinition } from '../skills/types.js'

const metadata = { id: 'test', name: 'Test', description: 'Test', version: '' }

describe('formatSkillPrompt', () => {
  it('keeps legacy output byte-for-byte compatible', () => {
    const skill: SkillDefinition = { metadata, prompt: 'Legacy instructions.', legacy: true }
    expect(formatSkillPrompt(skill)).toBe('Legacy instructions.')
  })

  it('provides portable package directory for relative references', () => {
    const skill: SkillDefinition = {
      metadata,
      prompt: 'Run scripts/check.sh.',
      legacy: false,
      directory: '/shared skills/test',
    }
    expect(formatSkillPrompt(skill)).toBe(
      'Skill package directory: /shared skills/test\nResolve relative paths in these instructions from that directory.\n\nRun scripts/check.sh.',
    )
  })
})
