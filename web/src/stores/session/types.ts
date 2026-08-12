import type {
  Session,
  SessionSummary,
  SessionMode,
  Criterion,
  Todo,
  Message,
  ContextState,
  Attachment,
  WorkflowLaunchScope,
  WorkflowExecution,
} from '@shared/types.js'
import type { ServerMessage, QueuedMessage, ChoiceOption } from '@shared/protocol.js'
import type { ConnectionStatus } from '../../lib/ws'

export interface PendingPathConfirmation {
  callId: string
  tool: string
  paths: string[]
  workdir: string
  reason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command' | 'git_no_verify'
  alwaysAllow?: boolean
}

export interface PendingQuestion {
  callId: string
  question: string
  type: 'text' | 'confirm' | 'choice'
  options: ChoiceOption[] | undefined
}

/** Live status of an LLM failure: backing off before a retry, or the window exhausted. */
export type LLMRetryState =
  { status: 'retrying'; attempt: number; retryInMs: number } | { status: 'failed'; error: string }

export interface StreamingBuffer {
  messageId: string | null
  deltaContent: string
  thinkingContent: string
  toolOutput: { messageId: string; callId: string; stream: 'stdout' | 'stderr'; content: string }[]
}

export type GitStatus = {
  branch: string | null
  diff: {
    files: { path: string; status: 'modified' | 'added' | 'deleted'; additions: number; deletions: number }[]
  }
} | null

export type VisionFallbackItem = {
  type: 'start' | 'done'
  attachmentId: string
  filename?: string
  description?: string
}

/**
 * Full per-session feed state. The split view holds one of these for every
 * open pane; the single-session view derives the "current" fields from the
 * focused pane.
 */
export interface SessionPane {
  session: Session | null
  messages: Message[]
  hiddenCount: number
  currentTodos: Todo[]
  contextState: ContextState | null
  subAgentContextStates: Record<string, ContextState>
  pendingPathConfirmations: PendingPathConfirmation[]
  pendingQuestions: PendingQuestion[]
  visionFallbackByMessage: Record<string, VisionFallbackItem>
  queuedMessages: QueuedMessage[]
  abortInProgress: boolean
  restoredInput: string | null
  activeWorkflowExecution: WorkflowExecution | null
  gitStatus: GitStatus
  error: { code: string; message: string } | null
  /** Live status of an LLM failure: backing off before a retry, or the window exhausted. */
  llmRetry: LLMRetryState | null
}

export interface SessionState {
  connectionStatus: ConnectionStatus
  showPasswordModal: boolean
  passwordModalRetry: boolean
  sessions: SessionSummary[]
  searchSessions: SessionSummary[] | null
  currentSession: Session | null
  unreadSessionIds: string[]
  messages: Message[]
  hiddenCount: number
  currentTodos: Todo[]
  contextState: ContextState | null
  subAgentContextStates: Record<string, ContextState>
  pendingPathConfirmations: PendingPathConfirmation[]
  crossSessionConfirmations: Record<string, PendingPathConfirmation[]>
  sessionsWithPendingConfirmations: string[]
  gitStatus: GitStatus
  pendingQuestions: PendingQuestion[]
  visionFallbackByMessage: Record<string, VisionFallbackItem>
  queuedMessages: QueuedMessage[]
  abortInProgress: boolean
  restoredInput: string | null
  activeWorkflowExecution: WorkflowExecution | null
  error: { code: string; message: string } | null
  /** Live status of an LLM failure: backing off before a retry, or the window exhausted. */
  llmRetry: LLMRetryState | null
  sessionsHasMore: boolean
  sessionsPaginationLoading: boolean
  pendingSessionCreate: boolean | string
  pendingUpdate: string | null
  panes: Record<string, SessionPane>
  openSessionIds: string[]
  focusedSessionId: string | null
  connect: () => Promise<void>
  reconnect: () => void
  disconnect: () => void
  submitPassword: (password: string) => Promise<void>
  cancelPassword: () => void
  createSession: (projectId: string, title?: string) => Promise<Session | null>
  loadSession: (sessionId: string, force?: boolean) => Promise<void>
  openPane: (sessionId: string, opts?: { focus?: boolean }) => Promise<void>
  closePane: (sessionId: string) => void
  focusPane: (sessionId: string) => void
  reorderPane: (sessionId: string, direction: -1 | 1) => void
  isPaneOpen: (sessionId: string) => boolean
  enterSplitView: (sessionIds: string[], focusId?: string) => Promise<void>
  exitSplitView: () => void
  listSessions: (projectId?: string, limit?: number) => Promise<void>
  listHomeSessions: () => Promise<void>
  ensureFullSessionList: () => Promise<void>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  toggleFavorite: (sessionId: string, isFavorite: boolean) => Promise<boolean>
  deleteAllSessions: (projectId: string) => Promise<boolean>
  loadMoreSessions: (projectId: string) => Promise<void>
  clearSession: () => void
  sendMessage: (
    sessionId: string,
    content: string,
    attachments?: Attachment[],
    opts?: { messageKind?: 'command'; isSystemGenerated?: boolean },
  ) => void
  stopGeneration: (sessionId: string) => void
  continueGeneration: (sessionId: string) => void
  launchWorkflow: (
    sessionId: string,
    content?: string,
    attachments?: Attachment[],
    workflowId?: string,
    subGroup?: string,
    params?: Record<string, string>,
    scope?: WorkflowLaunchScope,
  ) => void
  continueWorkflow: (sessionId: string, choiceId?: string) => void
  /** Interrupt the current LLM-retry backoff wait and retry immediately. */
  retryLLMNow: (sessionId: string) => void
  /** Definitive retry after the LLM retry window is exhausted: re-runs the last
   *  turn (regular chat) or re-launches the blocked workflow step (resume). */
  retryLLM: (sessionId: string) => void
  exitWorkflow: (sessionId: string) => void
  switchMode: (sessionId: string, mode: SessionMode) => void
  switchDangerLevel: (sessionId: string, dangerLevel: 'normal' | 'dangerous') => void
  editCriteria: (sessionId: string, criteria: Criterion[]) => void
  compactContext: (sessionId: string) => void
  setSessionProvider: (sessionId: string, providerId: string, model?: string) => Promise<Session | null>
  updateContextState: (contextState: ContextState) => void
  updateSubAgentContextState: (subAgentId: string, context: ContextState) => void
  clearSubAgentContextState: (subAgentId: string) => void
  confirmPath: (sessionId: string, callId: string, approved: boolean, alwaysAllow?: boolean) => void
  answerQuestion: (sessionId: string, callId: string, answer: string, skip?: boolean) => void
  queueAsap: (sessionId: string, content: string, attachments?: Attachment[], messageKind?: string) => void
  queueCompletion: (sessionId: string, content: string, attachments?: Attachment[], messageKind?: string) => void
  cancelQueued: (sessionId: string, queueId: string) => void
  queueUpdate: (sessionId: string) => void
  triggerPendingUpdate: () => void
  clearError: () => void
  clearRestoredInput: (sessionId?: string | null) => void
  resetPendingSessionCreate: () => void
  handleServerMessage: (message: ServerMessage) => void
}
