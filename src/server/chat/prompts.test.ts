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
    allowedTools: ['read_file', 'pass_criterion'],
  },
  prompt: 'Verify each criterion carefully.',
}

const mockCodeReviewer: AgentDefinition = {
  metadata: {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code changes',
    subagent: true,
    allowedTools: ['read_file', 'grep'],
  },
  prompt: 'Review the code.',
}

const mockPlanner: AgentDefinition = {
  metadata: {
    id: 'planner',
    name: 'Planner',
    description: 'Plans work',
    subagent: false,
    allowedTools: ['read_file', 'glob'],
  },
  prompt: '# Plan Mode\nCRITICAL: Plan mode ACTIVE - read-only phase.',
}

const mockBuilder: AgentDefinition = {
  metadata: {
    id: 'builder',
    name: 'Builder',
    description: 'Builds work',
    subagent: false,
    allowedTools: ['read_file', 'write_file'],
  },
  prompt: '# Build Mode\nCRITICAL: Build mode ACTIVE - implementation allowed.',
}

describe('buildBasePrompt', () => {
  it('includes environment info', () => {
    const prompt = buildBasePrompt('/tmp/project')
    expect(prompt).toContain('/tmp/project')
    expect(prompt).toContain(process.platform)
  })

  it('tells the model the working directory may change and defers to the latest system reminder', () => {
    const prompt = buildBasePrompt('/tmp/project')
    expect(prompt).toContain('Working directory: /tmp/project')
    expect(prompt).toMatch(/working directory.*(may change|can change)/i)
    expect(prompt).toMatch(/<system-reminder>/) // the reminder is the authoritative override
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

  it('includes model name in environment when provided', () => {
    const prompt = buildBasePrompt('/tmp/project', undefined, undefined, 'MiniMax-M2.7')
    expect(prompt).toContain('Model: MiniMax-M2.7')
  })

  it('omits model line when modelName not provided', () => {
    const prompt = buildBasePrompt('/tmp/project')
    expect(prompt).not.toContain('Model:')
  })

  it('includes OpenFox repo URL', () => {
    const prompt = buildBasePrompt('/tmp/project')
    expect(prompt).toContain('https://github.com/co-l/openfox')
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

  it('shows only tools actually available to top-level agent (excludes return_value)', () => {
    const agentWithReturnValue: AgentDefinition = {
      metadata: {
        id: 'test_agent',
        name: 'Test Agent',
        description: 'Test',
        subagent: false,
        allowedTools: ['read_file', 'return_value', 'write_file'],
      },
      prompt: 'Test prompt',
    }
    const reminder = buildAgentReminder(agentWithReturnValue)
    expect(reminder).toContain('AVAILABLE TOOLS')
    expect(reminder).toContain('read_file, write_file')
    expect(reminder).not.toContain('return_value')
  })

  it('shows only tools actually available to sub-agent (includes return_value)', () => {
    const subAgentWithReturnValue: AgentDefinition = {
      metadata: {
        id: 'test_subagent',
        name: 'Test SubAgent',
        description: 'Test',
        subagent: true,
        allowedTools: ['read_file', 'write_file', 'return_value'],
      },
      prompt: 'Test prompt',
    }
    const reminder = buildAgentReminder(subAgentWithReturnValue)
    expect(reminder).toContain('AVAILABLE TOOLS')
    expect(reminder).toContain('read_file, write_file, return_value')
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

// ============================================================================
// Static-prompt contract that keeps the cached system prompt reusable across
// workspace/branch mutations: the prompt may carry a stale "Working directory"
// line, so it must (a) acknowledge the directory can change, (b) defer to a
// later <system-reminder>, and (c) qualify <system-reminder> as authoritative.
// ============================================================================

describe('buildBasePrompt: working-directory change acknowledgement and <system-reminder> override', () => {
  it('acknowledges the working directory may change during a session', () => {
    const prompt = buildBasePrompt('/old/workdir')
    // Phrase must clearly talk about the working directory AND its ability to change.
    expect(prompt).toMatch(/working directory[^.\n]*\b(may|can)\b[^.\n]*change/i)
  })

  it('instructs the model to trust a later <system-reminder> over the static Working directory line', () => {
    const prompt = buildBasePrompt('/old/workdir')
    // Must not just mention <system-reminder> — must tell the model to trust it.
    // Use a strict regex that captures the override semantics.
    expect(prompt).toMatch(/<system-reminder>[^]*?trust[^]*?(workspace|that value|over this)/i)
  })

  it('qualifies <system-reminder> as authoritative operational constraints', () => {
    const prompt = buildBasePrompt('/old/workdir')
    expect(prompt).toContain('authoritative')
    expect(prompt).toContain('operational constraints')
  })

  it('preserves the static "Working directory:" line so the cache key is stable', () => {
    const prompt = buildBasePrompt('/old/workdir')
    expect(prompt).toContain('Working directory: /old/workdir')
  })
})

describe('static-prompt contract is preserved across top-level and sub-agent builders', () => {
  it('buildTopLevelSystemPrompt preserves the full contract', () => {
    const prompt = buildTopLevelSystemPrompt('/old/workdir', undefined, undefined, [mockVerifier])
    expect(prompt).toContain('Working directory: /old/workdir')
    expect(prompt).toMatch(/working directory[^.\n]*\b(may|can)\b[^.\n]*change/i)
    expect(prompt).toMatch(/<system-reminder>[^]*?trust[^]*?(workspace|that value|over this)/i)
    expect(prompt).toContain('authoritative')
    expect(prompt).toContain('operational constraints')
  })

  it('buildSubAgentSystemPrompt preserves the full contract', () => {
    const prompt = buildSubAgentSystemPrompt('/old/workdir', mockVerifier)
    expect(prompt).toContain('Working directory: /old/workdir')
    expect(prompt).toMatch(/working directory[^.\n]*\b(may|can)\b[^.\n]*change/i)
    expect(prompt).toMatch(/<system-reminder>[^]*?trust[^]*?(workspace|that value|over this)/i)
    expect(prompt).toContain('authoritative')
    expect(prompt).toContain('operational constraints')
    // Sub-agent body is appended on top — the base contract must remain.
    expect(prompt).toContain('Verify each criterion carefully.')
  })

  it('buildAgentReminder wraps the agent body in <system-reminder>…</system-reminder>', () => {
    const reminder = buildAgentReminder(mockPlanner)
    expect(reminder.startsWith('<system-reminder>')).toBe(true)
    expect(reminder.endsWith('</system-reminder>')).toBe(true)
    expect(reminder).toContain('Plan mode ACTIVE')
  })
})
