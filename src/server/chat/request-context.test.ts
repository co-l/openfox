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
  it('keeps the builder system prompt stable and passes messages through unchanged', () => {
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
    expect(first.promptContext.userMessage).toBe('Implement the feature')
    expect(first.promptContext.messages).toEqual([{ role: 'user', content: 'Implement the feature', source: 'history' }])
    expect(second.promptContext.messages).toEqual([{ role: 'user', content: 'Implement the feature', source: 'history' }])
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
  })
})
