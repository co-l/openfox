import { describe, expect, it } from 'vitest'
import {
  buildNonStreamingCreateParams,
  buildStreamingCreateParams,
  convertMessages,
} from './client-pure.js'
import type { LLMMessage } from './types.js'
import type { Attachment } from '../../shared/types.js'

describe('user vision override', () => {
  function makeAttachment(): Attachment {
    return {
      id: 'a1',
      filename: 'test.png',
      mimeType: 'image/png',
      size: 100,
      data: 'abc',
    }
  }

  function makeMessagesWithImage(): LLMMessage[] {
    return [
      {
        role: 'user' as const,
        content: 'hello',
        attachments: [makeAttachment()],
      },
    ]
  }

  it('profile says no vision -> image replaced with placeholder', () => {
    const result = convertMessages(makeMessagesWithImage(), { modelSupportsVision: false, visionFallbackEnabled: false })
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: '[Image: test.png] (vision not supported, cannot describe)' },
      ],
    })
  })

  it('profile says vision -> image sent as image_url', () => {
    const result = convertMessages(makeMessagesWithImage(), { modelSupportsVision: true, visionFallbackEnabled: false })
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'abc' } },
      ],
    })
  })

  it('buildStreamingCreateParams: profile says no vision, no override -> text placeholder', async () => {
    const profile = {
      temperature: 0.7,
      defaultMaxTokens: 4096,
      topP: 0.9,
      supportsReasoning: false,
      supportsVision: false,
    }

    const result = await buildStreamingCreateParams({
      model: 'test-model',
      request: {
        messages: makeMessagesWithImage(),
      },
      profile,
      capabilities: { supportsTopK: false, supportsChatTemplateKwargs: false },
      disableThinking: false,
    })

    expect((result.params as any).messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: '[Image: test.png] (vision not supported, cannot describe)' },
      ],
    }])
  })

  it('buildStreamingCreateParams: profile says no vision, user overrides to true -> image_url', async () => {
    const profile = {
      temperature: 0.7,
      defaultMaxTokens: 4096,
      topP: 0.9,
      supportsReasoning: false,
      supportsVision: false,
    }

    const result = await buildStreamingCreateParams({
      model: 'test-model',
      request: {
        messages: makeMessagesWithImage(),
        modelSettings: { supportsVision: true },
      },
      profile,
      capabilities: { supportsTopK: false, supportsChatTemplateKwargs: false },
      disableThinking: false,
    })

    expect((result.params as any).messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'abc' } },
      ],
    }])
  })

  it('buildStreamingCreateParams: profile says vision, user overrides to false -> text placeholder', async () => {
    const profile = {
      temperature: 0.7,
      defaultMaxTokens: 4096,
      topP: 0.9,
      supportsReasoning: false,
      supportsVision: true,
    }

    const result = await buildStreamingCreateParams({
      model: 'test-model',
      request: {
        messages: makeMessagesWithImage(),
        modelSettings: { supportsVision: false },
      },
      profile,
      capabilities: { supportsTopK: false, supportsChatTemplateKwargs: false },
      disableThinking: false,
    })

    expect((result.params as any).messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: '[Image: test.png] (vision not supported, cannot describe)' },
      ],
    }])
  })

  it('buildNonStreamingCreateParams: user vision override works the same way', async () => {
    const profile = {
      temperature: 0.7,
      defaultMaxTokens: 4096,
      topP: 0.9,
      supportsReasoning: false,
      supportsVision: false,
    }

    const result = await buildNonStreamingCreateParams({
      model: 'test-model',
      request: {
        messages: makeMessagesWithImage(),
        modelSettings: { supportsVision: true },
      },
      profile,
      capabilities: { supportsTopK: false, supportsChatTemplateKwargs: false },
    })

    expect((result.params as any).messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'abc' } },
      ],
    }])
  })
})
