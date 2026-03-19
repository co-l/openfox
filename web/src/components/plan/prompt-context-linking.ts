import type { Message, PromptContext } from '../../../../src/shared/types.js'

export function buildPromptContextByUserMessageId(messages: Message[]): Record<string, PromptContext> {
  const promptContextByUserMessageId: Record<string, PromptContext> = {}
  let activeUserMessageId: string | null = null

  for (const message of messages) {
    if (message.role === 'user' && !message.isSystemGenerated) {
      activeUserMessageId = message.id
      continue
    }

    if (
      message.role === 'assistant'
      && message.promptContext
      && activeUserMessageId
      && promptContextByUserMessageId[activeUserMessageId] === undefined
    ) {
      promptContextByUserMessageId[activeUserMessageId] = message.promptContext
    }
  }

  return promptContextByUserMessageId
}
