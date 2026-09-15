import type { Criterion, SessionMode, SessionPhase, ContextState, Todo } from '../../shared/types.js'
import { resolveDefaultAgentId } from '../agents/registry.js'
import type {
  TurnEvent,
  ReadFileEntry,
  PendingPathConfirmation,
  VisionFallback,
  PendingUserInput,
  TaskStats,
  MessageStatsEntry,
  CompactionRecord,
} from './types.js'
import type { FormatRetry } from './apply-events.js'
import type { WorkflowWaitingPayload } from '../../shared/protocol.js'
import type { EventLike, FoldedSessionState } from './fold-types.js'
import type { MessageStats, MetadataEntry } from '../../shared/types.js'
import { foldTurnEventsToMessages } from './fold-messages.js'
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
  defaultMode?: SessionMode,
): FoldedSessionState {
  const mode = foldMode(events, defaultMode)
  const phase = foldPhase(events)
  const isRunning = foldIsRunning(events)
  const messages = foldTurnEventsToMessages(events)
  const criteria = foldCriteria(events)
  const todos = foldTodos(events)
  const metadataEntries = foldMetadata(events)
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
