import { describe, expect, it } from 'vitest'
import type { InjectedFile } from '../../shared/types.js'
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
  it('keeps the builder system prompt stable while merging runtime reminders into the latest user message', () => {
    const history: RequestContextMessage[] = [{ role: 'user', content: 'Implement the feature', source: 'history' }]

    const first = assembleBuilderRequest({
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Follow project conventions',
    })
    const second = assembleBuilderRequest({
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Follow project conventions',
    })

    expect(first.systemPrompt).toBe(second.systemPrompt)
    expect(first.systemPrompt).toBe(assemblePlannerRequest({
      workdir: '/tmp/project',
      messages: history,
      promptTools: tools,
      injectedFiles,
      customInstructions: 'Follow project conventions',
    }).systemPrompt)
    expect(first.promptContext.userMessage).toBe('Implement the feature')
    expect(first.promptContext.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('Implement the feature'),
        source: 'history',
      },
    ])
    expect(second.promptContext.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('Implement the feature'),
        source: 'history',
      },
    ])
    expect(first.promptContext.messages[0]?.content).toContain('Build mode ACTIVE')
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
      {
        role: 'user',
        content: expect.stringContaining('Plan the work'),
        source: 'history',
      },
    ])
    expect(assembled.promptContext.messages[0]?.content).toContain('Plan mode ACTIVE')
    expect(assembled.promptContext.tools).toEqual([
      { name: 'read_file', description: 'Read a file', parameters: {} },
      { name: 'edit_file', description: 'Edit a file', parameters: {} },
    ])
    expect(assembled.promptContext.requestOptions).toEqual({
      toolChoice: 'auto',
      disableThinking: false,
    })
  })

  it('preserves attachments in the exact request context', () => {
    const assembled = assemblePlannerRequest({
      workdir: '/tmp/project',
      messages: [{
        role: 'user',
        content: 'Describe the image',
        source: 'history',
        attachments: [{
          id: 'att-1',
          filename: 'screenshot.png',
          mimeType: 'image/png',
          size: 12,
          data: 'ZmFrZQ==',
        }],
      }],
      promptTools: tools,
      injectedFiles,
      toolChoice: 'auto',
    })

    expect(assembled.promptContext.messages[0]).toMatchObject({
      attachments: [expect.objectContaining({ filename: 'screenshot.png' })],
    })
    expect(assembled.messages[0]).toMatchObject({
      attachments: [expect.objectContaining({ filename: 'screenshot.png' })],
    })
    expect(assembled.messages[0]?.content).toContain('Plan mode ACTIVE')
  })

  it('uses different runtime reminders for planner and builder while keeping the same history', () => {
    const messages: RequestContextMessage[] = [{ role: 'user', content: 'Add JSON output', source: 'history' }]

    const planner = assemblePlannerRequest({
      workdir: '/tmp/project',
      messages,
      promptTools: tools,
      injectedFiles,
    })

    const builder = assembleBuilderRequest({
      workdir: '/tmp/project',
      messages,
      promptTools: tools,
      injectedFiles,
    })

    expect(planner.messages).toHaveLength(1)
    expect(builder.messages).toHaveLength(1)
    expect(planner.messages[0]?.content).toContain('Add JSON output')
    expect(planner.messages[0]?.content).toContain('Plan mode ACTIVE')
    expect(builder.messages[0]?.content).toContain('Add JSON output')
    expect(builder.messages[0]?.content).toContain('Build mode ACTIVE')
  })

  it('keeps tool results as the final message while applying the reminder to the latest user turn', () => {
    const assembled = assembleBuilderRequest({
      workdir: '/tmp/project',
      messages: [
        { role: 'user', content: 'List the files in src and tell me what you find.', source: 'history' },
        {
          role: 'assistant',
          content: 'Listed directory contents.',
          source: 'history',
          toolCalls: [{ id: 'call-1', name: 'run_command', arguments: { command: 'ls' } }],
        },
        { role: 'tool', content: 'package.json\nsrc\ntsconfig.json', source: 'history', toolCallId: 'call-1' },
      ],
      promptTools: tools,
      injectedFiles,
    })

    expect(assembled.messages).toEqual([
      { role: 'user', content: expect.stringContaining('List the files in src and tell me what you find.') },
      {
        role: 'assistant',
        content: 'Listed directory contents.',
        toolCalls: [{ id: 'call-1', name: 'run_command', arguments: { command: 'ls' } }],
      },
      { role: 'tool', content: 'package.json\nsrc\ntsconfig.json', toolCallId: 'call-1' },
    ])
    expect(assembled.messages[0]?.content).toContain('Build mode ACTIVE')
    expect(assembled.messages.at(-1)?.role).toBe('tool')
  })

  it('can disable runtime reminders for non-mode planner requests', () => {
    const assembled = assemblePlannerRequest({
      workdir: '/tmp/project',
      messages: [{ role: 'user', content: 'Summarize the work', source: 'history' }],
      promptTools: tools,
      injectedFiles,
      includeRuntimeReminder: false,
      toolChoice: 'none',
    })

    expect(assembled.messages).toEqual([
      { role: 'user', content: 'Summarize the work' },
    ])
  })
})
