import { describe, expect, it } from 'vitest'
import type { ToolResult } from '../../shared/types.js'
import type { LLMMessage } from '../llm/types.js'
import { convertMessages } from '../llm/client-pure.js'
import { buildContextMessagesFromEventHistory, buildContextMessagesFromStoredEvents } from './folding.js'
import type { StoredEvent } from './types.js'

const baseEvent = {
  seq: 1,
  sessionId: 'session-1',
  timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
}

const windowId = 'window-1'

const imageResult: ToolResult = {
  success: true,
  output: '[Image : page.png (image/png, 92857 octets)]',
  durationMs: 12,
  truncated: false,
  metadata: {
    mimeType: 'image/png',
    size: 92857,
    base64Data: 'iVBORw0KGgo=',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    path: '/tmp/page.png',
    description:
      '[Image: /tmp/page.png]\nYou cannot see this image directly — a separate vision model produced the description below:\n<image_description>\na dark-themed UI screenshot\n</image_description>',
  },
}

const pdfResult: ToolResult = {
  success: true,
  output: '[PDF: doc.pdf] page 1 content',
  durationMs: 5,
  truncated: false,
  metadata: { format: 'pdf', pageCount: 1, path: '/tmp/doc.pdf' },
}

const failingResult: ToolResult = {
  success: false,
  output: 'line1\nline2',
  error: 'Command exited with code 1',
  durationMs: 3,
  truncated: false,
}

// Chunk encoding: the raw streaming events (as buffered live in v1).
const rawEvents: StoredEvent[] = [
  {
    ...baseEvent,
    seq: 1,
    type: 'message.start',
    data: {
      messageId: 'm1',
      role: 'user',
      content: 'look at this',
      contextWindowId: windowId,
      attachments: [
        {
          id: 'att-1',
          filename: 'notes.txt',
          mimeType: 'text/plain',
          size: 10,
          data: 'data:text/plain;base64,aGVsbG8=',
        },
      ],
    },
  },
  { ...baseEvent, seq: 2, type: 'message.done', data: { messageId: 'm1' } },
  {
    ...baseEvent,
    seq: 3,
    type: 'message.start',
    data: { messageId: 'm2', role: 'assistant', content: '', contextWindowId: windowId },
  },
  {
    ...baseEvent,
    seq: 4,
    type: 'message.thinking',
    data: { messageId: 'm2', content: 'I should inspect the screenshot' },
  },
  {
    ...baseEvent,
    seq: 5,
    type: 'tool.call',
    data: { messageId: 'm2', toolCall: { id: 'call-img', name: 'read_file', arguments: { path: 'page.png' } } },
  },
  { ...baseEvent, seq: 6, type: 'tool.result', data: { messageId: 'm2', toolCallId: 'call-img', result: imageResult } },
  {
    ...baseEvent,
    seq: 7,
    type: 'tool.call',
    data: { messageId: 'm2', toolCall: { id: 'call-pdf', name: 'read_file', arguments: { path: 'doc.pdf' } } },
  },
  { ...baseEvent, seq: 8, type: 'tool.result', data: { messageId: 'm2', toolCallId: 'call-pdf', result: pdfResult } },
  {
    ...baseEvent,
    seq: 9,
    type: 'tool.call',
    data: { messageId: 'm2', toolCall: { id: 'call-fail', name: 'run_command', arguments: { command: 'false' } } },
  },
  {
    ...baseEvent,
    seq: 10,
    type: 'tool.result',
    data: { messageId: 'm2', toolCallId: 'call-fail', result: failingResult },
  },
  {
    ...baseEvent,
    seq: 11,
    type: 'message.delta',
    data: { messageId: 'm2', content: 'The screenshot shows a dark theme.' },
  },
  { ...baseEvent, seq: 12, type: 'message.done', data: { messageId: 'm2' } },
  {
    ...baseEvent,
    seq: 13,
    type: 'message.start',
    data: { messageId: 'm3', role: 'user', content: 'thanks', contextWindowId: windowId },
  },
  { ...baseEvent, seq: 14, type: 'message.done', data: { messageId: 'm3' } },
]

// Tree encoding: what the v2 conversation tree persists (merged message
// nodes + separate tool.result nodes).
const treeEvents: StoredEvent[] = [
  {
    ...baseEvent,
    seq: 1,
    type: 'message',
    data: {
      messageId: 'm1',
      role: 'user',
      content: 'look at this',
      contextWindowId: windowId,
      attachments: [
        {
          id: 'att-1',
          filename: 'notes.txt',
          mimeType: 'text/plain',
          size: 10,
          data: 'data:text/plain;base64,aGVsbG8=',
        },
      ],
    },
  },
  {
    ...baseEvent,
    seq: 3,
    type: 'message',
    data: {
      messageId: 'm2',
      role: 'assistant',
      content: 'The screenshot shows a dark theme.',
      thinkingContent: 'I should inspect the screenshot',
      toolCalls: [
        { id: 'call-img', name: 'read_file', arguments: { path: 'page.png' } },
        { id: 'call-pdf', name: 'read_file', arguments: { path: 'doc.pdf' } },
        { id: 'call-fail', name: 'run_command', arguments: { command: 'false' } },
      ],
      contextWindowId: windowId,
    },
  },
  { ...baseEvent, seq: 6, type: 'tool.result', data: { messageId: 'm2', toolCallId: 'call-img', result: imageResult } },
  { ...baseEvent, seq: 8, type: 'tool.result', data: { messageId: 'm2', toolCallId: 'call-pdf', result: pdfResult } },
  {
    ...baseEvent,
    seq: 10,
    type: 'tool.result',
    data: { messageId: 'm2', toolCallId: 'call-fail', result: failingResult },
  },
  {
    ...baseEvent,
    seq: 13,
    type: 'message',
    data: { messageId: 'm3', role: 'user', content: 'thanks', contextWindowId: windowId },
  },
]

async function rawWirePayload(): Promise<unknown[]> {
  const messages = buildContextMessagesFromStoredEvents(rawEvents, windowId) as LLMMessage[]
  return convertMessages(messages, false)
}

async function treeWirePayload(): Promise<unknown[]> {
  const messages = buildContextMessagesFromEventHistory(treeEvents, windowId) as LLMMessage[]
  return convertMessages(messages, false)
}

describe('tool result parity: chunk events vs tree-persisted encoding', () => {
  it('produces byte-identical LLM wire payloads from chunk and tree encodings', async () => {
    const [raw, tree] = await Promise.all([rawWirePayload(), treeWirePayload()])
    expect(tree).toEqual(raw)
  })

  it('keeps the vision description on image tool results when rebuilt from tree events', async () => {
    const tree = await treeWirePayload()
    const toolMsg = tree.find((m) => (m as { tool_call_id?: string }).tool_call_id === 'call-img') as {
      content: unknown
    }
    const serialized = JSON.stringify(toolMsg.content)
    expect(serialized).toContain('[Image : page.png (image/png, 92857 octets)]')
    expect(serialized).toContain('You cannot see this image directly')
  })
})
