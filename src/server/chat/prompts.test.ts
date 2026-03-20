import { describe, it, expect } from 'vitest'
import { buildPlannerPrompt, buildBuilderPrompt, buildVerifierPrompt } from './prompts.js'

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

  it('does not include tool list (tools are passed via structured API)', () => {
    const tools = [
      { type: 'function' as const, function: { name: 'read_file', description: 'Read a file', parameters: {} } },
      { type: 'function' as const, function: { name: 'glob', description: 'Find files', parameters: {} } },
    ]
    const prompt = buildPlannerPrompt('/tmp', tools, undefined)
    expect(prompt).not.toContain('## AVAILABLE TOOLS')
    expect(prompt).not.toContain('read_file')
    expect(prompt).not.toContain('glob')
  })
})

describe('buildBuilderPrompt', () => {
  it('includes workdir in prompt', () => {
    const prompt = buildBuilderPrompt('/home/user/myapp', [], undefined)
    expect(prompt).toContain('/home/user/myapp')
    expect(prompt).toMatch(/working directory/i)
  })

  it('includes platform info in prompt', () => {
    const prompt = buildBuilderPrompt('/tmp', [], undefined)
    expect(prompt).toContain(process.platform)
    expect(prompt).toContain(process.arch)
  })

  it('keeps the system prompt stable without runtime state', () => {
    const prompt = buildBuilderPrompt('/tmp', [], undefined)
    // System prompt should not contain criteria-specific content
    expect(prompt).not.toContain('[PENDING]')
    expect(prompt).not.toContain('[COMPLETED')
    expect(prompt).not.toContain('Files modified')
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
