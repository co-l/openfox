import type {
  Session,
  SessionSummary,
  SessionMode,
  Criterion,
  Todo,
  Message,
  ContextState,
  Attachment,
} from '@shared/types.js'
import type { ServerMessage, QueuedMessage } from '@shared/protocol.js'
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
  options: string[] | undefined
}

export interface StreamingBuffer {
  messageId: string | null
  deltaContent: string
  thinkingContent: string
  toolOutput: { messageId: string; callId: string; stream: 'stdout' | 'stderr'; content: string }[]
}

export interface SessionState {
  connectionStatus: ConnectionStatus
  showPasswordModal: boolean
  passwordModalRetry: boolean
  sessions: SessionSummary[]
  currentSession: Session | null
  unreadSessionIds: string[]
  messages: Message[]
  currentTodos: Todo[]
  contextState: ContextState | null
  subAgentContextStates: Record<string, ContextState>
  pendingPathConfirmations: PendingPathConfirmation[]
  gitStatus: {
    branch: string | null
    diff: { files: { path: string; status: 'modified' | 'added' | 'deleted'; additions: number; deletions: number }[] }
  } | null
  pendingQuestions: PendingQuestion[]
  visionFallbackByMessage: Record<
    string,
    { type: 'start' | 'done'; attachmentId: string; filename?: string; description?: string }
  >
  queuedMessages: QueuedMessage[]
  abortInProgress: boolean
  restoredInput: string | null
  error: { code: string; message: string } | null
  sessionsHasMore: boolean
  sessionsPaginationLoading: boolean
  pendingSessionCreate: boolean | string
  connect: () => Promise<void>
  reconnect: () => void
  disconnect: () => void
  submitPassword: (password: string) => Promise<void>
  cancelPassword: () => void
  createSession: (projectId: string, title?: string, worktree?: string) => Promise<Session | null>
  loadSession: (sessionId: string) => Promise<void>
  listSessions: (projectId?: string, limit?: number) => Promise<void>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  deleteAllSessions: (projectId: string) => Promise<boolean>
  loadMoreSessions: (projectId: string) => Promise<void>
  clearSession: () => void
  sendMessage: (
    content: string,
    attachments?: Attachment[],
    opts?: { messageKind?: 'command'; isSystemGenerated?: boolean },
  ) => void
  stopGeneration: () => void
  continueGeneration: () => void
  launchWorkflow: (content?: string, attachments?: Attachment[], workflowId?: string, subGroup?: string) => void
  switchMode: (mode: SessionMode) => void
  switchDangerLevel: (dangerLevel: 'normal' | 'dangerous') => void
  editCriteria: (criteria: Criterion[]) => void
  compactContext: () => void
  setSessionProvider: (providerId: string, model?: string) => Promise<Session | null>
  updateContextState: (contextState: ContextState) => void
  updateSubAgentContextState: (subAgentId: string, context: ContextState) => void
  clearSubAgentContextState: (subAgentId: string) => void
  confirmPath: (callId: string, approved: boolean, alwaysAllow?: boolean) => void
  answerQuestion: (callId: string, answer: string, skip?: boolean) => void
  queueAsap: (content: string, attachments?: Attachment[], messageKind?: string) => void
  queueCompletion: (content: string, attachments?: Attachment[], messageKind?: string) => void
  cancelQueued: (queueId: string) => void
  clearError: () => void
  clearRestoredInput: () => void
  resetPendingSessionCreate: () => void
  handleServerMessage: (message: ServerMessage) => void
}
