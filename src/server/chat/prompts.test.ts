import { describe, it, expect } from 'vitest'
import { buildPlannerPrompt, buildBuilderPrompt, buildVerifierPrompt } from './prompts.js'
import type { Criterion } from '../../shared/types.js'

describe('buildPlannerPrompt', () => {
  it('includes workdir in prompt', () => {
    const prompt = buildPlannerPrompt('/home/user/project', [], undefined)
    expect(prompt).toContain('/home/user/project')
    expect(prompt).toMatch(/working directory/i)
  })

  it('includes platform info in prompt', () => {
    const prompt = buildPlannerPrompt('/tmp', [], undefined)
    expect(prompt).toContain(process.platform)
    expect(prompt).toContain(process.arch)
  })

  it('includes custom instructions when provided', () => {
    const prompt = buildPlannerPrompt('/tmp', [], 'Custom rule: always use tabs')
    expect(prompt).toContain('Custom rule: always use tabs')
    expect(prompt).toContain('CUSTOM INSTRUCTIONS')
  })

  it('includes tool list', () => {
    const tools = [
      { type: 'function' as const, function: { name: 'read_file', description: 'Read a file', parameters: {} } },
      { type: 'function' as const, function: { name: 'glob', description: 'Find files', parameters: {} } },
    ]
    const prompt = buildPlannerPrompt('/tmp', tools, undefined)
    expect(prompt).toContain('read_file')
    expect(prompt).toContain('glob')
  })
})

describe('buildBuilderPrompt', () => {
  const mockCriteria: Criterion[] = [
    { id: 'test-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] },
    { id: 'lint-pass', description: 'Lint passes', status: { type: 'completed', completedAt: '2024-01-01T00:00:00Z' }, attempts: [] },
  ]

  it('includes workdir in prompt', () => {
    const prompt = buildBuilderPrompt('/home/user/myapp', mockCriteria, [], [], undefined)
    expect(prompt).toContain('/home/user/myapp')
    expect(prompt).toMatch(/working directory/i)
  })

  it('includes platform info in prompt', () => {
    const prompt = buildBuilderPrompt('/tmp', mockCriteria, [], [], undefined)
    expect(prompt).toContain(process.platform)
    expect(prompt).toContain(process.arch)
  })

  it('includes criteria list with status', () => {
    const prompt = buildBuilderPrompt('/tmp', mockCriteria, [], [], undefined)
    expect(prompt).toContain('Tests pass')
    expect(prompt).toContain('[PENDING]')
    expect(prompt).toContain('[COMPLETED')
  })

  it('includes modified files', () => {
    const prompt = buildBuilderPrompt('/tmp', mockCriteria, [], ['src/index.ts', 'package.json'], undefined)
    expect(prompt).toContain('src/index.ts')
    expect(prompt).toContain('package.json')
  })
})

describe('buildVerifierPrompt', () => {
  it('includes workdir in prompt', () => {
    const prompt = buildVerifierPrompt('/var/project', [], undefined)
    expect(prompt).toContain('/var/project')
    expect(prompt).toMatch(/working directory/i)
  })

  it('includes platform info in prompt', () => {
    const prompt = buildVerifierPrompt('/tmp', [], undefined)
    expect(prompt).toContain(process.platform)
    expect(prompt).toContain(process.arch)
  })

  it('includes custom instructions when provided', () => {
    const prompt = buildVerifierPrompt('/tmp', [], 'Be extra strict')
    expect(prompt).toContain('Be extra strict')
    expect(prompt).toContain('CUSTOM INSTRUCTIONS')
  })
})
