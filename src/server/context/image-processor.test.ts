import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processContextImages, clearImageDescriptionCache } from './image-processor.js'
import type { StoredEvent, TurnEvent, SessionSnapshot, SnapshotMessage } from '../events/types.js'
import type { Attachment } from '../../shared/types.js'

vi.mock('../llm/vision-fallback.js', () => ({
  describeImageFromDataUrl: vi.fn().mockImplementation(async (dataUrl: string) => {
    if (dataUrl.includes('error')) throw new Error('API error')
    return 'A screenshot showing a terminal with error messages'
  }),
  VisionModelConfig: {},
}))

vi.mock('../tools/pdf-utils.js', () => {
  const textOnlyResult = {
    blocks: [{ type: 'text', content: '[Page 1/1]\nHello World' }],
    pageCount: 1,
    title: null,
    author: null,
    imageCount: 0,
    imageLimitReached: false,
  }

  const imagePdfResult = {
    blocks: [
      { type: 'text', content: '[Page 1/1]\nSome text before' },
      { type: 'image', dataUrl: 'data:image/png;base64,img1' },
      { type: 'image', dataUrl: 'data:image/png;base64,img2' },
      { type: 'text', content: '[Page 1/1]\nSome text after' },
    ],
    pageCount: 1,
    title: null,
    author: null,
    imageCount: 2,
    imageLimitReached: false,
  }

  const multiPageResult = {
    blocks: [
      { type: 'text', content: '[Page 1/2]\nPage 1 text' },
      { type: 'image', dataUrl: 'data:image/png;base64,page1_img' },
      { type: 'text', content: '[Page 2/2]\nPage 2 text' },
    ],
    pageCount: 2,
    title: null,
    author: null,
    imageCount: 1,
    imageLimitReached: false,
  }

  return {
    extractPdfContent: vi.fn().mockImplementation((buffer: Buffer) => {
      const dataStr = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer)
      if (dataStr.includes('image-pdf')) return imagePdfResult
      if (dataStr.includes('multi-page')) return multiPageResult
      return textOnlyResult
    }),
  }
})

function makeEvent(
  overrides: Partial<StoredEvent> & { type: StoredEvent['type']; data: StoredEvent['data'] },
): StoredEvent {
  return {
    seq: 1,
    timestamp: Date.now(),
    sessionId: 'test-session',
    ...overrides,
  } as StoredEvent
}

const imageAttachment: Attachment = {
  id: 'att-1',
  filename: 'screenshot.png',
  mimeType: 'image/png',
  size: 1024,
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
}

const imageAttachment2: Attachment = {
  id: 'att-2',
  filename: 'diagram.jpg',
  mimeType: 'image/jpeg',
  size: 2048,
  data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
}

describe('processContextImages', () => {
  beforeEach(async () => {
    clearImageDescriptionCache()
    vi.clearAllMocks()
    const mod = await import('../llm/vision-fallback.js')
    vi.mocked(mod.describeImageFromDataUrl).mockImplementation(async (dataUrl: string) => {
      if (dataUrl.includes('error')) throw new Error('API error')
      return 'A screenshot showing a terminal with error messages'
    })
  })

  it('returns events as-is when model supports vision', async () => {
    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, { modelSupportsVision: true })

    expect(result.events).toEqual(events)
    expect(result.descriptions.size).toBe(0)
  })

  it('enriches attachment with placeholder when no vision model configured', async () => {
    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, { modelSupportsVision: false })

    expect(result.events).not.toEqual(events)
    const msgStart = result.events[0]!
    expect(msgStart.type).toBe('message.start')
    const data = msgStart.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    // Attachments are kept intact (UI needs them)
    expect(data.attachments).toBeDefined()
    expect(data.attachments).toHaveLength(1)
    // Description is set on the attachment
    expect(data.attachments![0]!.description).toBe('[Image: screenshot.png]')
    // Original content is unchanged
    expect(data.content).toBe('What is in this image?')
    expect(result.descriptions.size).toBe(1)
  })

  it('describes images via vision model and enriches attachment with description', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledWith(
      imageAttachment.data,
      { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      expect.objectContaining({ context: 'File: screenshot.png' }),
    )

    const msgStart = result.events[0]!
    expect(msgStart.type).toBe('message.start')
    const data = msgStart.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    // Attachments are kept intact with description enriched
    expect(data.attachments).toBeDefined()
    expect(data.attachments).toHaveLength(1)
    expect(data.attachments![0]!.description).toBe('A screenshot showing a terminal with error messages')
    // Original content and image data are unchanged
    expect(data.content).toBe('What is in this image?')
    expect(data.attachments![0]!.data).toBe(imageAttachment.data)
    expect(result.descriptions.get('att-1')).toBe('A screenshot showing a terminal with error messages')
  })

  it('skips attachment that already has a description (was persisted previously)', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const attWithDescription: Attachment = {
      ...imageAttachment,
      description: 'Already described image',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [attWithDescription],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    // Vision model should NOT be called — description already exists
    expect(describeImageFromDataUrl).not.toHaveBeenCalled()
    const data = result.events[0]!.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    expect(data.attachments![0]!.description).toBe('Already described image')
    expect(result.descriptions.get('att-1')).toBe('Already described image')
  })

  it('caches descriptions by content hash across multiple calls', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const events1: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    await processContextImages(events1, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(1)

    const events2: StoredEvent[] = [
      makeEvent({
        seq: 3,
        type: 'message.start',
        data: {
          messageId: 'msg-2',
          role: 'user',
          content: 'Again?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 4, type: 'message.done', data: { messageId: 'msg-2' } }),
    ]

    await processContextImages(events2, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(1)
  })

  it('enriches tool result image metadata with description', async () => {
    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'assistant', contextWindowId: 'window-1' },
      }),
      makeEvent({
        seq: 2,
        type: 'tool.call',
        data: {
          messageId: 'msg-1',
          toolCall: { id: 'call-1', name: 'read_file', arguments: { path: '/test/image.png' } },
        },
      }),
      makeEvent({
        seq: 3,
        type: 'tool.result',
        data: {
          messageId: 'msg-1',
          toolCallId: 'call-1',
          result: {
            success: true,
            output: '[Image: /test/image.png (image/png, 1024 bytes)]',
            durationMs: 10,
            truncated: false,
            metadata: {
              mimeType: 'image/png',
              size: 1024,
              base64Data:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              path: '/test/image.png',
            },
          },
        },
      }),
      makeEvent({ seq: 4, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    const toolResult = result.events[2]!
    expect(toolResult.type).toBe('tool.result')
    const trData = toolResult.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
    // Metadata is kept intact with description added
    expect(trData.result.metadata).toBeDefined()
    expect(trData.result.metadata!['description']).toBe('A screenshot showing a terminal with error messages')
    // Original output is unchanged
    expect(trData.result.output).toBe('[Image: /test/image.png (image/png, 1024 bytes)]')
  })

  it('handles multiple images in a single message', async () => {
    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'Compare these',
          attachments: [imageAttachment, imageAttachment2],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    const msgStart = result.events[0]!
    const data = msgStart.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    // Attachments kept intact, both enriched with descriptions
    expect(data.attachments).toBeDefined()
    expect(data.attachments).toHaveLength(2)
    expect(data.attachments![0]!.description).toBeTruthy()
    expect(data.attachments![1]!.description).toBeTruthy()
    expect(result.descriptions.size).toBe(2)
  })

  it('handles messages without attachments', async () => {
    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello', contextWindowId: 'window-1' },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(result.events).toEqual(events)
    expect(result.descriptions.size).toBe(0)
  })

  it('handles abort signal gracefully', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')
    vi.mocked(describeImageFromDataUrl).mockImplementation(async (_dataUrl, _visionModel, options) => {
      try {
        await new Promise<void>((_resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
        return 'never reached'
      } catch {
        return '[Image description timed out]'
      }
    })

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    const abortController = new AbortController()
    const resultPromise = processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      signal: abortController.signal,
    })

    abortController.abort()

    const result = await resultPromise
    const msgStart = result.events[0]!
    const data = msgStart.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    // Attachment gets the timeout description
    expect(data.attachments![0]!.description).toBe('[Image description timed out]')

    vi.mocked(describeImageFromDataUrl).mockClear()
  })

  it('calls persistEvent callback when enriching attachments', async () => {
    const persistEvent = vi.fn()

    const events: StoredEvent[] = [
      makeEvent({
        seq: 5,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 6, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      persistEvent,
    })

    // Should have been called with sessionId, seq, and enriched data
    expect(persistEvent).toHaveBeenCalledTimes(1)
    expect(persistEvent).toHaveBeenCalledWith(
      'test-session',
      5,
      expect.objectContaining({
        messageId: 'msg-1',
        attachments: [
          expect.objectContaining({
            id: 'att-1',
            description: 'A screenshot showing a terminal with error messages',
          }),
        ],
      }),
    )
  })

  it('does not call persistEvent when attachment already has description', async () => {
    const persistEvent = vi.fn()

    const attWithDescription: Attachment = {
      ...imageAttachment,
      description: 'Already described',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 5,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [attWithDescription],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 6, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      persistEvent,
    })

    expect(persistEvent).not.toHaveBeenCalled()
  })

  it('enriches user message attachments inside turn.snapshot events', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const snapshotMsg: SnapshotMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'What is in this image?',
      timestamp: Date.now(),
      attachments: [imageAttachment],
      contextWindowId: 'window-1',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [snapshotMsg],
          criteria: [],
          metadataEntries: {},
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: true,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        } satisfies SessionSnapshot,
      }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(1)
    const snapshotEvent = result.events[0]!
    expect(snapshotEvent.type).toBe('turn.snapshot')
    const snapshotData = snapshotEvent.data as SessionSnapshot
    const processedMsg = snapshotData.messages[0]!
    // Attachments kept intact with description enriched
    expect(processedMsg.attachments).toBeDefined()
    expect(processedMsg.attachments).toHaveLength(1)
    expect(processedMsg.attachments![0]!.description).toBe('A screenshot showing a terminal with error messages')
    // Original content unchanged
    expect(processedMsg.content).toBe('What is in this image?')
    expect(result.descriptions.get('att-1')).toBe('A screenshot showing a terminal with error messages')
  })

  it('enriches tool result images inside assistant messages in turn.snapshot events', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const snapshotMsg: SnapshotMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Here is the image you requested.',
      timestamp: Date.now(),
      contextWindowId: 'window-1',
      toolCalls: [
        {
          id: 'call-1',
          name: 'read_file',
          arguments: { path: '/test/image.png' },
          result: {
            success: true,
            output: '[Image: /test/image.png (image/png, 1024 bytes)]',
            durationMs: 10,
            truncated: false,
            metadata: {
              mimeType: 'image/png',
              size: 1024,
              dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              path: '/test/image.png',
            },
          },
        },
      ],
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [snapshotMsg],
          criteria: [],
          metadataEntries: {},
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: true,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        } satisfies SessionSnapshot,
      }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(1)
    const snapshotEvent = result.events[0]!
    expect(snapshotEvent.type).toBe('turn.snapshot')
    const snapshotData = snapshotEvent.data as SessionSnapshot
    const processedMsg = snapshotData.messages[0]!
    // Metadata kept intact with description added
    expect(processedMsg.toolCalls![0]!.result!.metadata).toBeDefined()
    expect(processedMsg.toolCalls![0]!.result!.metadata!['description']).toBe(
      'A screenshot showing a terminal with error messages',
    )
    // Original output unchanged
    expect(processedMsg.toolCalls![0]!.result!.output).toBe('[Image: /test/image.png (image/png, 1024 bytes)]')
    expect(result.descriptions.get('call-1')).toBe('A screenshot showing a terminal with error messages')
  })

  it('leaves snapshot messages unchanged when model supports vision', async () => {
    const snapshotMsg: SnapshotMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'What is in this image?',
      timestamp: Date.now(),
      attachments: [imageAttachment],
      contextWindowId: 'window-1',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [snapshotMsg],
          criteria: [],
          metadataEntries: {},
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: true,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        } satisfies SessionSnapshot,
      }),
    ]

    const result = await processContextImages(events, { modelSupportsVision: true })

    expect(result.events).toEqual(events)
    expect(result.descriptions.size).toBe(0)
  })

  it('processes snapshot messages without attachments unchanged', async () => {
    const snapshotMsg: SnapshotMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Just text, no images',
      timestamp: Date.now(),
      contextWindowId: 'window-1',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [snapshotMsg],
          criteria: [],
          metadataEntries: {},
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: true,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        } satisfies SessionSnapshot,
      }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(result.events[0]).toEqual(events[0])
    expect(result.descriptions.size).toBe(0)
  })

  it('preserves image descriptions across snapshot boundary (integration)', async () => {
    const { buildContextMessagesFromEventHistory } = await import('../events/folding.js')

    const imageMsgEvent = makeEvent({
      seq: 1,
      type: 'message.start',
      data: {
        messageId: 'msg-1',
        role: 'user',
        content: 'What is in this image?',
        attachments: [imageAttachment],
        contextWindowId: 'window-1',
      },
    })
    const imageDoneEvent = makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } })

    const snapshotEvent = makeEvent({
      seq: 3,
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'What is in this image?',
            timestamp: Date.now(),
            attachments: [imageAttachment],
            contextWindowId: 'window-1',
          },
        ],
        criteria: [],
        metadataEntries: {},
        contextState: {
          currentTokens: 0,
          maxTokens: 200000,
          compactionCount: 0,
          dangerZone: false,
          canCompact: true,
          dynamicContextChanged: false,
        },
        currentContextWindowId: 'window-1',
        todos: [],
        snapshotSeq: 3,
        snapshotAt: Date.now(),
      } satisfies SessionSnapshot,
    })

    const textMsgEvent = makeEvent({
      seq: 4,
      type: 'message.start',
      data: {
        messageId: 'msg-2',
        role: 'user',
        content: 'Can you explain that further?',
        contextWindowId: 'window-1',
      },
    })
    const textDoneEvent = makeEvent({ seq: 5, type: 'message.done', data: { messageId: 'msg-2' } })

    const events: StoredEvent[] = [imageMsgEvent, imageDoneEvent, snapshotEvent, textMsgEvent, textDoneEvent]

    const { events: processedEvents } = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    const contextMessages = buildContextMessagesFromEventHistory(processedEvents, 'window-1')

    // The first message should contain the image description (via convertAttachmentSync)
    const firstMsg = contextMessages[0]!
    expect(firstMsg.role).toBe('user')
    // Content is unchanged, but attachments are preserved with description
    expect(firstMsg.content).toBe('What is in this image?')
    // Attachments are present (UI needs them) and have description
    expect(firstMsg.attachments).toBeDefined()
    expect(firstMsg.attachments).toHaveLength(1)
    expect(firstMsg.attachments![0]!.description).toBe('A screenshot showing a terminal with error messages')

    const secondMsg = contextMessages[1]!
    expect(secondMsg.role).toBe('user')
    expect(secondMsg.content).toBe('Can you explain that further?')
  })

  it('emits vision_fallback.start and vision_fallback.done events', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')
    vi.mocked(describeImageFromDataUrl).mockResolvedValue('A screenshot showing a terminal with error messages')

    const onEvent = vi.fn()

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: 'What is in this image?',
          attachments: [imageAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-1' } }),
    ]

    await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: 'vision_fallback.start',
      data: { messageId: 'msg-1', attachmentId: 'att-1', filename: 'screenshot.png' },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'vision_fallback.done',
      data: { messageId: 'msg-1', attachmentId: 'att-1', description: expect.any(String) },
    })
  })

  // PDF test helpers
  function makePdfDataUrl(content: string): string {
    return `data:application/pdf;base64,${Buffer.from(content).toString('base64')}`
  }

  const textOnlyPdfAttachment: Attachment = {
    id: 'pdf-text-1',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    size: 50,
    data: makePdfDataUrl('text-pdf content'),
  }

  const imagePdfAttachment: Attachment = {
    id: 'pdf-img-1',
    filename: 'image_doc.pdf',
    mimeType: 'application/pdf',
    size: 100,
    data: makePdfDataUrl('some image-pdf document'),
  }

  it('sets pdfContent on text-only PDF attachment without calling vision fallback', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-pdf-1',
          role: 'user',
          content: 'Read this PDF',
          attachments: [textOnlyPdfAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-pdf-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).not.toHaveBeenCalled()

    const msgStart = result.events[0]!
    expect(msgStart.type).toBe('message.start')
    const data = msgStart.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    expect(data.attachments).toHaveLength(1)
    const att = data.attachments![0]!
    expect(att.pdfContent).toBeDefined()
    expect(att.pdfContent).toContain('Hello World')
    expect(att.data).toBe(textOnlyPdfAttachment.data)
    expect(att.description).toBeUndefined()
  })

  it('describes embedded PDF images via vision fallback and sets pdfContent', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-pdf-img-1',
          role: 'user',
          content: 'Describe this PDF',
          attachments: [imagePdfAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-pdf-img-1' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    // Each embedded image gets described individually
    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(2)
    expect(describeImageFromDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,img1',
      expect.any(Object),
      expect.any(Object),
    )
    expect(describeImageFromDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,img2',
      expect.any(Object),
      expect.any(Object),
    )

    const msgStart = result.events[0]!
    const data = msgStart.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    const att = data.attachments![0]!
    expect(att.pdfContent).toBeDefined()
    expect(att.pdfContent).toContain('[PDF: image_doc.pdf]')
    expect(att.pdfContent).toContain('Some text before')
    expect(att.pdfContent).toContain('Some text after')
    expect(att.pdfContent).toContain('[Image: A screenshot showing a terminal with error messages]')
    expect(att.pdfContent).toContain('[Image: A screenshot showing a terminal with error messages]')
    // Original data preserved
    expect(att.data).toBe(imagePdfAttachment.data)
  })

  it('preserves text/image ordering in pdfContent', async () => {
    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-pdf-order',
          role: 'user',
          content: '',
          attachments: [imagePdfAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-pdf-order' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    const data = result.events[0]!.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    const pdfContent = data.attachments![0]!.pdfContent!
    expect(pdfContent).toBeDefined()

    const textBeforeIdx = pdfContent.indexOf('Some text before')
    const img1Idx = pdfContent.indexOf('[Image:')
    const textAfterIdx = pdfContent.indexOf('Some text after')

    expect(textBeforeIdx).toBeLessThan(img1Idx)
    // Last [Image: should be before the text after check, but there are 2 images
    // so we check that text_before < image1 < text_after
    expect(img1Idx).toBeLessThan(textAfterIdx)
  })

  it('reuses cached pdfContent on repeated processing', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const makeEventWithAtt = (seq: number, msgId: string, content: string, att: Attachment): StoredEvent =>
      makeEvent({
        seq,
        type: 'message.start',
        data: { messageId: msgId, role: 'user', content, attachments: [att], contextWindowId: 'window-1' },
      })

    const events1: StoredEvent[] = [
      makeEventWithAtt(1, 'm1', 'first', imagePdfAttachment),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'm1' } }),
    ]

    await processContextImages(events1, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(2)

    const events2: StoredEvent[] = [
      makeEventWithAtt(3, 'm2', 'again', imagePdfAttachment),
      makeEvent({ seq: 4, type: 'message.done', data: { messageId: 'm2' } }),
    ]

    const result2 = await processContextImages(events2, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    // No additional vision calls — cached
    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(2)

    const data2 = result2.events[0]!.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    expect(data2.attachments![0]!.pdfContent).toBeDefined()
  })

  it('skips PDF with existing pdfContent (previously persisted)', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const attWithPdfContent: Attachment = {
      ...imagePdfAttachment,
      pdfContent: '[PDF: image_doc.pdf]\n\nAlready enriched content',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'm-persisted',
          role: 'user',
          content: '',
          attachments: [attWithPdfContent],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'm-persisted' } }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).not.toHaveBeenCalled()
    const data = result.events[0]!.data as Extract<TurnEvent, { type: 'message.start' }>['data']
    expect(data.attachments![0]!.pdfContent).toContain('Already enriched content')
  })

  it('handles PDF attachments in turn.snapshot events', async () => {
    const { describeImageFromDataUrl } = await import('../llm/vision-fallback.js')

    const snapshotMsg: SnapshotMessage = {
      id: 'snap-msg-1',
      role: 'user',
      content: 'PDF in snapshot',
      timestamp: Date.now(),
      attachments: [imagePdfAttachment],
      contextWindowId: 'window-1',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [snapshotMsg],
          criteria: [],
          metadataEntries: {},
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: true,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        } satisfies SessionSnapshot,
      }),
    ]

    const result = await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
    })

    expect(describeImageFromDataUrl).toHaveBeenCalledTimes(2)
    const snapshotEvent = result.events[0]!
    expect(snapshotEvent.type).toBe('turn.snapshot')
    const snapshotData = snapshotEvent.data as SessionSnapshot
    const msg = snapshotData.messages[0]!
    expect(msg.attachments![0]!.pdfContent).toBeDefined()
    expect(msg.attachments![0]!.pdfContent).toContain('[PDF: image_doc.pdf]')
    expect(msg.attachments![0]!.data).toBe(imagePdfAttachment.data)
  })

  it('emits vision_fallback events for each PDF embedded image', async () => {
    const onEvent = vi.fn()

    const events: StoredEvent[] = [
      makeEvent({
        seq: 1,
        type: 'message.start',
        data: {
          messageId: 'msg-events',
          role: 'user',
          content: '',
          attachments: [imagePdfAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 2, type: 'message.done', data: { messageId: 'msg-events' } }),
    ]

    await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith({
      type: 'vision_fallback.start',
      data: { messageId: 'msg-events', attachmentId: 'pdf-img-1/image-0' },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'vision_fallback.done',
      data: { messageId: 'msg-events', attachmentId: 'pdf-img-1/image-0', description: expect.any(String) },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'vision_fallback.start',
      data: { messageId: 'msg-events', attachmentId: 'pdf-img-1/image-1' },
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'vision_fallback.done',
      data: { messageId: 'msg-events', attachmentId: 'pdf-img-1/image-1', description: expect.any(String) },
    })
  })

  it('calls persistEvent when enriching PDF attachment', async () => {
    const persistEvent = vi.fn()

    const events: StoredEvent[] = [
      makeEvent({
        seq: 10,
        type: 'message.start',
        data: {
          messageId: 'msg-persist',
          role: 'user',
          content: '',
          attachments: [imagePdfAttachment],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 11, type: 'message.done', data: { messageId: 'msg-persist' } }),
    ]

    await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      persistEvent,
    })

    expect(persistEvent).toHaveBeenCalledTimes(1)
    expect(persistEvent).toHaveBeenCalledWith(
      'test-session',
      10,
      expect.objectContaining({
        messageId: 'msg-persist',
        attachments: [
          expect.objectContaining({
            id: 'pdf-img-1',
            pdfContent: expect.any(String),
          }),
        ],
      }),
    )
  })

  it('does not call persistEvent when PDF already has pdfContent', async () => {
    const persistEvent = vi.fn()

    const attWithContent: Attachment = {
      ...imagePdfAttachment,
      pdfContent: 'Already enriched',
    }

    const events: StoredEvent[] = [
      makeEvent({
        seq: 12,
        type: 'message.start',
        data: {
          messageId: 'msg-no-persist',
          role: 'user',
          content: '',
          attachments: [attWithContent],
          contextWindowId: 'window-1',
        },
      }),
      makeEvent({ seq: 13, type: 'message.done', data: { messageId: 'msg-no-persist' } }),
    ]

    await processContextImages(events, {
      modelSupportsVision: false,
      visionModel: { baseUrl: 'http://localhost:11434', model: 'llava', timeout: 30000, backend: 'ollama' },
      persistEvent,
    })

    expect(persistEvent).not.toHaveBeenCalled()
  })
})
