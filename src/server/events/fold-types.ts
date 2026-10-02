import type { Attachment } from '../../shared/types.js'
import type {
  StoredEvent,
  ReadFileEntry,
  PendingPathConfirmation,
  VisionFallback,
  PendingUserInput,
  TaskStats,
  MessageStatsEntry,
  CompactionRecord,
  SessionSnapshot,
  SnapshotMessage,
} from './types.js'
import type { SessionMode, SessionPhase, ContextState, Criterion, Todo, MetadataEntry } from '../../shared/types.js'
import type { WorkflowWaitingPayload } from '../../shared/protocol.js'
import type { FormatRetry } from './apply-events.js'

/**
 * Legacy databases contain `turn.snapshot` rows whose payload is a bare number
 * (e.g. "6867259.0") or otherwise not an object. Folds treat such rows as
 * absent rather than throwing.
 */
export function asSessionSnapshot(data: unknown): SessionSnapshot | null {
  return data !== null && typeof data === 'object' ? (data as SessionSnapshot) : null
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinkingContent?: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}

export interface ContextMessageBuildOptions {
  includeVerifier?: boolean
}

export type EventLike = Pick<StoredEvent, 'type' | 'data'> & Partial<Pick<StoredEvent, 'timestamp'>>

export interface MessageWithId {
  id: string
  role: string
  content: string
  thinkingContent?: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}

export interface FoldedSessionState {
  mode: SessionMode
  phase: SessionPhase
  isRunning: boolean
  messages: SnapshotMessage[]
  criteria: Criterion[]
  todos: Todo[]
  metadataEntries: Record<string, MetadataEntry[]>
  contextState: ContextState
  currentContextWindowId: string
  readFiles: ReadFileEntry[]
  cachedSystemPrompt?: string
  dynamicContextHash?: string
  pendingConfirmations: PendingPathConfirmation[]
  sessionInit?: {
    projectId: string
    workdir: string
    contextWindowId: string
    maxTokens?: number
  }
  sessionTitle?: string
  visionFallbacks?: VisionFallback[]
  formatRetries?: FormatRetry[]
  pendingUserInput?: PendingUserInput
  taskStats?: TaskStats
  messageStats?: MessageStatsEntry[]
  contextWindows?: CompactionRecord[]
  waitingWorkflow?: WorkflowWaitingPayload
}
