import { describe, expect, it } from 'vitest'
import type { Criterion, InjectedFile } from '../../shared/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import { assembleBuilderRequest, assemblePlannerRequest, type RequestContextMessage } from './request-context.js'

const tools: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file',
      parameters: {},
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file',
      parameters: {},
    },
  },
]

const injectedFiles: InjectedFile[] = [
  {
    path: 'AGENTS.md',
    content: 'Always test first',
    source: 'agents-md',
  },
]

describe('request context assembly', () => {
  it('keeps the builder system prompt stable while moving runtime state to trailing messages', () => {
    const history: RequestContextMessage[] = [{ role: 'user', content: 'Implement the feature', source: 'history' }]
    const criteriaA: Criterion[] = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }]
    const criteriaB: Criterion[] = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }]

    const first = assembleBuilderRequest({
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Follow project conventions',
      criteria: criteriaA,
      modifiedFiles: [],
    })
    const second = assembleBuilderRequest({
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Follow project conventions',
      criteria: criteriaB,
      modifiedFiles: ['src/index.ts'],
    })

    expect(first.systemPrompt).toBe(second.systemPrompt)
    expect(first.promptContext.messages.at(-1)).toMatchObject({ role: 'user', source: 'runtime' })
    expect(second.promptContext.messages.at(-1)).toMatchObject({ role: 'user', source: 'runtime' })
    expect(first.promptContext.messages.at(-1)?.content).toContain('[PENDING]')
    expect(second.promptContext.messages.at(-1)?.content).toContain('[COMPLETED - awaiting verification]')
    expect(second.promptContext.messages.at(-1)?.content).toContain('src/index.ts')
  })

  it('captures the exact assembled request in promptContext', () => {
    const assembled = assemblePlannerRequest({
      workdir: '/tmp/project',
      messages: [{ role: 'user', content: 'Plan the work', source: 'history' }],
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Be concise',
      toolChoice: 'auto',
    })

    expect(assembled.promptContext.userMessage).toBe('Plan the work')
    expect(assembled.promptContext.messages).toEqual([
      { role: 'user', content: 'Plan the work', source: 'history' },
    ])
    expect(assembled.promptContext.tools).toEqual([
      { name: 'read_file', description: 'Read a file', parameters: {} },
      { name: 'edit_file', description: 'Edit a file', parameters: {} },
    ])
    expect(assembled.promptContext.requestOptions).toEqual({
      toolChoice: 'auto',
      enableThinking: true,
    })
  })
})
