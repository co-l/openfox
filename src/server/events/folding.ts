/**
 * Event Folding Functions
 *
 * Pure functions that reconstruct state from events.
 * All state is derived from events - no external data sources.
 */

import type {
  Message,
  Criterion,
  SessionMode,
  SessionPhase,
  ContextState,
  Todo,
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

function cloneMessage(message: Message): Message {
  return {
    ...message,
    ...(message.attachments ? { attachments: [...message.attachments] } : {}),
    ...(message.toolCalls ? {
      toolCalls: message.toolCalls.map((toolCall) => ({
        ...toolCall,
        ...(toolCall.streamingOutput ? { streamingOutput: [...toolCall.streamingOutput] } : {}),
        ...(toolCall.result ? { result: { ...toolCall.result } } : {}),
      })),
    } : {}),
    ...(message.segments ? { segments: [...message.segments] } : {}),
    ...(message.preparingToolCalls ? { preparingToolCalls: [...message.preparingToolCalls] } : {}),
  }
}

function snapshotMessageToMessage(message: SnapshotMessage): Message {
  return cloneMessage({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: new Date(message.timestamp).toISOString(),
    ...(message.tokenCount !== undefined && { tokenCount: message.tokenCount }),
    ...(message.isStreaming !== undefined && { isStreaming: message.isStreaming }),
    ...(message.contextWindowId !== undefined && { contextWindowId: message.contextWindowId }),
    ...(message.subAgentId !== undefined && { subAgentId: message.subAgentId }),
    ...(message.subAgentType !== undefined && { subAgentType: message.subAgentType }),
    ...(message.isSystemGenerated !== undefined && { isSystemGenerated: message.isSystemGenerated }),
    ...(message.messageKind !== undefined && { messageKind: message.messageKind }),
    ...(message.isCompactionSummary !== undefined && { isCompactionSummary: message.isCompactionSummary }),
    ...(message.attachments !== undefined && { attachments: message.attachments }),
    ...(message.thinkingContent !== undefined && { thinkingContent: message.thinkingContent }),
    ...(message.toolCalls !== undefined && { toolCalls: message.toolCalls }),
    ...(message.segments !== undefined && { segments: message.segments }),
    ...(message.stats !== undefined && { stats: message.stats }),
    ...(message.partial !== undefined && { partial: message.partial }),
    ...(message.promptContext !== undefined && { promptContext: message.promptContext }),
    ...(message.metadata !== undefined && { metadata: message.metadata }),
  })
}

function shouldIncludeContextMessage(
  message: Pick<SnapshotMessage, 'role' | 'contextWindowId' | 'subAgentType'>,
  windowId?: string,
  options?: ContextMessageBuildOptions,
): boolean {
  const includeVerifier = options?.includeVerifier ?? true

  return message.role !== 'system'
    && (windowId === undefined || message.contextWindowId === windowId)
    && (includeVerifier || message.subAgentType !== 'verifier')
}

function appendSnapshotMessageContext(
  result: ContextMessage[],
  message: SnapshotMessage,
): void {
  const contextMsg: ContextMessage = {
    role: message.role as 'user' | 'assistant',
    content: message.content,
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    contextMsg.toolCalls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    }))
  }

  if (message.attachments !== undefined) {
    contextMsg.attachments = message.attachments
  }

  result.push(contextMsg)

  if (!message.toolCalls) {
    return
  }

  for (const toolCall of message.toolCalls) {
    if (!toolCall.result) {
      continue
    }

    result.push({
      role: 'tool',
      content: toolCall.result.success
        ? (toolCall.result.output ?? 'Success')
        : toolCall.result.output
          ? `${toolCall.result.output}\n\nError: ${toolCall.result.error}`
          : `Error: ${toolCall.result.error}`,
      toolCallId: toolCall.id,
    })
  }
}

function applyStoredMessageEvents(initialMessages: Message[], events: StoredEvent[]): Message[] {
  const messages = new Map(initialMessages.map((message) => [message.id, cloneMessage(message)]))

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
          ...(data.metadata !== undefined && { metadata: data.metadata }),
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
          const existingToolCalls = msg.toolCalls ?? []
          msg.toolCalls = [...existingToolCalls, data.toolCall]
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

function cloneSnapshotMessage(message: SnapshotMessage): SnapshotMessage {
  return {
    ...message,
    ...(message.attachments ? { attachments: [...message.attachments] } : {}),
    ...(message.toolCalls ? {
      toolCalls: message.toolCalls.map((toolCall) => ({
        ...toolCall,
        ...(toolCall.streamingOutput ? { streamingOutput: [...toolCall.streamingOutput] } : {}),
        ...(toolCall.result ? { result: { ...toolCall.result } } : {}),
      })),
    } : {}),
    ...(message.segments ? { segments: [...message.segments] } : {}),
  }
}

function applyTurnEventsToSnapshotMessages(
  initialMessages: SnapshotMessage[],
  events: EventLike[]
): SnapshotMessage[] {
  const messages = new Map(initialMessages.map((message) => [message.id, cloneSnapshotMessage(message)]))

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
        if (data.metadata !== undefined) msg.metadata = data.metadata
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
          const toolCalls = msg.toolCalls ?? []
          msg.toolCalls = [...toolCalls, data.toolCall as ToolCallWithResult]
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
  lastModeWithReminder?: SessionMode
  pendingConfirmations: PendingPathConfirmation[]
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
  // Check if there's a snapshot - if so, use the latest one and replay newer events
  const snapshotEvent = [...events].reverse().find((event) => event.type === 'turn.snapshot')
  if (snapshotEvent) {
    const snapshot = snapshotEvent.data as import('./types.js').SessionSnapshot
    const snapshotMessages = snapshot.messages.map(snapshotMessageToMessage)
    const laterEvents = events.filter((event) => event.seq > snapshotEvent.seq)
    return applyStoredMessageEvents(snapshotMessages, laterEvents)
  }

  // Fallback: build from individual message events (for sessions without snapshots)
  return applyStoredMessageEvents([], events)
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
          const imageMeta = data.result.metadata as { mimeType?: string; dataUrl?: string; path?: string; size?: number } | undefined
          const msg: ContextMessage & { id: string } = {
            id: `tool-${data.toolCallId}`,
            role: 'tool',
            content: data.result.success
              ? (data.result.output ?? 'Success')
              : data.result.output
                ? `${data.result.output}\n\nError: ${data.result.error}`
                : `Error: ${data.result.error}`,
            toolCallId: data.toolCallId,
          }
          if (imageMeta?.dataUrl && imageMeta?.mimeType?.startsWith('image/')) {
            msg.attachments = [{
              id: crypto.randomUUID(),
              filename: imageMeta.path ?? 'image',
              mimeType: imageMeta.mimeType as Attachment['mimeType'],
              size: imageMeta.size ?? 0,
              data: imageMeta.dataUrl,
            }]
          }
          messages.push(msg)
        }
        break
      }
    }
  }

  return messages.map(({ id: _id, ...message }) => message)
}

export function buildContextMessagesFromEventHistory(
  events: StoredEvent[],
  windowId?: string,
  options?: ContextMessageBuildOptions,
): ContextMessage[] {
  const snapshotEvent = [...events].reverse().find((event) => event.type === 'turn.snapshot')
  if (!snapshotEvent) {
    return buildContextMessagesFromStoredEvents(events, windowId, options)
  }

  const snapshot = snapshotEvent.data as SessionSnapshot
  const snapshotMessages = snapshot.messages.reduce<ContextMessage[]>((result, message) => {
    if (!shouldIncludeContextMessage(message, windowId, options)) {
      return result
    }

    appendSnapshotMessageContext(result, message)
    return result
  }, [])
  const laterEvents = events.filter((event) => event.seq > snapshotEvent.seq)

  return [
    ...snapshotMessages,
    ...buildContextMessagesFromStoredEvents(laterEvents, windowId, options),
  ]
}

/**
 * Fold events into SnapshotMessage[] for snapshots
 */
export function foldTurnEventsToSnapshotMessages(events: EventLike[]): SnapshotMessage[] {
  return applyTurnEventsToSnapshotMessages([], events)
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
 * Note: maxTokens is NOT stored in events - it comes from the current model config
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
      case 'turn.snapshot': {
        const data = event.data as SessionSnapshot
        currentContextWindowId = data.currentContextWindowId
        compactionCount = data.contextState.compactionCount
        latestContextState = data.contextState
        readFilesMap.clear()
        for (const entry of data.readFiles) {
          readFilesMap.set(entry.path, { ...entry })
        }
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
 * Pending path confirmation for folding
 */
export interface PendingPathConfirmation {
  callId: string
  tool: string
  paths: string[]
  workdir: string
  reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command'
}

/**
 * Fold pending path confirmations from events
 */
export function foldPendingConfirmations(events: EventLike[]): PendingPathConfirmation[] {
  const pending: PendingPathConfirmation[] = []
  const responded = new Set<string>()

  for (const event of events) {
    if (event.type === 'path.confirmation_responded') {
      const data = event.data as { callId: string }
      responded.add(data.callId)
    }
  }

  for (const event of events) {
    if (event.type === 'path.confirmation_pending') {
      const data = event.data as {
        callId: string
        tool: string
        paths: string[]
        workdir: string
        reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command'
      }
      if (!responded.has(data.callId)) {
        pending.push({
          callId: data.callId,
          tool: data.tool,
          paths: data.paths,
          workdir: data.workdir,
          reason: data.reason,
        })
      }
    }
  }

  return pending
}

/**
 * Fold full session state from events
 * maxTokens is passed in from caller (should come from providerManager.getCurrentModelContext())
 */
export function foldSessionState(
  events: EventLike[],
  initialWindowId: string,
  maxTokens: number
): FoldedSessionState {
  const mode = foldMode(events)
  const phase = foldPhase(events)
  const isRunning = foldIsRunning(events)
  const messages = foldTurnEventsToSnapshotMessages(events)
  const criteria = foldCriteria(events)
  const todos = foldTodos(events)
  const contextResult = foldContextState(events, initialWindowId)
  const pendingConfirmations = foldPendingConfirmations(events)

  // Use real promptTokens from latest context.state event if available
  // This is the accurate value from the LLM, not an estimate
  const baseContextState = contextResult.latestContextState ?? {
    currentTokens: 0,
    maxTokens,
    compactionCount: contextResult.compactionCount,
    dangerZone: false,
    canCompact: false,
  }

  // Ensure compactionCount is up-to-date from events (in case compaction happened after last context.state)
  // Also ensure maxTokens is always from the parameter (current model config), not from cached event data
  const contextState: ContextState = baseContextState.compactionCount !== contextResult.compactionCount || baseContextState.maxTokens !== maxTokens
    ? { ...baseContextState, compactionCount: contextResult.compactionCount, maxTokens }
    : { ...baseContextState, maxTokens }

  // Find last mode with reminder
  // Priority: 1) snapshot.lastModeWithReminder field, 2) snapshot messages array, 3) message.start events
  let lastModeWithReminder: SessionMode | undefined
  
  // First, check the latest snapshot event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'turn.snapshot') {
      const snapshotData = event.data as SessionSnapshot
      // First check the lastModeWithReminder field
      if (snapshotData.lastModeWithReminder) {
        lastModeWithReminder = snapshotData.lastModeWithReminder
        break
      }
      // If not in field, check snapshot messages array (for cases where field wasn't set)
      for (let j = snapshotData.messages.length - 1; j >= 0; j--) {
        const msg = snapshotData.messages[j]!
        if (msg.role === 'user' && msg.messageKind === 'auto-prompt' && msg.content?.includes('<system-reminder>')) {
          if (msg.content.includes('Plan Mode')) {
            lastModeWithReminder = 'planner'
          } else if (msg.content.includes('Build Mode')) {
            lastModeWithReminder = 'builder'
          }
          break
        }
      }
      if (lastModeWithReminder) break
    }
  }
  
  // If not found in snapshot, fall back to scanning message.start events
  if (lastModeWithReminder === undefined) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!
      if (event.type === 'message.start') {
        const data = event.data as { role?: string; messageKind?: string; content?: string }
        if (data.role === 'user' && data.messageKind === 'auto-prompt' && data.content?.includes('<system-reminder>')) {
          if (data.content.includes('Plan Mode')) {
            lastModeWithReminder = 'planner'
          } else if (data.content.includes('Build Mode')) {
            lastModeWithReminder = 'builder'
          }
          break
        }
      }
    }
  }

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
    ...(lastModeWithReminder !== undefined && { lastModeWithReminder }),
    pendingConfirmations,
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
    ...(foldedState.lastModeWithReminder !== undefined && { lastModeWithReminder: foldedState.lastModeWithReminder }),
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

/**
 * Strip the `messages` array from `promptContext` on all but the last assistant message.
 * Each promptContext.messages contains the full conversation history at that turn,
 * so storing it on every message causes O(n²) snapshot growth.
 * Mutates the array in place.
 */
function stripPromptContextMessages(messages: SnapshotMessage[]): void {
  // Find the last assistant message with promptContext
  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (msg.role === 'assistant' && msg.promptContext) {
      lastAssistantIdx = i
      break
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue
    const pc = msg.promptContext
    if (pc && i !== lastAssistantIdx) {
      // Keep everything except the heavy messages array
      const { messages: _msgs, ...rest } = pc
      msg.promptContext = { ...rest, messages: [] }
    }
  }
}

export function buildSnapshotFromSessionState(input: {
  session: LegacySessionState
  events: EventLike[]
  latestSeq: number
  snapshotAt?: number
  maxTokens?: number
}): SessionSnapshot {
  const { session, events, latestSeq, snapshotAt = Date.now(), maxTokens = 200000 } = input

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

  const foldedState = foldSessionState(events, initialWindowId, maxTokens)
  const latestSnapshotIndex = events.map((event) => event.type).lastIndexOf('turn.snapshot')
  const latestSnapshotEvent = latestSnapshotIndex >= 0 ? events[latestSnapshotIndex] : undefined
  const messages = latestSnapshotEvent
    ? applyTurnEventsToSnapshotMessages(
        (latestSnapshotEvent.data as SessionSnapshot).messages,
        events.slice(latestSnapshotIndex + 1),
      )
    : foldedState.messages

  // Strip the conversation history from promptContext on older messages.
  // Each promptContext.messages duplicates the full conversation up to that turn,
  // causing O(n²) growth. We keep the lightweight metadata (systemPrompt, tools,
  // injectedFiles, requestOptions, userMessage) for the Prompt Inspector UI.
  stripPromptContextMessages(messages)

  // Override with legacy session values where provided
  return {
    mode: session.mode,
    phase: session.phase,
    isRunning: session.isRunning,
    messages,
    criteria: session.criteria,
    contextState: {
      currentTokens: session.executionState?.currentTokenCount ?? foldedState.contextState.currentTokens,
      maxTokens: foldedState.contextState.maxTokens,
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
  return getMessagesForWindow(messages, windowId).reduce<ContextMessage[]>((result, message) => {
    if (!shouldIncludeContextMessage(message, windowId)) {
      return result
    }

    appendSnapshotMessageContext(result, message)
    return result
  }, [])
}
