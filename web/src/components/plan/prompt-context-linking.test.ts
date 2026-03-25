import { describe, expect, it } from 'vitest'
import type { Message, PromptContext } from '@shared/types.js'
import { buildPromptContextByUserMessageId } from './prompt-context-linking.js'

const promptContext: PromptContext = {
  systemPrompt: 'system',
  injectedFiles: [],
  userMessage: 'Ship it',
  messages: [{ role: 'user', content: 'Ship it', source: 'history' }],
  tools: [],
  requestOptions: { toolChoice: 'auto', disableThinking: false },
}

function createMessage(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    timestamp: '2024-01-01T00:00:00.000Z',
    tokenCount: 0,
    ...partial,
  }
}

describe('buildPromptContextByUserMessageId', () => {
  it('links assistant prompt context back to the triggering user message', () => {
    const messages: Message[] = [
      createMessage({ id: 'user-1', role: 'user', content: 'Ship it' }),
      createMessage({ id: 'assistant-1', role: 'assistant', content: 'On it', promptContext }),
    ]

    expect(buildPromptContextByUserMessageId(messages)).toEqual({
      'user-1': promptContext,
    })
  })

  it('ignores system-generated user prompts when linking prompt context', () => {
    const messages: Message[] = [
      createMessage({ id: 'user-1', role: 'user', content: 'Ship it' }),
      createMessage({ id: 'assistant-1', role: 'assistant', content: 'Planning', promptContext }),
      createMessage({ id: 'auto-1', role: 'user', content: 'Continue', isSystemGenerated: true }),
      createMessage({ id: 'assistant-2', role: 'assistant', content: 'Building', promptContext: { ...promptContext, userMessage: 'Continue' } }),
    ]

    expect(buildPromptContextByUserMessageId(messages)).toEqual({
      'user-1': promptContext,
    })
  })
})
