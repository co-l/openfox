/**
 * Event Folding Functions
 *
 * Pure functions that reconstruct state from events.
 * All state is derived from events - no external data sources.
 */

import type {
  Message,
  Criterion,
  CriterionStatus,
  SessionMode,
  SessionPhase,
  ContextState,
  Todo,
  ToolCall,
  Attachment,
} from '../../shared/types.js'
import type {
  StoredEvent,
  TurnEvent,
  SessionSnapshot,
  SnapshotMessage,
  ToolCallWithResult,
  ReadFileEntry,
} from './types.js'

// ============================================================================
// Types
// ============================================================================

export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}

export interface ContextMessageBuildOptions {
  includeVerifier?: boolean
}

type EventLike = Pick<StoredEvent, 'type' | 'data'> & Partial<Pick<StoredEvent, 'timestamp'>>

/**
 * Full session state derived entirely from events
 */
export interface FoldedSessionState {
  mode: SessionMode
  phase: SessionPhase
  isRunning: boolean
  messages: SnapshotMessage[]
  criteria: Criterion[]
  todos: Todo[]
  contextState: ContextState
  currentContextWindowId: string
  readFiles: ReadFileEntry[]
}

// ============================================================================
// Message Folding
// ============================================================================

/**
 * Build Message[] from stored events (for backward compatibility with shared types)
 * 
 * If a snapshot exists, messages are extracted from it since individual message events
 * may have been deleted to save space.
 */
export function buildMessagesFromStoredEvents(events: StoredEvent[]): Message[] {
  // Check if there's a snapshot - if so, extract messages from it
  const snapshotEvent = events.find(e => e.type === 'turn.snapshot')
  if (snapshotEvent) {
    const snapshot = snapshotEvent.data as import('./types.js').SessionSnapshot
    return snapshot.messages.map(msg => {
      const message: Message = {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp).toISOString(),
        ...(msg.tokenCount !== undefined && { tokenCount: msg.tokenCount }),
        ...(msg.isStreaming !== undefined && { isStreaming: msg.isStreaming }),
        ...(msg.contextWindowId !== undefined && { contextWindowId: msg.contextWindowId }),
        ...(msg.subAgentId !== undefined && { subAgentId: msg.subAgentId }),
        ...(msg.subAgentType !== undefined && { subAgentType: msg.subAgentType }),
        ...(msg.isSystemGenerated !== undefined && { isSystemGenerated: msg.isSystemGenerated }),
        ...(msg.messageKind !== undefined && { messageKind: msg.messageKind }),
        ...(msg.isCompactionSummary !== undefined && { isCompactionSummary: msg.isCompactionSummary }),
        ...(msg.attachments !== undefined && { attachments: msg.attachments }),
        ...(msg.thinkingContent !== undefined && { thinkingContent: msg.thinkingContent }),
        ...(msg.toolCalls !== undefined && { toolCalls: msg.toolCalls }),
        ...(msg.segments !== undefined && { segments: msg.segments }),
        ...(msg.stats !== undefined && { stats: msg.stats }),
        ...(msg.partial !== undefined && { partial: msg.partial }),
        ...(msg.promptContext !== undefined && { promptContext: msg.promptContext }),
      }
      return message
    })
  }

  // Fallback: build from individual message events (for sessions without snapshots)
  const messages = new Map<string, Message>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        const isUserOrSystem = data.role === 'user' || data.role === 'system'
        messages.set(data.messageId, {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp: new Date(event.timestamp).toISOString(),
          tokenCount: data.tokenCount ?? 0,
          isStreaming: !isUserOrSystem,
          ...(data.contextWindowId !== undefined && { contextWindowId: data.contextWindowId }),
          ...(data.subAgentId !== undefined && { subAgentId: data.subAgentId }),
          ...(data.subAgentType !== undefined && { subAgentType: data.subAgentType }),
          ...(data.isSystemGenerated !== undefined && { isSystemGenerated: data.isSystemGenerated }),
          ...(data.messageKind !== undefined && { messageKind: data.messageKind }),
          ...(data.isCompactionSummary !== undefined && { isCompactionSummary: data.isCompactionSummary }),
          ...(data.attachments !== undefined && { attachments: data.attachments }),
        })
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      case 'message.thinking': {
        const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
        }
        break
      }
      case 'message.done': {
        const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.isStreaming = false
          if (data.stats) msg.stats = data.stats
          if (data.segments) msg.segments = data.segments
          if (data.partial) msg.partial = data.partial
          if (data.promptContext) msg.promptContext = data.promptContext
          if (data.tokenCount !== undefined) msg.tokenCount = data.tokenCount
        }
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        const msg = messages.get(data.messageId)
        if (msg?.toolCalls) {
          const toolCall = msg.toolCalls.find((tc) => tc.id === data.toolCallId)
          if (toolCall) {
            toolCall.result = data.result
          }
        }
        break
      }
      // Ignore non-message events
      case 'session.initialized':
      case 'turn.snapshot':
      case 'phase.changed':
      case 'mode.changed':
      case 'running.changed':
      case 'criteria.set':
      case 'criterion.updated':
      case 'context.state':
      case 'context.compacted':
      case 'file.read':
      case 'todo.updated':
      case 'chat.done':
      case 'chat.error':
      case 'format.retry':
      case 'tool.preparing':
      case 'tool.output':
        break
    }
  }

  return Array.from(messages.values())
}

/**
 * Build context messages for LLM from stored events.
 * When windowId is provided, only messages in that context window are included.
 * 
 * If events are missing (deleted after snapshot), this function will not find them.
 * Callers should ensure they have access to the latest snapshot for complete message history.
 */
export function buildContextMessagesFromStoredEvents(
  events: StoredEvent[],
  windowId?: string,
  options?: ContextMessageBuildOptions,
): ContextMessage[] {
  const includeVerifier = options?.includeVerifier ?? true
  const messages: Array<ContextMessage & { id: string }> = []
  const messageMap = new Map<string, ContextMessage & { id: string }>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        if (
          data.role !== 'system'
          && (windowId === undefined || data.contextWindowId === windowId)
          && (includeVerifier || data.subAgentType !== 'verifier')
        ) {
          const message: ContextMessage & { id: string } = {
            id: data.messageId,
            role: data.role as 'user' | 'assistant',
            content: data.content ?? '',
            ...(data.attachments !== undefined && { attachments: data.attachments }),
          }
          messageMap.set(data.messageId, message)
          messages.push(message)
        }
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messageMap.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messageMap.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        if (messageMap.has(data.messageId)) {
          messages.push({
            id: `tool-${data.toolCallId}`,
            role: 'tool',
            content: data.result.success ? (data.result.output ?? 'Success') : `Error: ${data.result.error}`,
            toolCallId: data.toolCallId,
          })
        }
        break
      }
    }
  }

  return messages.map(({ id: _id, ...message }) => message)
}

/**
 * Fold events into SnapshotMessage[] for snapshots
 */
export function foldTurnEventsToSnapshotMessages(events: EventLike[]): SnapshotMessage[] {
  const messages = new Map<string, SnapshotMessage>()

  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        const msg: SnapshotMessage = {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
          isStreaming: true,
        }
        if (data.tokenCount !== undefined) msg.tokenCount = data.tokenCount
        if (data.contextWindowId !== undefined) msg.contextWindowId = data.contextWindowId
        if (data.subAgentId !== undefined) msg.subAgentId = data.subAgentId
        if (data.subAgentType !== undefined) msg.subAgentType = data.subAgentType
        if (data.isSystemGenerated !== undefined) msg.isSystemGenerated = data.isSystemGenerated
        if (data.messageKind !== undefined) msg.messageKind = data.messageKind
        if (data.isCompactionSummary !== undefined) msg.isCompactionSummary = data.isCompactionSummary
        if (data.attachments !== undefined) msg.attachments = data.attachments
        messages.set(data.messageId, msg)
        break
      }
      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }
      case 'message.thinking': {
        const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
        }
        break
      }
      case 'message.done': {
        const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.isStreaming = false
          if (data.stats) msg.stats = data.stats
          if (data.segments) msg.segments = data.segments
          if (data.partial) msg.partial = data.partial
          if (data.promptContext) msg.promptContext = data.promptContext
          if (data.tokenCount !== undefined) msg.tokenCount = data.tokenCount
        }
        break
      }
      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall as ToolCallWithResult)
        }
        break
      }
      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        const msg = messages.get(data.messageId)
        if (msg?.toolCalls) {
          const toolCall = msg.toolCalls.find((tc) => tc.id === data.toolCallId)
          if (toolCall) {
            toolCall.result = data.result
          }
        }
        break
      }
    }
  }

  return Array.from(messages.values())
}

// ============================================================================
// Criteria Folding
// ============================================================================

/**
 * Fold criteria state from events
 */
export function foldCriteria(events: EventLike[]): Criterion[] {
  let criteria: Criterion[] = []

  for (const event of events) {
    switch (event.type) {
      case 'criteria.set': {
        const data = event.data as Extract<TurnEvent, { type: 'criteria.set' }>['data']
        criteria = data.criteria
        break
      }
      case 'criterion.updated': {
        const data = event.data as Extract<TurnEvent, { type: 'criterion.updated' }>['data']
        criteria = criteria.map((c) =>
          c.id === data.criterionId ? { ...c, status: data.status } : c
        )
        break
      }
    }
  }

  return criteria
}

// ============================================================================
// Todos Folding
// ============================================================================

/**
 * Fold todos state from events
 */
export function foldTodos(events: EventLike[]): Todo[] {
  let todos: Todo[] = []

  for (const event of events) {
    if (event.type === 'todo.updated') {
      const data = event.data as Extract<TurnEvent, { type: 'todo.updated' }>['data']
      todos = data.todos
    }
  }

  return todos
}

// ============================================================================
// Context State Folding
// ============================================================================

interface ContextFoldResult {
  currentContextWindowId: string
  compactionCount: number
  readFiles: ReadFileEntry[]
  // Latest context.state from LLM (real promptTokens)
  latestContextState: ContextState | null
}

/**
 * Fold context state from events
 */
export function foldContextState(events: EventLike[], initialWindowId: string): ContextFoldResult {
  let currentContextWindowId = initialWindowId
  let compactionCount = 0
  let latestContextState: ContextState | null = null
  const readFilesMap = new Map<string, ReadFileEntry>()

  for (const event of events) {
    switch (event.type) {
      case 'session.initialized': {
        const data = event.data as Extract<TurnEvent, { type: 'session.initialized' }>['data']
        currentContextWindowId = data.contextWindowId
        break
      }
      case 'context.state': {
        // Use the real promptTokens from LLM
        const data = event.data as ContextState
        latestContextState = data
        break
      }
      case 'context.compacted': {
        const data = event.data as Extract<TurnEvent, { type: 'context.compacted' }>['data']
        currentContextWindowId = data.newWindowId
        compactionCount++
        // Clear read files cache on compaction (new window)
        readFilesMap.clear()
        // Reset context state after compaction (will be updated by next LLM call)
        latestContextState = null
        break
      }
      case 'file.read': {
        const data = event.data as Extract<TurnEvent, { type: 'file.read' }>['data']
        // Only track reads for current window
        if (data.contextWindowId === currentContextWindowId) {
          readFilesMap.set(data.path, {
            path: data.path,
            tokenCount: data.tokenCount,
          })
        }
        break
      }
    }
  }

  return {
    currentContextWindowId,
    compactionCount,
    readFiles: Array.from(readFilesMap.values()),
    latestContextState,
  }
}

// ============================================================================
// Session State Folding
// ============================================================================

/**
 * Fold mode from events (returns latest mode)
 */
export function foldMode(events: EventLike[]): SessionMode {
  let mode: SessionMode = 'planner'

  for (const event of events) {
    if (event.type === 'mode.changed') {
      const data = event.data as Extract<TurnEvent, { type: 'mode.changed' }>['data']
      mode = data.mode
    }
  }

  return mode
}

/**
 * Fold phase from events (returns latest phase)
 */
export function foldPhase(events: EventLike[]): SessionPhase {
  let phase: SessionPhase = 'plan'

  for (const event of events) {
    if (event.type === 'phase.changed') {
      const data = event.data as Extract<TurnEvent, { type: 'phase.changed' }>['data']
      phase = data.phase
    }
  }

  return phase
}

/**
 * Fold running state from events
 */
export function foldIsRunning(events: EventLike[]): boolean {
  let isRunning = false

  for (const event of events) {
    if (event.type === 'running.changed') {
      const data = event.data as Extract<TurnEvent, { type: 'running.changed' }>['data']
      isRunning = data.isRunning
    }
  }

  return isRunning
}

/**
 * Fold full session state from events
 */
export function foldSessionState(events: EventLike[], initialWindowId: string): FoldedSessionState {
  const mode = foldMode(events)
  const phase = foldPhase(events)
  const isRunning = foldIsRunning(events)
  const messages = foldTurnEventsToSnapshotMessages(events)
  const criteria = foldCriteria(events)
  const todos = foldTodos(events)
  const contextResult = foldContextState(events, initialWindowId)

  // Use real promptTokens from latest context.state event if available
  // This is the accurate value from the LLM, not an estimate
  const baseContextState = contextResult.latestContextState ?? {
    currentTokens: 0,
    maxTokens: 200000, // TODO: Get from config
    compactionCount: contextResult.compactionCount,
    dangerZone: false,
    canCompact: false,
  }

  // Ensure compactionCount is up-to-date from events (in case compaction happened after last context.state)
  const contextState: ContextState = baseContextState.compactionCount !== contextResult.compactionCount
    ? { ...baseContextState, compactionCount: contextResult.compactionCount }
    : baseContextState

  return {
    mode,
    phase,
    isRunning,
    messages,
    criteria,
    todos,
    contextState,
    currentContextWindowId: contextResult.currentContextWindowId,
    readFiles: contextResult.readFiles,
  }
}

// ============================================================================
// Snapshot Building
// ============================================================================

/**
 * Build a snapshot from folded session state
 */
export function buildSnapshot(
  foldedState: FoldedSessionState,
  latestSeq: number,
  snapshotAt: number = Date.now()
): SessionSnapshot {
  return {
    mode: foldedState.mode,
    phase: foldedState.phase,
    isRunning: foldedState.isRunning,
    messages: foldedState.messages,
    criteria: foldedState.criteria,
    contextState: foldedState.contextState,
    currentContextWindowId: foldedState.currentContextWindowId,
    todos: foldedState.todos,
    readFiles: foldedState.readFiles,
    snapshotSeq: latestSeq,
    snapshotAt,
  }
}

/**
 * Legacy compatibility wrapper - builds snapshot from session state object.
 * @deprecated Use foldSessionState + buildSnapshot instead
 */
interface LegacySessionState {
  mode: SessionMode
  phase: SessionPhase
  isRunning: boolean
  criteria: Criterion[]
  executionState?: { currentTokenCount?: number; compactionCount?: number } | null
}

export function buildSnapshotFromSessionState(input: {
  session: LegacySessionState
  events: EventLike[]
  latestSeq: number
  snapshotAt?: number
}): SessionSnapshot {
  const { session, events, latestSeq, snapshotAt = Date.now() } = input

  // Get initial context window ID from session.initialized event or generate one
  let initialWindowId = ''
  for (const event of events) {
    if (event.type === 'session.initialized') {
      const data = event.data as Extract<TurnEvent, { type: 'session.initialized' }>['data']
      initialWindowId = data.contextWindowId
      break
    }
  }
  if (!initialWindowId) {
    initialWindowId = 'legacy-window-1'
  }

  const foldedState = foldSessionState(events, initialWindowId)

  // Override with legacy session values where provided
  return {
    mode: session.mode,
    phase: session.phase,
    isRunning: session.isRunning,
    messages: foldedState.messages,
    criteria: session.criteria,
    contextState: {
      currentTokens: session.executionState?.currentTokenCount ?? foldedState.contextState.currentTokens,
      maxTokens: 200000,
      compactionCount: session.executionState?.compactionCount ?? foldedState.contextState.compactionCount,
      dangerZone: foldedState.contextState.dangerZone,
      canCompact: foldedState.contextState.canCompact,
    },
    currentContextWindowId: foldedState.currentContextWindowId,
    todos: foldedState.todos,
    readFiles: foldedState.readFiles,
    snapshotSeq: latestSeq,
    snapshotAt,
  }
}

/**
 * Get messages for a specific context window
 */
export function getMessagesForWindow(
  messages: SnapshotMessage[],
  windowId: string
): SnapshotMessage[] {
  return messages.filter((m) => m.contextWindowId === windowId)
}

/**
 * Build context messages for LLM from messages in current window
 */
export function buildContextMessagesFromMessages(
  messages: SnapshotMessage[],
  windowId: string
): ContextMessage[] {
  const windowMessages = getMessagesForWindow(messages, windowId)
  const result: ContextMessage[] = []

  for (const msg of windowMessages) {
    if (msg.role === 'system') continue

    const contextMsg: ContextMessage = {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      contextMsg.toolCalls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }))
    }

    result.push(contextMsg)

    // Add tool results as separate tool messages
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.result) {
          result.push({
            role: 'tool',
            content: tc.result.success
              ? (tc.result.output ?? 'Success')
              : `Error: ${tc.result.error}`,
            toolCallId: tc.id,
          })
        }
      }
    }
  }

  return result
}
