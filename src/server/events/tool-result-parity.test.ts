import { describe, expect, it } from 'vitest'
import type { ToolResult } from '../../shared/types.js'
import type { LLMMessage } from '../llm/types.js'
import { convertMessages } from '../llm/client-pure.js'
import {
  buildContextMessagesFromEventHistory,
  buildContextMessagesFromStoredEvents,
  foldTurnEventsToSnapshotMessages,
} from './folding.js'
import type { SessionSnapshot, StoredEvent } from './types.js'

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

const snapshotMessages = foldTurnEventsToSnapshotMessages(rawEvents)

const snapshotEvent: StoredEvent = {
  ...baseEvent,
  seq: 100,
  type: 'turn.snapshot',
  data: {
    mode: 'builder',
    phase: 'build',
    isRunning: false,
    messages: snapshotMessages,
    criteria: [],
    metadataEntries: {},
    todos: [],
    contextState: {
      currentTokens: 0,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
      dynamicContextChanged: false,
    },
    currentContextWindowId: windowId,
    readFiles: [],
    snapshotSeq: 100,
    snapshotAt: baseEvent.timestamp,
  } as SessionSnapshot,
}

async function rawWirePayload(): Promise<unknown[]> {
  const messages = buildContextMessagesFromStoredEvents(rawEvents, windowId) as LLMMessage[]
  return convertMessages(messages, false)
}

async function snapshotWirePayload(): Promise<unknown[]> {
  const messages = buildContextMessagesFromEventHistory([snapshotEvent], windowId) as LLMMessage[]
  return convertMessages(messages, false)
}

describe('tool result parity: raw events vs snapshot reconstruction', () => {
  it('produces byte-identical LLM wire payloads from raw events and snapshot', async () => {
    const [raw, snap] = await Promise.all([rawWirePayload(), snapshotWirePayload()])
    expect(snap).toEqual(raw)
  })

  it('keeps the vision description on image tool results when rebuilt from a snapshot', async () => {
    const snap = await snapshotWirePayload()
    const toolMsg = snap.find((m) => (m as { tool_call_id?: string }).tool_call_id === 'call-img') as {
      content: unknown
    }
    const serialized = JSON.stringify(toolMsg.content)
    expect(serialized).toContain('[Image : page.png (image/png, 92857 octets)]')
    expect(serialized).toContain('You cannot see this image directly')
  })
})
