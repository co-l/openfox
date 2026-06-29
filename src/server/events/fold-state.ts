import type { Criterion, SessionMode, SessionPhase, ContextState, Todo } from '../../shared/types.js'
import type {
  TurnEvent,
  SessionSnapshot,
  ReadFileEntry,
  PendingPathConfirmation,
  VisionFallback,
  PendingUserInput,
  TaskStats,
  MessageStatsEntry,
  CompactionRecord,
  SnapshotMessage,
} from './types.js'
import type { FormatRetry } from './apply-events.js'
import type { EventLike, FoldedSessionState } from './fold-types.js'
import type { MessageStats, MetadataEntry } from '../../shared/types.js'
import {
  foldTurnEventsToSnapshotMessages,
  foldTurnEventsToSnapshotMessagesFromInitial,
  applyTurnEventsToSnapshotMessages,
} from './fold-messages.js'

function getTimestamp(event: EventLike): number {
  return event.timestamp ?? Date.now()
}

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
        criteria = criteria.map((c) => (c.id === data.criterionId ? { ...c, status: data.status } : c))
        break
      }
    }
  }
  return criteria
}

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

export function foldMetadata(events: EventLike[]): Record<string, MetadataEntry[]> {
  const metadata: Record<string, MetadataEntry[]> = {}
  for (const event of events) {
    if (event.type === 'metadata.set') {
      const data = event.data as Extract<TurnEvent, { type: 'metadata.set' }>['data']
      metadata[data.key] = data.entries
    }
  }
  return metadata
}

interface ContextFoldResult {
  currentContextWindowId: string
  compactionCount: number
  readFiles: ReadFileEntry[]
  latestContextState: ContextState | null
}

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
        if (data.readFiles) {
          for (const entry of data.readFiles) {
            readFilesMap.set(entry.path, { ...entry })
          }
        }
        break
      }
      case 'context.state': {
        const data = event.data as ContextState & { subAgentId?: string }
        if (!data.subAgentId) {
          latestContextState = data
        }
        break
      }
      case 'context.compacted': {
        const data = event.data as Extract<TurnEvent, { type: 'context.compacted' }>['data']
        currentContextWindowId = data.newWindowId
        compactionCount++
        readFilesMap.clear()
        latestContextState = null
        break
      }
      case 'file.read': {
        const data = event.data as Extract<TurnEvent, { type: 'file.read' }>['data']
        if (data.contextWindowId === currentContextWindowId) {
          readFilesMap.set(data.path, { path: data.path, tokenCount: data.tokenCount })
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

export function foldSessionState(
  events: EventLike[],
  initialWindowId: string,
  maxTokens: number,
  initialMessages?: SnapshotMessage[],
): FoldedSessionState {
  const mode = foldMode(events)
  const phase = foldPhase(events)
  const isRunning = foldIsRunning(events)
  const messages =
    initialMessages && initialMessages.length > 0
      ? foldTurnEventsToSnapshotMessagesFromInitial(events, initialMessages)
      : foldTurnEventsToSnapshotMessages(events)
  const criteria = foldCriteria(events)
  const todos = foldTodos(events)
  let metadataEntries = foldMetadata(events)
  const contextResult = foldContextState(events, initialWindowId)
  const pendingConfirmations = foldPendingConfirmations(events)

  const baseContextState = contextResult.latestContextState ?? {
    currentTokens: 0,
    maxTokens,
    compactionCount: contextResult.compactionCount,
    dangerZone: false,
    canCompact: false,
    dynamicContextChanged: false,
  }
  const contextState: ContextState =
    baseContextState.compactionCount !== contextResult.compactionCount || baseContextState.maxTokens !== maxTokens
      ? { ...baseContextState, compactionCount: contextResult.compactionCount, maxTokens }
      : { ...baseContextState, maxTokens }

  let cachedSystemPrompt: string | undefined
  let dynamicContextHash: string | undefined

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'turn.snapshot') {
      const snapshotData = event.data as SessionSnapshot
      if (snapshotData.cachedSystemPrompt && !cachedSystemPrompt) cachedSystemPrompt = snapshotData.cachedSystemPrompt
      if (snapshotData.dynamicContextHash && !dynamicContextHash) dynamicContextHash = snapshotData.dynamicContextHash
      if (snapshotData.metadataEntries && Object.keys(metadataEntries).length === 0)
        metadataEntries = snapshotData.metadataEntries
    }
  }

  let sessionInit: FoldedSessionState['sessionInit']
  let sessionTitle: string | undefined
  const visionFallbacks: VisionFallback[] = []
  const formatRetries: FormatRetry[] = []
  let pendingUserInput: PendingUserInput | undefined
  let taskStats: TaskStats | undefined
  const messageStats: MessageStatsEntry[] = []
  const contextWindows: CompactionRecord[] = []

  for (const event of events) {
    switch (event.type) {
      case 'session.initialized': {
        const data = event.data as { projectId: string; workdir: string; contextWindowId: string; maxTokens?: number }
        sessionInit = {
          projectId: data.projectId,
          workdir: data.workdir,
          contextWindowId: data.contextWindowId,
          ...(data.maxTokens !== undefined && { maxTokens: data.maxTokens }),
        }
        break
      }
      case 'session.name_generated': {
        const data = event.data as { name: string }
        sessionTitle = data.name
        break
      }
      case 'vision_fallback.start': {
        const data = event.data as { messageId: string; attachmentId: string; filename?: string }
        visionFallbacks.push({
          messageId: data.messageId,
          attachmentId: data.attachmentId,
          ...(data.filename !== undefined && { filename: data.filename }),
          startedAt: getTimestamp(event),
        })
        break
      }
      case 'vision_fallback.done': {
        const data = event.data as { messageId: string; attachmentId: string; description: string }
        const existing = visionFallbacks.find(
          (v) => v.messageId === data.messageId && v.attachmentId === data.attachmentId,
        )
        if (existing) existing.description = data.description
        break
      }
      case 'pattern.retry': {
        const data = event.data as {
          pattern: string
          field: string
          attempt: number
          maxAttempts: number
          matchedContent: string
        }
        formatRetries.push({ attempt: data.attempt, maxAttempts: data.maxAttempts, timestamp: getTimestamp(event) })
        break
      }
      case 'chat.ask_user': {
        const data = event.data as {
          callId: string
          question: string
          type?: 'text' | 'confirm' | 'choice'
          options?: string[]
        }
        pendingUserInput = { callId: data.callId, question: data.question, type: data.type, options: data.options }
        break
      }
      case 'task.completed': {
        const data = event.data as TaskStats
        taskStats = data
        break
      }
      case 'chat.done': {
        const data = event.data as {
          messageId: string
          reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' | 'truncated' | 'step_done'
          stats?: MessageStats
        }
        messageStats.push({
          messageId: data.messageId,
          reason: data.reason,
          ...(data.stats !== undefined && { stats: data.stats }),
        })
        break
      }
      case 'context.compacted': {
        const data = event.data as {
          closedWindowId: string
          newWindowId: string
          beforeTokens: number
          afterTokens: number
          summary: string
        }
        contextWindows.push({ ...data, timestamp: getTimestamp(event) })
        break
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
    metadataEntries,
    contextState,
    currentContextWindowId: contextResult.currentContextWindowId,
    readFiles: contextResult.readFiles,
    ...(cachedSystemPrompt !== undefined && { cachedSystemPrompt }),
    ...(dynamicContextHash !== undefined && { dynamicContextHash }),
    pendingConfirmations,
    ...(sessionInit !== undefined && { sessionInit }),
    ...(sessionTitle !== undefined && { sessionTitle }),
    ...(visionFallbacks.length > 0 && { visionFallbacks }),
    ...(formatRetries.length > 0 && { formatRetries }),
    ...(pendingUserInput !== undefined && { pendingUserInput }),
    ...(taskStats !== undefined && { taskStats }),
    ...(messageStats.length > 0 && { messageStats }),
    ...(contextWindows.length > 0 && { contextWindows }),
  }
}

export function buildSnapshot(
  foldedState: FoldedSessionState,
  latestSeq: number,
  snapshotAt: number = Date.now(),
): SessionSnapshot {
  return {
    mode: foldedState.mode,
    phase: foldedState.phase,
    isRunning: foldedState.isRunning,
    messages: foldedState.messages,
    criteria: foldedState.criteria,
    metadataEntries: foldedState.metadataEntries,
    contextState: foldedState.contextState,
    currentContextWindowId: foldedState.currentContextWindowId,
    todos: foldedState.todos,
    readFiles: foldedState.readFiles,
    ...(foldedState.cachedSystemPrompt !== undefined && { cachedSystemPrompt: foldedState.cachedSystemPrompt }),
    ...(foldedState.dynamicContextHash !== undefined && { dynamicContextHash: foldedState.dynamicContextHash }),
    snapshotSeq: latestSeq,
    snapshotAt,
    ...(foldedState.sessionInit !== undefined && { sessionInit: foldedState.sessionInit }),
    ...(foldedState.sessionTitle !== undefined && { sessionTitle: foldedState.sessionTitle }),
    ...(foldedState.visionFallbacks !== undefined && { visionFallbacks: foldedState.visionFallbacks }),
    ...(foldedState.formatRetries !== undefined && { formatRetries: foldedState.formatRetries }),
    ...(foldedState.pendingUserInput !== undefined && { pendingUserInput: foldedState.pendingUserInput }),
    ...(foldedState.taskStats !== undefined && { taskStats: foldedState.taskStats }),
    ...(foldedState.messageStats !== undefined && { messageStats: foldedState.messageStats }),
    ...(foldedState.pendingConfirmations !== undefined && { pendingConfirmations: foldedState.pendingConfirmations }),
    ...(foldedState.contextWindows !== undefined && { contextWindows: foldedState.contextWindows }),
  }
}

export function buildSnapshotFromSessionState(input: {
  session: {
    mode: SessionMode
    phase: SessionPhase
    isRunning: boolean
    criteria: Criterion[]
    executionState?: { currentTokenCount?: number; compactionCount?: number } | null
  }
  events: EventLike[]
  latestSeq: number
  snapshotAt?: number
  maxTokens?: number
  cachedSystemPrompt?: string
  dynamicContextHash?: string
}): SessionSnapshot {
  const { session, events, latestSeq, snapshotAt = Date.now(), maxTokens = 200000 } = input
  let initialWindowId = ''
  for (const event of events) {
    if (event.type === 'session.initialized') {
      const data = event.data as Extract<TurnEvent, { type: 'session.initialized' }>['data']
      initialWindowId = data.contextWindowId
      break
    }
  }
  if (!initialWindowId) initialWindowId = 'legacy-window-1'

  const foldedState = foldSessionState(events, initialWindowId, maxTokens)
  const latestSnapshotIndex = events.map((event) => event.type).lastIndexOf('turn.snapshot')
  const latestSnapshotEvent = latestSnapshotIndex >= 0 ? events[latestSnapshotIndex] : undefined
  const messages = latestSnapshotEvent
    ? applyTurnEventsToSnapshotMessages(
        (latestSnapshotEvent.data as SessionSnapshot).messages,
        events.slice(latestSnapshotIndex + 1),
      )
    : foldedState.messages

  return {
    mode: session.mode,
    phase: session.phase,
    isRunning: session.isRunning,
    messages,
    criteria: session.criteria,
    metadataEntries: foldedState.metadataEntries,
    contextState: {
      currentTokens: session.executionState?.currentTokenCount ?? foldedState.contextState.currentTokens,
      maxTokens: foldedState.contextState.maxTokens,
      compactionCount: session.executionState?.compactionCount ?? foldedState.contextState.compactionCount,
      dangerZone: foldedState.contextState.dangerZone,
      canCompact: foldedState.contextState.canCompact,
      dynamicContextChanged: foldedState.contextState.dynamicContextChanged,
    },
    currentContextWindowId: foldedState.currentContextWindowId,
    todos: foldedState.todos,
    readFiles: foldedState.readFiles,
    snapshotSeq: latestSeq,
    snapshotAt,
    ...(foldedState.sessionInit !== undefined && { sessionInit: foldedState.sessionInit }),
    ...(input.cachedSystemPrompt !== undefined
      ? { cachedSystemPrompt: input.cachedSystemPrompt }
      : foldedState.cachedSystemPrompt !== undefined
        ? { cachedSystemPrompt: foldedState.cachedSystemPrompt }
        : {}),
    ...(input.dynamicContextHash !== undefined
      ? { dynamicContextHash: input.dynamicContextHash }
      : foldedState.dynamicContextHash !== undefined
        ? { dynamicContextHash: foldedState.dynamicContextHash }
        : {}),
  }
}
