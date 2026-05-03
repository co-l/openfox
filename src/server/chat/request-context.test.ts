import { describe, expect, it } from 'vitest'
import type { InjectedFile } from '../../shared/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { AgentDefinition } from '../agents/types.js'
import { assembleAgentRequest, type RequestContextMessage } from './request-context.js'

const tools: LLMToolDefinition[] = [
  { type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: {} } },
  { type: 'function', function: { name: 'edit_file', description: 'Edit a file', parameters: {} } },
]

const injectedFiles: InjectedFile[] = [{ path: 'AGENTS.md', content: 'Always test first', source: 'agents-md' }]

const plannerAgent: AgentDefinition = {
  metadata: {
    id: 'planner',
    name: 'Planner',
    description: 'Plans work',
    subagent: false,
    allowedTools: ['read_file', 'glob'],
  },
  prompt: '# Plan Mode\nCRITICAL: Plan mode ACTIVE - read-only phase.',
}

const builderAgent: AgentDefinition = {
  metadata: {
    id: 'builder',
    name: 'Builder',
    description: 'Builds work',
    subagent: false,
    allowedTools: ['read_file', 'write_file'],
  },
  prompt: '# Build Mode\nCRITICAL: Build mode ACTIVE - implementation allowed.',
}

const verifierAgent: AgentDefinition = {
  metadata: {
    id: 'verifier',
    name: 'Verifier',
    description: 'Verifies criteria',
    subagent: true,
    allowedTools: ['read_file', 'pass_criterion'],
  },
  prompt: 'Verify each criterion.',
}

describe('assembleAgentRequest', () => {
  it('top-level agents share the same system prompt (KV cache friendly)', () => {
    const history: RequestContextMessage[] = [{ role: 'user', content: 'Do work', source: 'history' }]
    const subAgents = [verifierAgent]

    const plannerResult = assembleAgentRequest({
      agentDef: plannerAgent,
      subAgentDefs: subAgents,
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Be careful',
    })
    const builderResult = assembleAgentRequest({
      agentDef: builderAgent,
      subAgentDefs: subAgents,
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Be careful',
    })

    expect(plannerResult.systemPrompt).toBe(builderResult.systemPrompt)
  })

  it('top-level agent does NOT inject runtime reminder (handled by orchestrator)', () => {
    const result = assembleAgentRequest({
      agentDef: plannerAgent,
      workdir: '/tmp/project',
      messages: [{ role: 'user', content: 'Plan it', source: 'history' }],
      promptTools: tools,
      injectedFiles,
    })

    expect(result.messages[0]?.content).toBe('Plan it')
    expect(result.messages[0]?.content).not.toContain('system-reminder')
  })

  it('top-level system prompt includes sub-agents section', () => {
    const result = assembleAgentRequest({
      agentDef: plannerAgent,
      subAgentDefs: [verifierAgent],
      workdir: '/tmp/project',
      messages: [{ role: 'user', content: 'Plan it', source: 'history' }],
      promptTools: tools,
      injectedFiles,
    })

    expect(result.systemPrompt).toContain('AVAILABLE SUB-AGENTS')
    expect(result.systemPrompt).toContain('verifier')
  })

  it('sub-agent bakes instructions into system prompt, no runtime reminder', () => {
    const result = assembleAgentRequest({
      agentDef: verifierAgent,
      workdir: '/tmp/project',
      messages: [{ role: 'user', content: 'Verify criteria', source: 'history' }],
      promptTools: tools,
      injectedFiles,
    })

    expect(result.systemPrompt).toContain('Verify each criterion.')
    expect(result.systemPrompt).not.toContain('AVAILABLE SUB-AGENTS')
    expect(result.messages[0]?.content).toBe('Verify criteria')
    expect(result.messages[0]?.content).not.toContain('system-reminder')
  })

  it('does not inject runtime reminder (parameter removed as it is handled by orchestrator)', () => {
    const result = assembleAgentRequest({
      agentDef: plannerAgent,
      workdir: '/tmp/project',
      messages: [{ role: 'user', content: 'Summarize', source: 'history' }],
      promptTools: tools,
      injectedFiles,
    })

    expect(result.messages[0]?.content).toBe('Summarize')
    expect(result.messages[0]?.content).not.toContain('system-reminder')
  })

  it('does NOT inject runtime reminders for planner or builder (handled by orchestrator)', () => {
    const messages: RequestContextMessage[] = [{ role: 'user', content: 'Add JSON output', source: 'history' }]

    const planner = assembleAgentRequest({
      agentDef: plannerAgent,
      workdir: '/tmp/project',
      messages,
      promptTools: tools,
      injectedFiles,
    })
    const builder = assembleAgentRequest({
      agentDef: builderAgent,
      workdir: '/tmp/project',
      messages,
      promptTools: tools,
      injectedFiles,
    })

    expect(planner.messages[0]?.content).toBe('Add JSON output')
    expect(builder.messages[0]?.content).toBe('Add JSON output')
    expect(planner.messages[0]?.content).not.toContain('system-reminder')
    expect(builder.messages[0]?.content).not.toContain('system-reminder')
  })

  it('keeps tool results as the final message without modifying user messages', () => {
    const assembled = assembleAgentRequest({
      agentDef: builderAgent,
      workdir: '/tmp/project',
      messages: [
        { role: 'user', content: 'List the files.', source: 'history' },
        {
          role: 'assistant',
          content: 'Listed.',
          source: 'history',
          toolCalls: [{ id: 'call-1', name: 'run_command', arguments: { command: 'ls' } }],
        },
        { role: 'tool', content: 'package.json\nsrc', source: 'history', toolCallId: 'call-1' },
      ],
      promptTools: tools,
      injectedFiles,
    })

    expect(assembled.messages[0]?.content).toBe('List the files.')
    expect(assembled.messages.at(-1)?.role).toBe('tool')
    expect(assembled.messages[0]?.content).not.toContain('system-reminder')
  })

  it('preserves attachments in the request context', () => {
    const assembled = assembleAgentRequest({
      agentDef: plannerAgent,
      workdir: '/tmp/project',
      messages: [
        {
          role: 'user',
          content: 'Describe the image',
          source: 'history',
          attachments: [{ id: 'att-1', filename: 'screenshot.png', mimeType: 'image/png', size: 12, data: 'ZmFrZQ==' }],
        },
      ],
      promptTools: tools,
      injectedFiles,
    })

    expect(assembled.promptContext.messages[0]).toMatchObject({
      attachments: [expect.objectContaining({ filename: 'screenshot.png' })],
    })
    expect(assembled.messages[0]).toMatchObject({
      attachments: [expect.objectContaining({ filename: 'screenshot.png' })],
    })
  })
})
