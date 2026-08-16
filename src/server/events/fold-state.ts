import type { Criterion, SessionMode, SessionPhase, ContextState, Todo } from '../../shared/types.js'
import { resolveDefaultAgentId } from '../agents/registry.js'
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
  ToolCallWithResult,
} from './types.js'
import type { FormatRetry } from './apply-events.js'
import type { WorkflowWaitingPayload } from '../../shared/protocol.js'
import type { EventLike, FoldedSessionState } from './fold-types.js'
import type { MessageStats, MetadataEntry } from '../../shared/types.js'
import {
  foldTurnEventsToSnapshotMessages,
  foldTurnEventsToSnapshotMessagesFromInitial,
  applyTurnEventsToSnapshotMessages,
} from './fold-messages.js'
import { normalizeAskOptions } from '../../shared/ask-options.js'

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

function criterionStatusType(status: unknown): string | undefined {
  if (typeof status === 'string') return status
  if (typeof status === 'object' && status !== null && 'type' in status) {
    const type = (status as { type?: unknown }).type
    return typeof type === 'string' ? type : undefined
  }
  return undefined
}

function criterionEmbeddedTimestamp(status: unknown): number | null {
  if (typeof status !== 'object' || status === null) return null
  const typedStatus = status as { type?: unknown; completedAt?: unknown; verifiedAt?: unknown }
  const timestamp = typedStatus.type === 'completed' ? typedStatus.completedAt : typedStatus.verifiedAt
  if (typeof timestamp !== 'string') return null
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? null : parsed
}

function updateProgressFromStatuses(
  statuses: Array<{ id: string; status: unknown }>,
  previous: Map<string, string>,
  timestamp: number,
): number | null {
  let latest: number | null = null
  for (const entry of statuses) {
    const next = criterionStatusType(entry.status)
    if ((next === 'completed' || next === 'passed') && previous.get(entry.id) !== next) {
      latest = Math.max(latest ?? 0, timestamp)
    }
    if (next !== undefined) previous.set(entry.id, next)
  }
  return latest
}

export function foldLastProgressAt(events: EventLike[]): string | null {
  let latest: number | null = null
  const criteria = new Map<string, string>()
  const metadataCriteria = new Map<string, string>()

  for (const event of events) {
    const timestamp = getTimestamp(event)
    let candidate: number | null = null
    switch (event.type) {
      case 'turn.snapshot': {
        const snapshot = event.data as SessionSnapshot
        if (snapshot.lastProgressAt !== undefined && snapshot.lastProgressAt !== null) {
          const parsed = Date.parse(snapshot.lastProgressAt)
          if (!Number.isNaN(parsed)) candidate = parsed
        } else {
          for (const criterion of snapshot.criteria) {
            const type = criterionStatusType(criterion.status)
            if (type === 'completed' || type === 'passed') {
              const parsed = criterionEmbeddedTimestamp(criterion.status)
              if (parsed !== null) candidate = Math.max(candidate ?? 0, parsed)
            }
          }
        }
        for (const criterion of snapshot.criteria) {
          const type = criterionStatusType(criterion.status)
          if (type !== undefined) criteria.set(criterion.id, type)
        }
        for (const entry of snapshot.metadataEntries?.['criteria'] ?? []) {
          const type = criterionStatusType(entry.status)
          if (type !== undefined) metadataCriteria.set(entry.id, type)
        }
        break
      }
      case 'criteria.set': {
        const data = event.data as Extract<TurnEvent, { type: 'criteria.set' }>['data']
        candidate = updateProgressFromStatuses(data.criteria, criteria, timestamp)
        break
      }
      case 'criterion.updated': {
        const data = event.data as Extract<TurnEvent, { type: 'criterion.updated' }>['data']
        candidate = updateProgressFromStatuses([{ id: data.criterionId, status: data.status }], criteria, timestamp)
        break
      }
      case 'metadata.set': {
        const data = event.data as Extract<TurnEvent, { type: 'metadata.set' }>['data']
        if (data.key === 'criteria') candidate = updateProgressFromStatuses(data.entries, metadataCriteria, timestamp)
        break
      }
      case 'chat.done': {
        const data = event.data as Extract<TurnEvent, { type: 'chat.done' }>['data']
        if (data.reason === 'step_done') candidate = timestamp
        break
      }
      case 'workflow.execution_changed': {
        const data = event.data as Extract<TurnEvent, { type: 'workflow.execution_changed' }>['data']
        if (data.status === 'completed') candidate = timestamp
        break
      }
      case 'task.completed':
        candidate = timestamp
        break
    }
    if (candidate !== null) latest = Math.max(latest ?? 0, candidate)
  }

  return latest === null ? null : new Date(latest).toISOString()
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

export function foldMode(events: EventLike[], defaultMode?: SessionMode): SessionMode {
  if (defaultMode === undefined) {
    defaultMode = resolveDefaultAgentId()
  }
  let mode = defaultMode
  for (const event of events) {
    if (event.type === 'mode.changed') {
      const data = event.data as Extract<TurnEvent, { type: 'mode.changed' }>['data']
      mode = data.mode
    } else if (event.type === 'turn.snapshot') {
      const snapshot = event.data as SessionSnapshot
      mode = snapshot.mode
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
  defaultMode?: SessionMode,
): FoldedSessionState {
  const mode = foldMode(events, defaultMode)
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
  const lastProgressAt = foldLastProgressAt(events)

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
  let metadataEntriesMerged = false

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type === 'turn.snapshot') {
      const snapshotData = event.data as SessionSnapshot
      if (snapshotData.cachedSystemPrompt && !cachedSystemPrompt) cachedSystemPrompt = snapshotData.cachedSystemPrompt
      if (snapshotData.dynamicContextHash && !dynamicContextHash) dynamicContextHash = snapshotData.dynamicContextHash
      if (snapshotData.metadataEntries && !metadataEntriesMerged) {
        metadataEntries = { ...snapshotData.metadataEntries, ...metadataEntries }
        metadataEntriesMerged = true
      }
      if (cachedSystemPrompt && dynamicContextHash && metadataEntriesMerged) break
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
          options?: import('../../shared/protocol.js').ChoiceOption[]
        }
        pendingUserInput = {
          callId: data.callId,
          question: data.question,
          type: data.type,
          options: normalizeAskOptions(data.options),
        }
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
    lastProgressAt,
    ...(cachedSystemPrompt !== undefined && { cachedSystemPrompt }),
    ...(dynamicContextHash !== undefined && { dynamicContextHash }),
    pendingConfirmations,
    ...(sessionInit !== undefined && { sessionInit }),
    ...(sessionTitle !== undefined && { sessionTitle }),
    ...(visionFallbacks.length > 0 && { visionFallbacks }),
    ...(formatRetries.length > 0 && { formatRetries }),
    ...(pendingUserInput !== undefined && { pendingUserInput }),
    ...(taskStats !== undefined && { taskStats }),
    ...computeWaitingWorkflow(events),
    ...(messageStats.length > 0 && { messageStats }),
    ...(contextWindows.length > 0 && { contextWindows }),
  }
}

/**
 * Returns { waitingWorkflow: ... } or {} for use with spread in foldSessionState.
 * Handles exactOptionalPropertyTypes correctly.
 */
function computeWaitingWorkflow(
  events: EventLike[],
): { waitingWorkflow: NonNullable<FoldedSessionState['waitingWorkflow']> } | Record<string, never> {
  const ww = foldWaitingWorkflow(events)
  return ww !== undefined ? { waitingWorkflow: ww } : {}
}

/**
 * Fold just the waitingWorkflow from events.
 * Useful for REST endpoints that don't need the full folded state.
 */
export function foldWaitingWorkflow(events: EventLike[]): FoldedSessionState['waitingWorkflow'] {
  let waitingWorkflow: FoldedSessionState['waitingWorkflow']
  for (const event of events) {
    if (event.type === 'workflow.waiting') {
      const data = event.data as WorkflowWaitingPayload
      waitingWorkflow = data
    } else if (event.type === 'task.completed') {
      waitingWorkflow = undefined
    }
  }
  return waitingWorkflow
}

// ============================================================================
// Snapshot streaming de-duplication
//
// A finished tool call's `streamingOutput` (the raw stdout/stderr feed shown
// live in the feed) is NOT reused anywhere once the call has a result:
// - The web UI renders it only while status === 'pending'; finished calls show
//   `result` (RunCommandView, ToolCallDisplay).
// - The LLM context is built exclusively from `result.output`
//   (appendSnapshotMessageContext in fold-messages.ts).
// Persisting it therefore just bloats snapshots (a single session once
// accumulated 41MB of it). We drop it from snapshots for EVERY finished call
// (one that has a result) — unconditionally, no content inspection needed,
// because no consumer ever reads a finished call's stream. Pending (in-flight)
// calls keep their stream in full, without any size cap: a mid-run reload must
// keep showing the live feed, and the raw tool.output events remain the source
// of truth while the session runs.
// ============================================================================

/**
 * Remove streaming output from finished tool calls in snapshot messages.
 * Returns new message objects for modified messages — inputs are not mutated.
 */
export function trimSnapshotStreamingOutput(messages: SnapshotMessage[]): {
  messages: SnapshotMessage[]
  droppedStreams: number
  keptStreams: number
} {
  let droppedStreams = 0
  let keptStreams = 0
  const trimmedMessages = messages.map((message) => {
    const toolCalls = message.toolCalls
    if (!toolCalls) return message
    let changed = false
    const newToolCalls = toolCalls.map((tc) => {
      if (!tc.streamingOutput || tc.streamingOutput.length === 0) return tc
      // Finished calls (with a result): the stream is dead weight — the feed
      // shows `result`, and the LLM context never included it.
      if (tc.result !== undefined) {
        droppedStreams++
        changed = true
        const { streamingOutput: _omitted, streamingOutputTruncated: _omittedFlag, ...rest } = tc
        void _omitted
        void _omittedFlag
        return rest as ToolCallWithResult
      }
      // Pending call: keep the live stream so a mid-run reload keeps showing it.
      keptStreams++
      return tc
    })
    if (!changed) return message
    return { ...message, toolCalls: newToolCalls }
  })
  return { messages: trimmedMessages, droppedStreams, keptStreams }
}

export function buildSnapshot(
  foldedState: FoldedSessionState,
  latestSeq: number,
  snapshotAt: number = Date.now(),
): SessionSnapshot {
  // The snapshot is the hot path loaded on every session open — de-duplicate
  // the never-displayed streaming output before persisting it. The function
  // returns new objects for any modified messages so foldedState is not mutated.
  const { messages } = trimSnapshotStreamingOutput(foldedState.messages)
  return {
    mode: foldedState.mode,
    phase: foldedState.phase,
    isRunning: foldedState.isRunning,
    messages,
    criteria: foldedState.criteria,
    metadataEntries: foldedState.metadataEntries,
    contextState: foldedState.contextState,
    currentContextWindowId: foldedState.currentContextWindowId,
    todos: foldedState.todos,
    readFiles: foldedState.readFiles,
    ...(foldedState.cachedSystemPrompt !== undefined && { cachedSystemPrompt: foldedState.cachedSystemPrompt }),
    ...(foldedState.dynamicContextHash !== undefined && { dynamicContextHash: foldedState.dynamicContextHash }),
    lastProgressAt: foldedState.lastProgressAt,
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
    ...(foldedState.waitingWorkflow !== undefined && { waitingWorkflow: foldedState.waitingWorkflow }),
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
  // The snapshot is the hot path loaded on every session open — de-duplicate
  // the never-displayed streaming output before persisting it. The function
  // returns new objects for modified messages so the source arrays are not mutated.
  const { messages: trimmedMessages } = trimSnapshotStreamingOutput(messages)

  return {
    mode: session.mode,
    phase: session.phase,
    isRunning: session.isRunning,
    messages: trimmedMessages,
    criteria: session.criteria,
    metadataEntries: foldedState.metadataEntries,
    contextState: {
      currentTokens: foldedState.contextState.currentTokens,
      maxTokens: foldedState.contextState.maxTokens,
      compactionCount: foldedState.contextState.compactionCount,
      dangerZone: foldedState.contextState.dangerZone,
      canCompact: foldedState.contextState.canCompact,
      dynamicContextChanged: foldedState.contextState.dynamicContextChanged,
    },
    currentContextWindowId: foldedState.currentContextWindowId,
    todos: foldedState.todos,
    readFiles: foldedState.readFiles,
    lastProgressAt: foldedState.lastProgressAt,
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
    ...(foldedState.waitingWorkflow !== undefined && { waitingWorkflow: foldedState.waitingWorkflow }),
  }
}
