/**
 * Conversation Tree primitives
 *
 * Sessions are stored as trees of events: every persisted event is a node
 * (event_id, parent_id) inside a tree owned by one or more sessions. A
 * session is (tree_id, cursor_event_id) - its active conversation path.
 *
 * - Streaming chunks (message.delta / message.thinking / tool.output /
 *   tool.preparing) and queue events are ephemeral: broadcast to live WS
 *   clients but never persisted. A message is persisted once, when complete,
 *   as a single `message` event.
 * - Branching only happens at message boundaries (stable cut points that
 *   correspond to previously served LLM requests, so prefix caching stays
 *   coherent).
 * - Large tool results are externalized to the blobs table; the event
 *   payload carries {blobRef, size, preview} and the store hydrates on read.
 *
 * The tree is append-only: once a node exists its path never changes, which
 * makes path resolution results permanently cacheable.
 */

import { createHash } from 'node:crypto'
import type { MessageSegment, MessageStats, PreparingToolCall, ToolCall, ToolResult } from '../../shared/types.js'
import type { ExternalizedContent, MessageOptionalData, StoredEvent, TurnEvent } from './types.js'

// ============================================================================
// Event classification
// ============================================================================

/**
 * Event types that are live-streaming only: pushed to WS subscribers but
 * never written to the store. Chunks are merged into the single `message`
 * event at completion; queue events are runtime state owned by the
 * session manager's in-memory queue.
 */
export const EPHEMERAL_EVENT_TYPES = new Set<string>([
  'message.delta',
  'message.thinking',
  'tool.output',
  'tool.preparing',
  'queue.added',
  'queue.drained',
  'queue.cancelled',
])

/** Event types that mark a message boundary - the only legal branch points. */
const MESSAGE_BOUNDARY_TYPES = new Set<string>(['message', 'message.start', 'message.done'])

export function isBranchPointEvent(type: string, data: unknown): boolean {
  if (!MESSAGE_BOUNDARY_TYPES.has(type)) return false
  const d = data as { messageId?: string } | null
  return typeof d?.messageId === 'string' && d.messageId.length > 0
}

// ============================================================================
// Message merge buffer (chunks -> single `message` event)
// ============================================================================

export type MessageBufferStart = { role: 'user' | 'assistant' | 'system' } & MessageOptionalData

/**
 * Copy the shared optional message fields (see MessageOptionalData) that are
 * set on `data`, preserving exact-optional semantics (undefined stays absent).
 */
export function extractMessageOptionalFields(data: {
  tokenCount?: number
  contextWindowId?: string
  subAgentId?: string
  subAgentType?: string
  isSystemGenerated?: boolean
  messageKind?: string
  isCompactionSummary?: boolean
  attachments?: unknown[]
  metadata?: unknown
}): Record<string, unknown> {
  return {
    ...(data.tokenCount !== undefined && { tokenCount: data.tokenCount }),
    ...(data.contextWindowId !== undefined && { contextWindowId: data.contextWindowId }),
    ...(data.subAgentId !== undefined && { subAgentId: data.subAgentId }),
    ...(data.subAgentType !== undefined && { subAgentType: data.subAgentType }),
    ...(data.isSystemGenerated !== undefined && { isSystemGenerated: data.isSystemGenerated }),
    ...(data.messageKind !== undefined && { messageKind: data.messageKind }),
    ...(data.isCompactionSummary !== undefined && { isCompactionSummary: data.isCompactionSummary }),
    ...(data.attachments !== undefined && { attachments: data.attachments }),
    ...(data.metadata !== undefined && { metadata: data.metadata }),
  }
}

export interface MessageBuffer {
  start: MessageBufferStart
  content: string
  thinking: string
  toolCalls: ToolCall[]
  /** In-flight tool calls whose arguments are still streaming (UI skeletons). */
  preparing: PreparingToolCall[]
  /**
   * Tool results that arrived while the message is in flight. Persisted as
   * children of the merged message node at completion, so path order is
   * message → results (what the fold / context builder expect).
   */
  toolResults: Array<{ toolCallId: string; result: ToolResult; timestamp: number }>
  /**
   * User/system messages that arrived while the turn is in flight (e.g. a
   * system-reminder injected during tool execution). Persisted AFTER the
   * merged assistant node at completion, preserving the v1 live order in
   * which the injected message follows the turn it interrupted.
   */
  injected: Array<{ message: Extract<TurnEvent, { type: 'message' }>; timestamp: number }>
  stats?: MessageStats
  segments?: MessageSegment[]
  partial?: boolean
  tokenCount?: number
  isStreaming: boolean
  startedAt: number
}

export function createMessageBuffer(start: MessageBufferStart): MessageBuffer {
  return {
    start,
    content: '',
    thinking: '',
    toolCalls: [],
    preparing: [],
    toolResults: [],
    injected: [],
    isStreaming: true,
    startedAt: Date.now(),
  }
}

/**
 * Fold a streaming event into the buffer. Returns true when the event
 * contributed to the message (delta/thinking/tool.call/tool.preparing).
 */
export function applyBufferEvent(buffer: MessageBuffer, event: TurnEvent): boolean {
  switch (event.type) {
    case 'message.delta': {
      buffer.content += event.data.content
      return true
    }
    case 'message.thinking': {
      buffer.thinking += event.data.content
      return true
    }
    case 'tool.call': {
      const existing = buffer.toolCalls.find((tc) => tc.id === event.data.toolCall.id)
      if (!existing) buffer.toolCalls.push(event.data.toolCall)
      // The call is now concrete — drop the streaming-argument skeletons
      // (mirrors the v1 fold, which cleared preparing on any tool.call).
      buffer.preparing = []
      return true
    }
    case 'tool.preparing': {
      const existingIndex = buffer.preparing.findIndex((p) => p.index === event.data.index)
      const entry: PreparingToolCall = {
        index: event.data.index,
        name: event.data.name,
        ...(event.data.arguments !== undefined ? { arguments: event.data.arguments } : {}),
      }
      if (existingIndex >= 0) {
        buffer.preparing[existingIndex] = entry
      } else {
        buffer.preparing.push(entry)
      }
      return true
    }
    default:
      return false
  }
}

/**
 * Apply the message.done payload and mark the buffer complete.
 */
export function finalizeBuffer(buffer: MessageBuffer, event: Extract<TurnEvent, { type: 'message.done' }>): void {
  const data = event.data
  if (data.stats) buffer.stats = data.stats
  if (data.segments) buffer.segments = data.segments
  if (data.partial) buffer.partial = true
  if (data.tokenCount !== undefined) buffer.tokenCount = data.tokenCount
  buffer.isStreaming = false
}

type MessageEventData = Extract<TurnEvent, { type: 'message' }>['data']

/**
 * Merge a completed buffer into the single persisted `message` event.
 * Tool calls are stored WITHOUT results - results live in separate
 * tool.result events (so large payloads can be externalized to blobs).
 */
export function mergeBufferToMessageEvent(buffer: MessageBuffer, messageId: string): TurnEvent {
  const { start, content, thinking, toolCalls } = buffer
  // NOTE: isComplete/completeReason are deliberately NOT carried here — in the
  // v1 fold they are set exclusively by the separate chat.done event, and the
  // merged event must fold to an identical message state (KV prefix parity).
  const data: MessageEventData = {
    messageId,
    role: start.role,
    content,
    ...(thinking ? { thinkingContent: thinking } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...extractMessageOptionalFields(start),
    ...(buffer.tokenCount !== undefined ? { tokenCount: buffer.tokenCount } : {}),
    ...(buffer.stats !== undefined ? { stats: buffer.stats } : {}),
    ...(buffer.segments !== undefined ? { segments: buffer.segments } : {}),
    ...(buffer.partial ? { partial: true } : {}),
  }
  return { type: 'message', data }
}

/**
 * Build the `message` event for a user/system message (content is known up
 * front - no merge needed).
 */
export function buildUserMessageEvent(
  event: Extract<TurnEvent, { type: 'message.start' }>,
): Extract<TurnEvent, { type: 'message' }> {
  const data = event.data
  // isComplete is not set: the v1 fold leaves it unset for non-chat.done
  // messages (parity requirement for the merged event).
  const out: MessageEventData = {
    messageId: data.messageId,
    role: data.role,
    content: data.content ?? '',
    ...extractMessageOptionalFields(data),
  }
  return { type: 'message', data: out }
}

/** In-flight view of an injected message buffered during a turn (state sync). */
export function injectedToInflightMessage(message: Extract<TurnEvent, { type: 'message' }>, timestamp: number) {
  const data = message.data
  return {
    id: data.messageId,
    role: data.role,
    content: data.content,
    timestamp: new Date(timestamp).toISOString(),
    isStreaming: false,
    ...(data.thinkingContent ? { thinkingContent: data.thinkingContent } : {}),
    ...(data.toolCalls && data.toolCalls.length > 0 ? { toolCalls: data.toolCalls } : {}),
    ...extractMessageOptionalFields(data),
  }
}

/** In-flight view of a buffered message for state sync (reconnect parity). */
export function bufferToInflightMessage(buffer: MessageBuffer, messageId: string) {
  return {
    id: messageId,
    role: buffer.start.role,
    content: buffer.content,
    timestamp: new Date(buffer.startedAt).toISOString(),
    isStreaming: true,
    ...(buffer.thinking ? { thinkingContent: buffer.thinking } : {}),
    ...(buffer.toolCalls.length > 0
      ? {
          toolCalls: buffer.toolCalls.map((tc) => {
            const tr = buffer.toolResults.find((r) => r.toolCallId === tc.id)
            return tr ? { ...tc, result: tr.result } : tc
          }),
        }
      : {}),
    ...(buffer.preparing.length > 0 ? { preparingToolCalls: buffer.preparing } : {}),
    ...extractMessageOptionalFields(buffer.start),
  }
}

// ============================================================================
// Blob externalization (large tool results)
// ============================================================================

/** Serialized tool results above this size are externalized to the blobs table. */
export const BLOB_EXTERNALIZE_THRESHOLD = 256 * 1024
/** Serialized `message` payloads above this size externalize their content. */
export const MESSAGE_EXTERNALIZE_THRESHOLD = 1024 * 1024
/** Head of the content kept inline as a preview. */
const BLOB_PREVIEW_BYTES = 4 * 1024

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Build an externalized reference for a piece of text content (the full
 * text is stored in the blobs table, deduplicated by hash). Returns null
 * when the content fits inline.
 */
export function externalizeText(text: string, threshold: number): ExternalizedContent | null {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= threshold) return null
  return {
    blobRef: hashContent(text),
    size: bytes,
    preview: text.slice(0, BLOB_PREVIEW_BYTES),
    truncated: true,
  }
}

function extractResultText(result: ToolResult): string {
  if (result.output) return result.output
  if (result.error) return result.error
  return JSON.stringify(result)
}

/**
 * Decide whether a tool result should be externalized and build the
 * externalized reference. The blob holds the FULL serialized result (so
 * hydration is byte-identical); the preview is the head of the result text.
 * Returns null when the payload fits inline.
 */
export function externalizeToolResult(
  result: ToolResult,
  threshold: number = BLOB_EXTERNALIZE_THRESHOLD,
): ExternalizedContent | null {
  const serialized = JSON.stringify(result)
  if (serialized.length <= threshold) return null
  return {
    blobRef: hashContent(serialized),
    size: Buffer.byteLength(serialized, 'utf8'),
    preview: extractResultText(result).slice(0, BLOB_PREVIEW_BYTES),
    truncated: true,
  }
}

export function isExternalized(value: unknown): value is ExternalizedContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ExternalizedContent).blobRef === 'string' &&
    typeof (value as ExternalizedContent).size === 'number'
  )
}

// ============================================================================
// Tree path resolution (pure - operates on row maps)
// ============================================================================

export interface TreeEventRow {
  eventId: string
  parentId: string | null
  seq: number
  timestamp: number
  event_type: string
  payload: string
}

/**
 * Walk the parent chain from a cursor to the tree root and return the path
 * in root-first order. Paths are immutable once built, so results are safe
 * to cache indefinitely.
 */
export function resolvePath(rowsById: Map<string, TreeEventRow>, cursorId: string | null | undefined): TreeEventRow[] {
  if (!cursorId) return []
  const path: TreeEventRow[] = []
  let current: TreeEventRow | undefined = rowsById.get(cursorId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.eventId)) break // cycle guard (corrupt data)
    seen.add(current.eventId)
    path.push(current)
    current = current.parentId ? rowsById.get(current.parentId) : undefined
  }
  path.reverse()
  return path
}

/**
 * Branch tips: events that have no children AND are not ancestors of any
 * alive cursor. These are the selectable endpoints of the conversation tree.
 */
export function getBranchTips(rowsById: Map<string, TreeEventRow>, aliveCursorIds: string[]): string[] {
  const aliveAncestors = new Set<string>()
  for (const cursorId of aliveCursorIds) {
    for (const row of resolvePath(rowsById, cursorId)) {
      aliveAncestors.add(row.eventId)
    }
  }
  const hasChild = new Set<string>()
  for (const row of rowsById.values()) {
    if (row.parentId) hasChild.add(row.parentId)
  }
  const tips: string[] = []
  for (const row of rowsById.values()) {
    if (hasChild.has(row.eventId)) continue
    if (aliveAncestors.has(row.eventId)) continue
    if (row.eventId === 'root') continue
    tips.push(row.eventId)
  }
  return tips
}

/**
 * Event ids that are dead: not on the path of any alive cursor. Their
 * subtrees (and blobs no longer referenced) are garbage.
 */
export function getDeadEventIds(rowsById: Map<string, TreeEventRow>, aliveCursorIds: string[]): Set<string> {
  const alive = new Set<string>()
  for (const cursorId of aliveCursorIds) {
    for (const row of resolvePath(rowsById, cursorId)) {
      alive.add(row.eventId)
    }
  }
  const dead = new Set<string>()
  for (const row of rowsById.values()) {
    if (!alive.has(row.eventId)) dead.add(row.eventId)
  }
  return dead
}

/**
 * Selectable branch tips for a session's branch switcher: tree leaves that
 * are NOT on the session's active path. (Leaves on other sessions' live
 * paths are still switchable — switching forks the path further, never
 * corrupting the other session.)
 */
export function getTipsOutsidePath(rowsById: Map<string, TreeEventRow>, excludePath: TreeEventRow[]): TreeEventRow[] {
  const onPath = new Set(excludePath.map((row) => row.eventId))
  const hasChild = new Set<string>()
  for (const row of rowsById.values()) {
    if (row.parentId) hasChild.add(row.parentId)
  }
  const tips: TreeEventRow[] = []
  for (const row of rowsById.values()) {
    if (onPath.has(row.eventId)) continue
    if (hasChild.has(row.eventId)) continue
    tips.push(row)
  }
  return tips
}

/**
 * Convert tree rows to StoredEvents in path order.
 */
export function rowsToStoredEvents(treeId: string, rows: TreeEventRow[]): StoredEvent[] {
  return rows.map((row) => ({
    seq: row.seq,
    timestamp: row.timestamp,
    sessionId: treeId,
    type: row.event_type as TurnEvent['type'],
    data: JSON.parse(row.payload) as TurnEvent['data'],
    eventId: row.eventId,
    parentId: row.parentId,
  }))
}
