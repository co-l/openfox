import type { Message } from '@shared/types.js'
import type {
  ServerMessage,
  SessionStatePayload,
  GitDiffFile,
  SessionListPayload,
  SessionRunningPayload,
  ChatDeltaPayload,
  ChatThinkingPayload,
  ChatToolPreparingPayload,
  ChatToolCallPayload,
  ChatToolOutputPayload,
  ChatToolResultPayload,
  ChatTodoPayload,
  ChatProgressPayload,
  ChatFormatRetryPayload,
  ChatMessagePayload,
  ChatMessageUpdatedPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatPathConfirmationPayload,
  ChatVisionFallbackPayload,
  ModeChangedPayload,
  PhaseChangedPayload,
  CriteriaUpdatedPayload,
  MetadataUpdatedPayload,
  ContextStatePayload,
  QueueStatePayload,
} from '@shared/protocol.js'
import { useDevServerStore } from '../dev-server'
import { useConfigStore } from '../config'
import { useBackgroundProcessesStore } from '../background-processes'
import { playNewMessage } from '../../lib/sound'
import type { AgentType } from '../notifications'
import type { SessionState } from './types'
import { handleGlobalSoundEffects, resolveAgentType } from './sounds'
import { getBuffer, scheduleStreamingFlush, cancelStreamingFlush } from './streamingBuffer'

const triggeredNewMessageSound = new Set<string>()

function isMessageForCurrentSession(message: ServerMessage, currentSessionId: string | null): boolean {
  return currentSessionId !== null && message.sessionId === currentSessionId
}

function isSessionStateForCurrentView(
  message: ServerMessage,
  currentSessionId: string | null,
  pendingSessionCreate: boolean | string,
): boolean {
  return (
    message.id !== undefined ||
    isMessageForCurrentSession(message, currentSessionId) ||
    (pendingSessionCreate === true && message.sessionId !== undefined)
  )
}

function addUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.includes(sessionId) ? unreadSessionIds : [...unreadSessionIds, sessionId]
}

function removeUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.filter((id) => id !== sessionId)
}

function mergeSessionIntoSummary(
  sessions: import('@shared/types.js').SessionSummary[],
  session: import('@shared/types.js').Session,
): import('@shared/types.js').SessionSummary[] {
  const existingSession = sessions.find((candidate) => candidate.id === session.id)
  const messageCount = session.messageCount ?? session.messages.length
  const nextSummary: import('@shared/types.js').SessionSummary = existingSession
    ? {
        ...existingSession,
        projectId: session.projectId,
        workdir: session.workdir,
        mode: session.mode,
        phase: session.phase,
        isRunning: session.isRunning && existingSession.isRunning !== false,
        messageCount,
        criteriaCount: session.criteria.length,
        criteriaCompleted: session.criteria.filter((criterion) => criterion.status.type === 'passed').length,
      }
    : {
        id: session.id,
        projectId: session.projectId,
        workdir: session.workdir,
        mode: session.mode,
        phase: session.phase,
        isRunning: session.isRunning,
        createdAt: '',
        updatedAt: '',
        criteriaCount: session.criteria.length,
        criteriaCompleted: session.criteria.filter((criterion) => criterion.status.type === 'passed').length,
        messageCount,
      }

  return existingSession
    ? sessions.map((candidate) => (candidate.id === session.id ? nextSummary : candidate))
    : [nextSummary, ...sessions]
}

function mergeSessionList(
  incomingSessions: import('@shared/types.js').SessionSummary[],
  existingSessions: import('@shared/types.js').SessionSummary[],
  currentSession: import('@shared/types.js').Session | null,
): import('@shared/types.js').SessionSummary[] {
  return incomingSessions.map((incomingSession) => {
    const currentSessionOverride = currentSession?.id === incomingSession.id ? currentSession : null
    const existingSession = existingSessions.find((candidate) => candidate.id === incomingSession.id)

    return {
      ...incomingSession,
      title: incomingSession.title ?? existingSession?.title,
      mode: currentSessionOverride?.mode ?? existingSession?.mode ?? incomingSession.mode,
      phase: currentSessionOverride?.phase ?? existingSession?.phase ?? incomingSession.phase,
      isRunning: incomingSession.isRunning && existingSession?.isRunning !== false,
      messageCount: incomingSession.messageCount,
      recentUserPrompts: incomingSession.recentUserPrompts,
    }
  })
}

function updateSessionField(
  message: { sessionId?: string },
  set: (fn: (state: SessionState) => Partial<SessionState>) => void,
  get: () => SessionState,
  updater: (session: import('@shared/types.js').SessionSummary) => import('@shared/types.js').SessionSummary,
) {
  const eventSessionId = message.sessionId
  const activeSessionId = get().currentSession?.id
  const isBackgroundSession = eventSessionId && eventSessionId !== activeSessionId

  set((state) => ({
    sessions: state.sessions.map((s) => (s.id === eventSessionId ? updater(s) : s)),
  }))

  if (!isBackgroundSession) {
    const cs = get().currentSession
    if (cs) {
      const updated = updater(cs as unknown as import('@shared/types.js').SessionSummary)
      set(() => ({ currentSession: updated as unknown as import('@shared/types.js').Session }))
    }
  }
}

export function handleServerMessage(
  message: ServerMessage,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
): void {
  const stateSnapshot = get()
  handleGlobalSoundEffects(message, stateSnapshot)

  const activeSessionId = stateSnapshot.currentSession?.id ?? null
  const markBackgroundSessionUnread = () => {
    const eventSessionId = message.sessionId
    if (!eventSessionId || eventSessionId === activeSessionId) {
      return
    }
    set((state) => ({ unreadSessionIds: addUnreadSessionId(state.unreadSessionIds, eventSessionId) }))
  }

  switch (message.type) {
    case 'session.state': {
      const payload = message.payload as SessionStatePayload
      if (!isSessionStateForCurrentView(message, activeSessionId, stateSnapshot.pendingSessionCreate)) {
        break
      }
      cancelStreamingFlush()
      const streamingMsg = payload.messages.find((m) => m.isStreaming) ?? null
      const wasPendingCreate = get().pendingSessionCreate === true

      set({
        currentSession: payload.session,
        sessions: mergeSessionIntoSummary(get().sessions, payload.session),
        unreadSessionIds: removeUnreadSessionId(get().unreadSessionIds, payload.session.id),
        messages: payload.messages,
        streamingMessageId: streamingMsg?.id ?? null,
        streamingMessage: streamingMsg,
        currentTodos: [],
        pendingPathConfirmations: payload.pendingConfirmations ?? [],
        pendingQuestions: payload.pendingQuestions ?? [],
        error: null,
        ...(wasPendingCreate ? { pendingSessionCreate: payload.session.id } : {}),
      })

      if (payload.session.providerId) {
        const configStore = useConfigStore.getState()
        const sessionProvider = configStore.providers.find((p) => p.id === payload.session.providerId)
        if (sessionProvider) {
          configStore.syncFromSession(payload.session.providerId, payload.session.providerModel ?? '')
        }
      }
      break
    }

    case 'session.list': {
      const payload = message.payload as SessionListPayload
      set((state) => ({
        sessions: mergeSessionList(payload.sessions, state.sessions, state.currentSession),
      }))
      break
    }

    case 'session.deleted': {
      const payload = message.payload as { sessionId: string }
      set((state) => ({ unreadSessionIds: removeUnreadSessionId(state.unreadSessionIds, payload.sessionId) }))
      get().listSessions()
      break
    }

    case 'session.deletedAll': {
      get().listSessions()
      break
    }

    case 'session.running': {
      const payload = message.payload as SessionRunningPayload
      updateSessionField(message, set, get, (s) => ({ ...s, isRunning: payload.isRunning }))
      if (!payload.isRunning) {
        set({ abortInProgress: false, queuedMessages: [] })
      }
      if (payload.isRunning) {
        set({ restoredInput: null })
      }
      break
    }

    case 'chat.message': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatMessagePayload

      set((state) => {
        if (state.messages.some((m) => m.id === payload.message.id)) {
          return state
        }

        const isUserMessage = payload.message.role === 'user'

        return {
          messages: [...state.messages, payload.message],
          sessions: state.sessions.map((s) =>
            s.id === message.sessionId && isUserMessage ? { ...s, messageCount: s.messageCount + 1 } : s,
          ),
          streamingMessageId: payload.message.isStreaming ? payload.message.id : state.streamingMessageId,
          streamingMessage: payload.message.isStreaming ? payload.message : state.streamingMessage,
        }
      })
      break
    }

    case 'chat.message_updated': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatMessageUpdatedPayload
      const isEndingStreaming = payload.updates.isStreaming === false && get().streamingMessageId === payload.messageId

      if (isEndingStreaming) {
        cancelStreamingFlush()
      }

      set((state) => {
        const sm = state.streamingMessage

        if (sm && sm.id === payload.messageId) {
          const finalMessage = { ...sm, ...payload.updates }
          return {
            messages: state.messages.map((m) => (m.id === payload.messageId ? finalMessage : m)),
            streamingMessageId: isEndingStreaming ? null : state.streamingMessageId,
            streamingMessage: isEndingStreaming ? null : { ...sm, ...payload.updates },
          }
        }

        return {
          messages: state.messages.map((m) => (m.id === payload.messageId ? { ...m, ...payload.updates } : m)),
          streamingMessageId: isEndingStreaming ? null : state.streamingMessageId,
        }
      })
      break
    }

    case 'chat.delta': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatDeltaPayload
      if (!triggeredNewMessageSound.has(payload.messageId)) {
        triggeredNewMessageSound.add(payload.messageId)
        const agent: AgentType | undefined = payload.subAgentType
          ? 'sub-agent'
          : resolveAgentType(get(), message.sessionId)
        playNewMessage(agent)
      }
      const buf = getBuffer()
      buf.messageId = payload.messageId
      buf.deltaContent += payload.content
      scheduleStreamingFlush()
      break
    }

    case 'chat.thinking': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatThinkingPayload
      const buf = getBuffer()
      buf.messageId = payload.messageId
      buf.thinkingContent += payload.content
      scheduleStreamingFlush()
      break
    }

    case 'chat.tool_preparing': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatToolPreparingPayload

      const sm = get().streamingMessage
      if (!sm || sm.id !== payload.messageId) {
        return
      }

      const existingToolCall = sm.toolCalls?.find((_, idx) => idx === payload.index)
      if (existingToolCall) return

      set((state) => {
        const existing = state.streamingMessage!.preparingToolCalls ?? []
        const existingIndex = existing.findIndex((p) => p.index === payload.index)
        let preparingToolCalls: typeof existing
        if (existingIndex >= 0) {
          preparingToolCalls = existing.map((p, i) =>
            i === existingIndex ? { ...p, arguments: payload.arguments } : p,
          )
        } else {
          preparingToolCalls = [
            ...existing,
            {
              index: payload.index,
              name: payload.name,
              ...(payload.arguments ? { arguments: payload.arguments } : {}),
            },
          ]
        }
        return {
          streamingMessage: {
            ...state.streamingMessage!,
            preparingToolCalls,
          },
        }
      })
      break
    }

    case 'chat.tool_call': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatToolCallPayload

      const applyToolCall = (m: Message): Message => {
        const preparingToolCalls = m.preparingToolCalls?.filter((ptc, idx) => {
          if (ptc.name === payload.tool) {
            const hasEarlierMatch = m.preparingToolCalls?.slice(0, idx).some((p) => p.name === payload.tool)
            return hasEarlierMatch
          }
          return true
        })
        const buf = getBuffer()
        const bufferedOutputs = buf.toolOutput.filter((o) => o.callId === payload.callId)
        if (bufferedOutputs.length > 0) {
          buf.toolOutput = buf.toolOutput.filter((o) => o.callId !== payload.callId)
        }
        return {
          ...m,
          toolCalls: [
            ...(m.toolCalls ?? []),
            {
              id: payload.callId,
              name: payload.tool,
              arguments: payload.args,
              startedAt: Date.now(),
              ...(bufferedOutputs.length > 0
                ? {
                    streamingOutput: bufferedOutputs.map((o) => ({
                      stream: o.stream,
                      content: o.content,
                      timestamp: Date.now(),
                    })),
                  }
                : {}),
            },
          ],
          ...(preparingToolCalls && preparingToolCalls.length > 0
            ? { preparingToolCalls }
            : { preparingToolCalls: undefined }),
        }
      }

      set((state) => {
        const sm = state.streamingMessage
        if (sm && sm.id === payload.messageId) {
          return { streamingMessage: applyToolCall(sm) }
        }
        return {
          messages: state.messages.map((m) => (m.id === payload.messageId ? applyToolCall(m) : m)),
        }
      })
      break
    }

    case 'chat.tool_output': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatToolOutputPayload

      const buf = getBuffer()
      buf.messageId = payload.messageId
      buf.toolOutput.push({
        messageId: payload.messageId,
        callId: payload.callId,
        stream: payload.stream,
        content: payload.output,
      })
      scheduleStreamingFlush()
      break
    }

    case 'chat.tool_result': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatToolResultPayload

      const applyToolResult = (m: Message): Message => {
        const toolCalls = m.toolCalls?.map((tc) => (tc.id === payload.callId ? { ...tc, result: payload.result } : tc))
        return { ...m, toolCalls }
      }

      set((state) => {
        const sm = state.streamingMessage
        if (sm && sm.id === payload.messageId) {
          return { streamingMessage: applyToolResult(sm) }
        }
        return {
          messages: state.messages.map((m) => (m.id === payload.messageId ? applyToolResult(m) : m)),
        }
      })
      break
    }

    case 'chat.vision_fallback': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatVisionFallbackPayload
      set((state) => {
        const key = `${payload.messageId}-${payload.attachmentId}`
        const newByMessage = { ...state.visionFallbackByMessage }
        newByMessage[key] = {
          type: payload.type,
          attachmentId: payload.attachmentId,
          filename: payload.filename,
          description: payload.description,
        }
        return { visionFallbackByMessage: newByMessage }
      })
      break
    }

    case 'chat.todo': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatTodoPayload
      set({ currentTodos: payload.todos })
      break
    }

    case 'chat.progress': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatProgressPayload
      console.warn('Progress:', payload.message, payload.phase)
      break
    }

    case 'chat.format_retry': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatFormatRetryPayload
      console.warn('Format retry:', payload.attempt, '/', payload.maxAttempts)
      break
    }

    case 'chat.done': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      cancelStreamingFlush()
      const buf = getBuffer()
      buf.messageId = null
      buf.deltaContent = ''
      buf.thinkingContent = ''
      buf.toolOutput = []
      triggeredNewMessageSound.delete((message.payload as ChatDonePayload).messageId)

      const payload = message.payload as ChatDonePayload
      const messageStats = payload.stats as Message['stats']

      set((state) => {
        const sm = state.streamingMessage
        const finalMessage =
          sm && sm.id === payload.messageId ? { ...sm, isStreaming: false, stats: messageStats ?? sm.stats } : null

        return {
          messages: state.messages.map((m) =>
            m.id === payload.messageId
              ? (finalMessage ?? {
                  ...m,
                  isStreaming: false,
                  stats: messageStats ?? m.stats,
                  completeReason: payload.reason,
                })
              : m,
          ),
          streamingMessageId: null,
          streamingMessage: null,
          visionFallbackByMessage: {},
        }
      })
      break
    }

    case 'chat.error': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      cancelStreamingFlush()
      const buf = getBuffer()

      const payload = message.payload as ChatErrorPayload
      console.error('Chat error:', payload.error, 'recoverable:', payload.recoverable)
      if (!payload.recoverable) {
        buf.messageId = null
        buf.deltaContent = ''
        buf.thinkingContent = ''
        buf.toolOutput = []
      }
      set((state) => ({
        error: { code: 'CHAT_ERROR', message: payload.error },
        streamingMessageId: payload.recoverable ? state.streamingMessageId : null,
        ...(payload.recoverable
          ? {}
          : {
              messages: state.streamingMessage
                ? state.messages.map((m) => (m.id === state.streamingMessage!.id ? state.streamingMessage! : m))
                : state.messages,
              streamingMessage: null,
            }),
      }))
      break
    }

    case 'chat.path_confirmation': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ChatPathConfirmationPayload
      const newConfirmation = {
        callId: payload.callId,
        tool: payload.tool,
        paths: payload.paths,
        workdir: payload.workdir,
        reason: payload.reason,
      }
      set((state) => ({
        pendingPathConfirmations: [...state.pendingPathConfirmations, newConfirmation],
      }))
      break
    }

    case 'chat.ask_user': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        return
      }
      const payload = message.payload as {
        callId: string
        question: string
        type?: 'text' | 'confirm' | 'choice'
        options?: string[]
      }
      const newQuestion = {
        callId: payload.callId,
        question: payload.question,
        type: payload.type ?? 'text',
        options: payload.options ?? undefined,
      }
      set((state) => ({
        pendingQuestions: [...state.pendingQuestions.filter((q) => q.callId !== payload.callId), newQuestion],
      }))
      break
    }

    case 'mode.changed': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as ModeChangedPayload
      set((state) => ({
        currentSession: state.currentSession ? { ...state.currentSession, mode: payload.mode } : null,
      }))
      break
    }

    case 'phase.changed': {
      const payload = message.payload as PhaseChangedPayload
      updateSessionField(message, set, get, (s) => ({ ...s, phase: payload.phase }))
      break
    }

    case 'criteria.updated': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as CriteriaUpdatedPayload
      set((state) => ({
        currentSession: state.currentSession ? { ...state.currentSession, criteria: payload.criteria } : null,
      }))
      break
    }

    case 'metadata.updated': {
      if (!isMessageForCurrentSession(message, get().currentSession?.id ?? null)) {
        markBackgroundSessionUnread()
        break
      }
      const payload = message.payload as MetadataUpdatedPayload
      set((state) => ({
        currentSession: state.currentSession
          ? {
              ...state.currentSession,
              metadataEntries: {
                ...state.currentSession.metadataEntries,
                [payload.key]: payload.entries,
              },
            }
          : null,
      }))
      break
    }

    case 'context.state': {
      const payload = message.payload as ContextStatePayload
      const isCurrentSession = isMessageForCurrentSession(message, get().currentSession?.id ?? null)

      if (payload.subAgentId) {
        if (isCurrentSession) {
          get().updateSubAgentContextState(payload.subAgentId, payload.context)
        }
      } else {
        if (isCurrentSession) {
          set({ contextState: payload.context })
        } else {
          markBackgroundSessionUnread()
        }
      }
      break
    }

    case 'session.name_generated': {
      const payload = message.payload as { name: string }
      const eventSessionId = message.sessionId
      const activeSessionId = get().currentSession?.id

      set((state) => {
        const updatedSessions = state.sessions.map((s) =>
          s.id === eventSessionId ? { ...s, title: payload.name, updatedAt: new Date().toISOString() } : s,
        )

        const updatedCurrentSession =
          activeSessionId === eventSessionId
            ? state.currentSession
              ? { ...state.currentSession, title: payload.name, updatedAt: new Date().toISOString() }
              : null
            : state.currentSession

        return {
          sessions: updatedSessions,
          currentSession: updatedCurrentSession,
        }
      })
      break
    }

    case 'queue.state': {
      const payload = message.payload as QueueStatePayload
      set({ queuedMessages: payload.messages ?? [] })
      break
    }

    case 'mcp.servers.changed': {
      window.dispatchEvent(new CustomEvent('mcp-servers-changed'))
      break
    }

    case 'git.status': {
      const payload = message.payload as { branch: string | null; diff: { files: GitDiffFile[] } }
      set({ gitStatus: { branch: payload.branch, diff: payload.diff } })
      break
    }

    case 'devServer.output':
    case 'devServer.state': {
      useDevServerStore.getState().handleMessage(message)
      break
    }

    case 'backgroundProcess.started':
    case 'backgroundProcess.output':
    case 'backgroundProcess.exited':
    case 'backgroundProcess.removed': {
      useBackgroundProcessesStore.getState().handleMessage(message.type, message.payload as Record<string, unknown>)
      break
    }

    case 'error': {
      const payload = message.payload as { code: string; message: string }
      console.error('Server error:', payload)
      set({
        error: { code: payload.code, message: payload.message },
        streamingMessageId: null,
      })
      break
    }
  }
}
