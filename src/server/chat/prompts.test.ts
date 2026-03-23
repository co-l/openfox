import { describe, it, expect } from 'vitest'
import {
  buildBuilderPrompt,
  buildBuilderReminder,
  buildPlannerPrompt,
  buildPlannerReminder,
  buildVerifierPrompt,
} from './prompts.js'

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
    // Note: Sub-agents section may mention tool names, but that's different from tool list
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

  it('matches the planner system prompt to preserve cache reuse', () => {
    expect(buildBuilderPrompt('/tmp', [], 'Follow project rules')).toBe(
      buildPlannerPrompt('/tmp', [], 'Follow project rules'),
    )
  })

  it('treats runtime reminders as OpenFox-authored control messages', () => {
    const prompt = buildBuilderPrompt('/tmp', [], undefined)
    expect(prompt).toContain('OpenFox may append system-generated runtime control messages as USER-role messages')
    expect(prompt).toContain('Do not describe them as "the user reminded me"')
  })
})

describe('mode reminders', () => {
  it('builds a planner reminder that keeps execution disabled', () => {
    const reminder = buildPlannerReminder()
    expect(reminder).toContain('Plan mode ACTIVE')
    expect(reminder).toContain('MUST NOT make any edits')
  })

  it('builds a builder reminder that enables execution', () => {
    const reminder = buildBuilderReminder()
    expect(reminder).toContain('Build mode ACTIVE')
    expect(reminder).toContain('implementation is now allowed')
    expect(reminder).toContain('write or update the failing test first')
  })
})

describe('buildVerifierPrompt', () => {
  it('includes workdir in prompt', () => {
    const prompt = buildVerifierPrompt('/var/project')
    expect(prompt).toContain('/var/project')
    expect(prompt).toMatch(/working directory/i)
  })

  it('includes platform info in prompt', () => {
    const prompt = buildVerifierPrompt('/tmp')
    expect(prompt).toContain(process.platform)
    expect(prompt).toContain(process.arch)
  })

  it('does not include custom instructions section', () => {
    const prompt = buildVerifierPrompt('/tmp')
    expect(prompt).not.toContain('CUSTOM INSTRUCTIONS')
  })
})
