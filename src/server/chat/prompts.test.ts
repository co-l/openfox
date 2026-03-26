import { describe, it, expect } from 'vitest'
import {
  buildBasePrompt,
  buildTopLevelSystemPrompt,
  buildSubAgentSystemPrompt,
  buildAgentReminder,
  buildSubAgentsSection,
} from './prompts.js'
import type { AgentDefinition } from '../agents/types.js'

const mockVerifier: AgentDefinition = {
  metadata: {
    id: 'verifier',
    name: 'Verifier',
    description: 'Verifies completed criteria',
    subagent: true,
    tools: ['read_file', 'pass_criterion'],
  },
  prompt: 'Verify each criterion carefully.',
}

const mockCodeReviewer: AgentDefinition = {
  metadata: {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code changes',
    subagent: true,
    tools: ['read_file', 'grep'],
  },
  prompt: 'Review the code.',
}

const mockPlanner: AgentDefinition = {
  metadata: {
    id: 'planner',
    name: 'Planner',
    description: 'Plans work',
    subagent: false,
    tools: ['read_file', 'glob'],
  },
  prompt: '# Plan Mode\nCRITICAL: Plan mode ACTIVE - read-only phase.',
}

const mockBuilder: AgentDefinition = {
  metadata: {
    id: 'builder',
    name: 'Builder',
    description: 'Builds work',
    subagent: false,
    tools: ['read_file', 'write_file'],
  },
  prompt: '# Build Mode\nCRITICAL: Build mode ACTIVE - implementation allowed.',
}

describe('buildBasePrompt', () => {
  it('includes environment info', () => {
    const prompt = buildBasePrompt('/tmp/project')
    expect(prompt).toContain('/tmp/project')
    expect(prompt).toContain(process.platform)
  })

  it('includes custom instructions when provided', () => {
    const prompt = buildBasePrompt('/tmp', 'Use tabs')
    expect(prompt).toContain('CUSTOM INSTRUCTIONS')
    expect(prompt).toContain('Use tabs')
  })

  it('does not include sub-agents section', () => {
    const prompt = buildBasePrompt('/tmp')
    expect(prompt).not.toContain('AVAILABLE SUB-AGENTS')
  })

  it('includes skills section when provided', () => {
    const prompt = buildBasePrompt('/tmp', undefined, [
      { id: 'playwright', name: 'Playwright', description: 'Browser automation', version: '1.0' },
    ])
    expect(prompt).toContain('AVAILABLE SKILLS')
    expect(prompt).toContain('playwright')
  })
})

describe('buildTopLevelSystemPrompt', () => {
  it('includes base prompt + dynamic sub-agents section', () => {
    const prompt = buildTopLevelSystemPrompt('/tmp', undefined, undefined, [mockVerifier, mockCodeReviewer])
    expect(prompt).toContain('AVAILABLE SUB-AGENTS')
    expect(prompt).toContain('verifier')
    expect(prompt).toContain('code_reviewer')
    expect(prompt).toContain('read_file, pass_criterion')
  })

  it('is identical regardless of which top-level agent calls it', () => {
    const subAgents = [mockVerifier]
    const prompt1 = buildTopLevelSystemPrompt('/tmp', 'Instructions', undefined, subAgents)
    const prompt2 = buildTopLevelSystemPrompt('/tmp', 'Instructions', undefined, subAgents)
    expect(prompt1).toBe(prompt2)
  })

  it('omits sub-agents section when no sub-agents provided', () => {
    const prompt = buildTopLevelSystemPrompt('/tmp')
    expect(prompt).not.toContain('AVAILABLE SUB-AGENTS')
  })
})

describe('buildSubAgentSystemPrompt', () => {
  it('includes base prompt + agent body', () => {
    const prompt = buildSubAgentSystemPrompt('/tmp', mockVerifier)
    expect(prompt).toContain('/tmp')
    expect(prompt).toContain('Verify each criterion carefully.')
  })

  it('does not include sub-agents section', () => {
    const prompt = buildSubAgentSystemPrompt('/tmp', mockVerifier)
    expect(prompt).not.toContain('AVAILABLE SUB-AGENTS')
  })

  it('does not include custom instructions', () => {
    const prompt = buildSubAgentSystemPrompt('/tmp', mockVerifier)
    expect(prompt).not.toContain('CUSTOM INSTRUCTIONS')
  })
})

describe('buildAgentReminder', () => {
  it('wraps the agent prompt in system-reminder tags', () => {
    const reminder = buildAgentReminder(mockVerifier)
    expect(reminder).toContain('<system-reminder>')
    expect(reminder).toContain('Verify each criterion carefully.')
    expect(reminder).toContain('</system-reminder>')
  })

  it('generates planner reminder with Plan mode ACTIVE', () => {
    const reminder = buildAgentReminder(mockPlanner)
    expect(reminder).toContain('Plan mode ACTIVE')
  })

  it('generates builder reminder with Build mode ACTIVE', () => {
    const reminder = buildAgentReminder(mockBuilder)
    expect(reminder).toContain('Build mode ACTIVE')
  })
})

describe('buildSubAgentsSection', () => {
  it('generates listing from agent definitions', () => {
    const section = buildSubAgentsSection([mockVerifier, mockCodeReviewer])
    expect(section).toContain('**verifier**')
    expect(section).toContain('**code_reviewer**')
    expect(section).toContain('read_file, pass_criterion')
    expect(section).toContain('read_file, grep')
  })

  it('returns empty string for no agents', () => {
    expect(buildSubAgentsSection([])).toBe('')
  })
})
