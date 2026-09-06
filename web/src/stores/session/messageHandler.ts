import type { Message } from '@shared/types.js'
import type {
  ServerMessage,
  SessionStatePayload,
  GitDiffFile,
  SessionListPayload,
  SessionRunningPayload,
  WorkflowAutoLaunchPayload,
  ChatAskUserPayload,
  ChatAutoAnswerPayload,
  ChatDeltaPayload,
  ChatThinkingPayload,
  ChatToolPreparingPayload,
  ChatToolCallPayload,
  ChatToolOutputPayload,
  ChatToolResultPayload,
  ChatTodoPayload,
  ChatMessagePayload,
  ChatMessageUpdatedPayload,
  ChatStatsPayload,
  ChatLLMRetryPayload,
  ChatLLMRetryFailedPayload,
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
  SessionCreatedPayload,
} from '@shared/protocol.js'
import { useDevServerStore } from '../dev-server'
import { useBackgroundProcessesStore } from '../background-processes'
import { useTasksStore } from '../tasks'
import { playNewMessage } from '../../lib/sound'
import type { AgentType } from '../notifications'
import type { SessionState, PendingQuestion, SessionPane } from './types'
import { handleGlobalSoundEffects, resolveAgentType } from './sounds'
import { getBuffer, scheduleStreamingFlush, cancelStreamingFlush } from './streamingBuffer'
import { mcpServersResource, type McpServerInfo } from '../../lib/resources'
import {
  emptyPane,
  paneFromFlat,
  effectiveFocusedId,
  isLivePane,
  replacePane,
  updatePane,
  updatePaneSession,
  resolveSessionProjectId,
} from './panes'

const triggeredNewMessageSound = new Set<string>()

function addUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.includes(sessionId) ? unreadSessionIds : [...unreadSessionIds, sessionId]
}

function removeUnreadSessionId(unreadSessionIds: string[], sessionId: string): string[] {
  return unreadSessionIds.filter((id) => id !== sessionId)
}

function clearsLiveTurnStats(payload: ChatDonePayload): boolean {
  // Sub-agent completions and waiting_for_user are mid-turn pauses: the live
  // stats stay accurate and resume streaming once the turn continues.
  return payload.agentType !== 'sub-agent' && payload.reason !== 'waiting_for_user'
}

function markBackgroundSessionUnread(
  set: (fn: (state: SessionState) => Partial<SessionState>) => void,
  message: ServerMessage,
) {
  const eventSessionId = message.sessionId
  if (!eventSessionId) return
  set((state) => ({ unreadSessionIds: addUnreadSessionId(state.unreadSessionIds, eventSessionId) }))
}

function mergeSessionIntoSummary(
  sessions: import('@shared/types.js').SessionSummary[],
  session: import('@shared/types.js').Session,
): import('@shared/types.js').SessionSummary[] {
  const existingSession = sessions.find((candidate) => candidate.id === session.id)
  const messageCount = session.messageCount ?? 0
  const nextSummary: import('@shared/types.js').SessionSummary = existingSession
    ? {
        ...existingSession,
        projectId: session.projectId,
        workdir: session.workdir,
        workspace: session.workspace,
        branch: session.branch,
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
        workspace: session.workspace,
        branch: session.branch,
        mode: session.mode,
        phase: session.phase,
        isRunning: session.isRunning,
        isFavorite: false,
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

function dedupeByCallId<T extends { callId: string }>(list: T[], item: T): T[] {
  const existingIndex = list.findIndex((x) => x.callId === item.callId)
  if (existingIndex >= 0) {
    const updated = [...list]
    updated[existingIndex] = item
    return updated
  }
  return [...list, item]
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
  if (!eventSessionId) return
  const state = get()
  const live = isLivePane(state, eventSessionId)

  set((s) => {
    let next: SessionState = {
      ...s,
      sessions: s.sessions.map((ses) => (ses.id === eventSessionId ? updater(ses) : ses)),
    }
    if (live) {
      next = updatePaneSession(next, eventSessionId, (session) => {
        const patched = updater(session as unknown as import('@shared/types.js').SessionSummary)
        return { ...session, ...patched }
      })
    }
    return next
  })
}

/** Apply a chat-feed mutation to the session's pane (mirrored to flat when focused). */
function applyChat(
  set: (fn: (state: SessionState) => Partial<SessionState> | SessionState) => void,
  get: () => SessionState,
  sessionId: string | undefined,
  updater: (pane: SessionPane) => SessionPane,
): boolean {
  if (!sessionId) return false
  const state = get()
  if (!isLivePane(state, sessionId)) return false
  set((s) => updatePane(s, sessionId, updater))
  return true
}

/**
 * Drop the "waiting to retry" pill once a retried LLM attempt actually
 * streams. Stream activity means the backoff is over — the pill would
 * otherwise linger until the whole turn ends.
 */
function dismissRetryPill(
  set: (fn: (state: SessionState) => Partial<SessionState> | SessionState) => void,
  get: () => SessionState,
  sessionId: string | undefined,
): void {
  if (!sessionId) return
  const pane = get().panes?.[sessionId]
  if (pane?.llmRetry?.status !== 'retrying') return
  applyChat(set, get, sessionId, (p) => ({ ...p, llmRetry: null }))
}

export function handleServerMessage(
  message: ServerMessage,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
): void {
  const stateSnapshot = get()
  handleGlobalSoundEffects(message, stateSnapshot)

  const activeSessionId = stateSnapshot.focusedSessionId ?? stateSnapshot.currentSession?.id ?? null

  switch (message.type) {
    case 'session.state': {
      const payload = message.payload as SessionStatePayload
      const eventSessionId = message.sessionId
      const current = get()
      const live =
        message.id !== undefined ||
        isLivePane(current, eventSessionId) ||
        (current.pendingSessionCreate === true && eventSessionId !== undefined)
      if (!live) {
        break
      }
      // Capture the in-flight stream before the snapshot cancels it: the
      // snapshot can lag the client's already-flushed deltas, and replacing
      // the pane messages wholesale would wipe the streamed reply. Preserve
      // the live content for the message being streamed.
      const bufferedMessageId = getBuffer(eventSessionId ?? '').messageId
      cancelStreamingFlush(eventSessionId ?? '')
      const wasPendingCreate = get().pendingSessionCreate === true

      const confs = payload.pendingConfirmations ?? []
      const sessionId = payload.session.id
      const crossCleanup = { ...get().crossSessionConfirmations }
      delete crossCleanup[sessionId]

      set((state) => {
        const prior =
          state.panes[sessionId] ?? (effectiveFocusedId(state) === sessionId ? paneFromFlat(state) : emptyPane())
        const messages = payload.messages.map((m) => {
          const live = prior.messages.find((pm) => pm.id === m.id)
          if (m.id === bufferedMessageId && live) {
            // Stream in flight: the client's live copy is at least as fresh as
            // this snapshot — keep it so a lagging snapshot can never wipe the
            // streamed reply.
            return live
          }
          if (!live) return m
          // Safety net for recently-streamed messages: never regress content.
          const liveContent = live.content ?? ''
          const snapContent = m.content ?? ''
          const liveThinking = live.thinkingContent ?? ''
          const snapThinking = m.thinkingContent ?? ''
          if (liveContent.length <= snapContent.length && liveThinking.length <= snapThinking.length) return m
          const next: typeof m = { ...m }
          if (liveContent.length > snapContent.length) {
            next.content = liveContent
          }
          if (liveThinking.length > snapThinking.length) {
            next.thinkingContent = liveThinking
          }
          return next
        })
        const nextPane: SessionPane = {
          ...prior,
          session: payload.session,
          messages,
          hiddenCount: payload.hiddenCount ?? 0,
          currentTodos: [],
          pendingPathConfirmations: confs,
          pendingQuestions: payload.pendingQuestions ?? [],
          activeWorkflowExecution:
            (payload.activeWorkflowExecution as import('@shared/types.js').WorkflowExecution | undefined) ?? null,
          queuedMessages: prior.queuedMessages,
          llmRetry: null,
          liveTurnStats: null,
        }
        const base = replacePane(state, sessionId, nextPane)
        return {
          ...base,
          sessions: mergeSessionIntoSummary(base.sessions, payload.session),
          unreadSessionIds: removeUnreadSessionId(base.unreadSessionIds, sessionId),
          crossSessionConfirmations: crossCleanup,
          sessionsWithPendingConfirmations: Object.keys(crossCleanup),
          ...(wasPendingCreate ? { pendingSessionCreate: sessionId } : {}),
        }
      })

      break
    }

    case 'session.list': {
      const payload = message.payload as SessionListPayload
      set((state) => ({
        sessions: mergeSessionList(payload.sessions, state.sessions, state.currentSession),
      }))
      break
    }

    case 'session.created': {
      const payload = message.payload as SessionCreatedPayload
      set((state) => ({
        sessions: state.sessions.some((s) => s.id === payload.session.id)
          ? state.sessions.map((s) => (s.id === payload.session.id ? { ...s, ...payload.session } : s))
          : [payload.session, ...state.sessions],
        // the search corpus is stale now — refetch on the next search
        searchSessions: null,
      }))
      break
    }

    case 'session.deleted': {
      const payload = message.payload as { sessionId: string }
      const deletedId = payload.sessionId
      // Resolve the deleted session's projectId before removing it, so the
      // reload can be scoped to its project instead of fetching globally.
      const projectId = resolveSessionProjectId(get(), deletedId)
      set((state) => {
        const panes = { ...state.panes }
        delete panes[deletedId]
        return {
          panes,
          sessions: state.sessions.filter((s) => s.id !== deletedId),
          openSessionIds: state.openSessionIds.filter((id) => id !== deletedId),
          unreadSessionIds: removeUnreadSessionId(state.unreadSessionIds, deletedId),
          searchSessions: null,
        }
      })
      get().listSessions(projectId)
      break
    }

    case 'session.deletedAll': {
      // The server broadcasts sessionId = projectId for deletedAll
      const projectId = message.sessionId
      set((state) => ({
        searchSessions: null,
        sessions: projectId !== undefined ? state.sessions.filter((s) => s.projectId !== projectId) : state.sessions,
      }))
      get().listSessions(projectId)
      break
    }

    case 'session.running': {
      const payload = message.payload as SessionRunningPayload
      updateSessionField(message, set, get, (s) => ({ ...s, isRunning: payload.isRunning }))
      const eventSessionId = message.sessionId
      if (!eventSessionId || !isLivePane(get(), eventSessionId)) {
        break
      }
      if (!payload.isRunning) {
        set((state) =>
          updatePane(state, eventSessionId, (p) => ({
            ...p,
            abortInProgress: false,
            queuedMessages: [],
            liveTurnStats: null,
          })),
        )
      }
      if (payload.isRunning) {
        set((state) => updatePane(state, eventSessionId, (p) => ({ ...p, restoredInput: null, liveTurnStats: null })))
      }
      break
    }

    case 'chat.message': {
      if (
        !applyChat(set, get, message.sessionId, (pane) => {
          const payload = message.payload as ChatMessagePayload
          if (pane.messages.some((m) => m.id === payload.message.id)) {
            return pane
          }
          const isUserMessage = payload.message.role === 'user'
          return {
            ...pane,
            messages: [...pane.messages, payload.message],
            session:
              pane.session && isUserMessage
                ? { ...pane.session, messageCount: (pane.session.messageCount ?? 0) + 1 }
                : pane.session,
          }
        })
      ) {
        const payload = message.payload as ChatMessagePayload
        if (payload.message.role === 'user') {
          // Keep session message counts fresh even for non-open sessions
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === message.sessionId ? { ...s, messageCount: s.messageCount + 1 } : s,
            ),
          }))
        }
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.message_updated': {
      const payload = message.payload as ChatMessageUpdatedPayload
      const sessionId = message.sessionId
      // Ending-stream detection must read the pre-update state. The flush is
      // performed OUTSIDE the set below: cancelling inside an updater triggers
      // a nested set() whose result gets overwritten by the enclosing one —
      // silently dropping the streamed deltas.
      const paneState = get().panes[sessionId ?? '']
      const targetMsg =
        paneState?.messages.find((m) => m.id === payload.messageId) ??
        (get().currentSession?.id === sessionId ? get().messages.find((m) => m.id === payload.messageId) : undefined)
      const isEndingStreaming = payload.updates.isStreaming === false && targetMsg?.isStreaming === true
      if (isEndingStreaming) {
        cancelStreamingFlush(sessionId ?? '')
      }
      if (
        !applyChat(set, get, sessionId, (pane) => {
          return {
            ...pane,
            messages: pane.messages.map((m) => {
              if (m.id !== payload.messageId) return m
              const merged = { ...m, ...payload.updates }
              // The update can lag the live stream (the server snapshots its
              // stored content, which may trail the deltas the client already
              // assembled). Never regress a message's streamed content.
              const mergedContent = (merged as { content?: string }).content ?? ''
              const currentContent = m.content ?? ''
              if (currentContent.length > mergedContent.length) {
                ;(merged as { content?: string }).content = currentContent
              }
              return merged
            }),
            // A message_updated carrying stats is a turn-finalize broadcast: the
            // message now holds the whole turn's cumulative stats, so the live
            // channel must not be merged on top of it (would double-count).
            // Cleared here rather than waiting for chat.done to avoid a
            // one-frame ~2x flicker in the sidebar between the two frames.
            ...(payload.updates.stats ? { liveTurnStats: null } : {}),
          }
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.delta': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatDeltaPayload
      if (
        !applyChat(set, get, sessionId, (pane) => {
          if (sessionId === activeSessionId) {
            if (!triggeredNewMessageSound.has(payload.messageId)) {
              triggeredNewMessageSound.add(payload.messageId)
              const agent: AgentType | undefined = payload.subAgentType
                ? 'sub-agent'
                : resolveAgentType(get(), sessionId)
              playNewMessage(agent)
            }
          }
          const buf = getBuffer(sessionId ?? '')
          buf.messageId = payload.messageId
          buf.deltaContent += payload.content
          scheduleStreamingFlush(sessionId ?? '')
          return pane
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      dismissRetryPill(set, get, sessionId)
      break
    }

    case 'chat.thinking': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatThinkingPayload
      if (
        !applyChat(set, get, sessionId, (pane) => {
          const buf = getBuffer(sessionId ?? '')
          buf.messageId = payload.messageId
          buf.thinkingContent += payload.content
          scheduleStreamingFlush(sessionId ?? '')
          return pane
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      dismissRetryPill(set, get, sessionId)
      break
    }

    case 'chat.tool_preparing': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatToolPreparingPayload
      if (
        !applyChat(set, get, sessionId, (pane) => {
          const msg = pane.messages.find((m) => m.id === payload.messageId)
          if (!msg) return pane

          const existingToolCall = msg.toolCalls?.find((_, idx) => idx === payload.index)
          if (existingToolCall) return pane

          const existing = msg.preparingToolCalls ?? []
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
            ...pane,
            messages: pane.messages.map((m) => (m.id === payload.messageId ? { ...m, preparingToolCalls } : m)),
          }
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      dismissRetryPill(set, get, sessionId)
      break
    }

    case 'chat.tool_call': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatToolCallPayload

      const applyToolCall = (m: Message): Message => {
        const nextIndex = (m.toolCalls ?? []).length
        const preparingToolCalls = m.preparingToolCalls?.filter((ptc) => ptc.index !== nextIndex)
        const buf = getBuffer(sessionId ?? '')
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

      if (
        !applyChat(set, get, sessionId, (pane) => ({
          ...pane,
          messages: pane.messages.map((m) => (m.id === payload.messageId ? applyToolCall(m) : m)),
        }))
      ) {
        markBackgroundSessionUnread(set, message)
      }
      dismissRetryPill(set, get, sessionId)
      break
    }

    case 'chat.tool_output': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatToolOutputPayload
      if (
        !applyChat(set, get, sessionId, (pane) => {
          const buf = getBuffer(sessionId ?? '')
          buf.messageId = payload.messageId
          buf.toolOutput.push({
            messageId: payload.messageId,
            callId: payload.callId,
            stream: payload.stream,
            content: payload.output,
          })
          scheduleStreamingFlush(sessionId ?? '')
          return pane
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      dismissRetryPill(set, get, sessionId)
      break
    }

    case 'chat.tool_result': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatToolResultPayload

      if (
        !applyChat(set, get, sessionId, (pane) => ({
          ...pane,
          messages: pane.messages.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  toolCalls: m.toolCalls?.map((tc) =>
                    tc.id === payload.callId ? { ...tc, result: payload.result } : tc,
                  ),
                }
              : m,
          ),
        }))
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.vision_fallback': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatVisionFallbackPayload
      if (
        !applyChat(set, get, sessionId, (pane) => {
          const key = `${payload.messageId}-${payload.attachmentId}`
          const newByMessage = { ...pane.visionFallbackByMessage }
          newByMessage[key] = {
            type: payload.type,
            attachmentId: payload.attachmentId,
            filename: payload.filename,
            description: payload.description,
          }
          return { ...pane, visionFallbackByMessage: newByMessage }
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.todo': {
      const payload = message.payload as ChatTodoPayload
      if (!applyChat(set, get, message.sessionId, (pane) => ({ ...pane, currentTodos: payload.todos }))) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.progress': {
      // Liveness-only event: no state to apply. Background (non-open)
      // sessions get an unread tick — the original behaviour — while open
      // panes already stream live.
      if (!isLivePane(get(), message.sessionId)) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.format_retry': {
      // Same treatment as progress: acknowledge, mark background sessions
      // unread, and carry no state of our own.
      if (!isLivePane(get(), message.sessionId)) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.done': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatDonePayload
      if (!isLivePane(get(), sessionId)) {
        markBackgroundSessionUnread(set, message)
        break
      }
      cancelStreamingFlush(sessionId ?? '')
      triggeredNewMessageSound.delete(payload.messageId)

      const messageStats = payload.stats as Message['stats']
      set((state) =>
        updatePane(state, sessionId ?? '', (pane) => ({
          ...pane,
          messages: pane.messages.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  isStreaming: false,
                  stats: messageStats ?? m.stats,
                  completeReason: payload.reason,
                  preparingToolCalls: undefined,
                }
              : m,
          ),
          visionFallbackByMessage: {},
          // Sub-agent completions and waiting_for_user arrive mid-turn — don't
          // wipe the parent turn's live stats; they are replaced by the next
          // top-level chat.stats / resumed streaming.
          ...(clearsLiveTurnStats(payload) ? { liveTurnStats: null } : {}),
          ...(payload.reason !== 'error' ? { llmRetry: null } : {}),
        })),
      )
      break
    }

    case 'chat.stats': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatStatsPayload
      // Live turn stats are only meaningful for open panes; background sessions
      // get them via the aggregate once their turn lands in the snapshot.
      if (!applyChat(set, get, sessionId, (pane) => ({ ...pane, liveTurnStats: payload.stats }))) {
        break
      }
      break
    }

    case 'chat.llm_retry': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatLLMRetryPayload
      if (!isLivePane(get(), sessionId)) {
        markBackgroundSessionUnread(set, message)
        break
      }
      applyChat(set, get, sessionId, (pane) => ({
        ...pane,
        error: null,
        llmRetry: {
          status: 'retrying',
          attempt: payload.attempt,
          retryInMs: payload.retryInMs,
          error: payload.error,
        },
      }))
      break
    }

    case 'chat.llm_retry_failed': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatLLMRetryFailedPayload
      if (!isLivePane(get(), sessionId)) {
        markBackgroundSessionUnread(set, message)
        break
      }
      applyChat(set, get, sessionId, (pane) => ({
        ...pane,
        error: null,
        llmRetry: { status: 'failed', error: payload.error },
      }))
      break
    }

    case 'chat.error': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatErrorPayload
      if (!isLivePane(get(), sessionId)) {
        markBackgroundSessionUnread(set, message)
        break
      }
      cancelStreamingFlush(sessionId ?? '')
      console.error('Chat error:', payload.error, 'recoverable:', payload.recoverable)
      set((state) =>
        updatePane(state, sessionId ?? '', (pane) => ({
          ...pane,
          error: { code: 'CHAT_ERROR', message: payload.error },
        })),
      )
      break
    }

    case 'chat.path_confirmation': {
      const eventSessionId = message.sessionId
      const payload = message.payload as ChatPathConfirmationPayload
      const newConfirmation = {
        callId: payload.callId,
        tool: payload.tool,
        paths: payload.paths,
        workdir: payload.workdir,
        reason: payload.reason,
      }

      if (
        !applyChat(set, get, eventSessionId, (pane) => ({
          ...pane,
          pendingPathConfirmations: dedupeByCallId(pane.pendingPathConfirmations, newConfirmation),
        }))
      ) {
        markBackgroundSessionUnread(set, message)
        if (eventSessionId) {
          set((state) => ({
            crossSessionConfirmations: {
              ...state.crossSessionConfirmations,
              [eventSessionId]: dedupeByCallId(state.crossSessionConfirmations[eventSessionId] ?? [], newConfirmation),
            },
            sessionsWithPendingConfirmations: state.sessionsWithPendingConfirmations.includes(eventSessionId)
              ? state.sessionsWithPendingConfirmations
              : [...state.sessionsWithPendingConfirmations, eventSessionId],
          }))
        }
      }
      break
    }

    case 'session.confirmation_pending': {
      const pendingSessionId = message.sessionId
      const payload = message.payload as ChatPathConfirmationPayload
      const conf = {
        callId: payload.callId,
        tool: payload.tool,
        paths: payload.paths,
        workdir: payload.workdir,
        reason: payload.reason,
      }
      if (
        !applyChat(set, get, pendingSessionId, (pane) => ({
          ...pane,
          pendingPathConfirmations: dedupeByCallId(pane.pendingPathConfirmations, conf),
        })) &&
        pendingSessionId
      ) {
        set((state) => ({
          crossSessionConfirmations: {
            ...state.crossSessionConfirmations,
            [pendingSessionId]: dedupeByCallId(state.crossSessionConfirmations[pendingSessionId] ?? [], conf),
          },
          sessionsWithPendingConfirmations: state.sessionsWithPendingConfirmations.includes(pendingSessionId)
            ? state.sessionsWithPendingConfirmations
            : [...state.sessionsWithPendingConfirmations, pendingSessionId],
        }))
      }
      break
    }

    case 'session.confirmation_resolved': {
      const resolvedId = message.sessionId
      const resolvedPayload = message.payload as { sessionId: string; callId: string }
      if (resolvedId) {
        set((state) => {
          const sessionConfs = state.crossSessionConfirmations[resolvedId] ?? []
          const remaining = sessionConfs.filter((c) => c.callId !== resolvedPayload.callId)
          const newCross = { ...state.crossSessionConfirmations }
          if (remaining.length === 0) {
            delete newCross[resolvedId]
          } else {
            newCross[resolvedId] = remaining
          }
          return {
            crossSessionConfirmations: newCross,
            sessionsWithPendingConfirmations: Object.keys(newCross),
          }
        })
        applyChat(set, get, resolvedId, (pane) => ({
          ...pane,
          pendingPathConfirmations: pane.pendingPathConfirmations.filter((c) => c.callId !== resolvedPayload.callId),
        }))
      }
      break
    }

    case 'chat.ask_user': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatAskUserPayload
      if (
        !applyChat(set, get, sessionId, (pane) => {
          const newQuestion: PendingQuestion = {
            callId: payload.callId,
            question: payload.question,
            type: payload.type ?? 'text',
            options: payload.options ?? undefined,
          }
          return {
            ...pane,
            pendingQuestions: [...pane.pendingQuestions.filter((q) => q.callId !== payload.callId), newQuestion],
          }
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'chat.autoanswer': {
      const sessionId = message.sessionId
      const payload = message.payload as ChatAutoAnswerPayload
      if (!payload.callId) break
      if (!payload.active && payload.answered) {
        applyChat(set, get, sessionId, (pane) => ({
          ...pane,
          pendingQuestions: pane.pendingQuestions.filter((q) => q.callId !== payload.callId),
        }))
        break
      }
      applyChat(set, get, sessionId, (pane) => ({
        ...pane,
        pendingQuestions: pane.pendingQuestions.map((q) => {
          if (q.callId !== payload.callId) return q
          if (!payload.active || payload.deadline === undefined) {
            const rest = { ...q }
            delete rest.autoAnswerDeadline
            return rest
          }
          return { ...q, autoAnswerDeadline: payload.deadline }
        }),
      }))
      break
    }

    case 'mode.changed': {
      const sessionId = message.sessionId
      const payload = message.payload as ModeChangedPayload
      if (
        !applyChat(set, get, sessionId, (pane) =>
          pane.session ? { ...pane, session: { ...pane.session, mode: payload.mode } } : pane,
        )
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'phase.changed': {
      const payload = message.payload as PhaseChangedPayload
      updateSessionField(message, set, get, (s) => ({ ...s, phase: payload.phase }))
      break
    }

    case 'workflow.execution_changed': {
      const sessionId = message.sessionId
      const payload = message.payload as {
        executionId: string
        workflowId: string
        workflowName: string
        workflowColor?: string
        status: import('@shared/types.js').WorkflowExecutionStatus
        currentStepId?: string
        currentStepName?: string
        pendingChoices?: import('@shared/types.js').UserStepChoice[]
      }
      const stepPatch = {
        ...(payload.currentStepId ? { currentStepId: payload.currentStepId } : {}),
        ...(payload.currentStepName ? { currentStepName: payload.currentStepName } : {}),
        ...(payload.pendingChoices ? { pendingChoices: payload.pendingChoices } : {}),
      }
      if (
        !applyChat(set, get, sessionId, (pane) => {
          const current = pane.activeWorkflowExecution
          if (!current) {
            // Event arrived before session state loaded — create minimal entry
            return {
              ...pane,
              activeWorkflowExecution: {
                id: payload.executionId,
                sessionId: message.sessionId ?? '',
                workflowId: payload.workflowId,
                workflowName: payload.workflowName,
                ...(payload.workflowColor ? { workflowColor: payload.workflowColor } : {}),
                status: payload.status,
                ...stepPatch,
                stepOutput: {},
                params: {},
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            }
          }
          return {
            ...pane,
            activeWorkflowExecution: {
              ...current,
              status: payload.status,
              ...stepPatch,
            },
          }
        })
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'workflow.autolaunch': {
      const sessionId = message.sessionId
      if (!sessionId) break
      const payload = message.payload as WorkflowAutoLaunchPayload
      set((state) =>
        updatePane(state, sessionId, (p) => ({
          ...p,
          autoLaunch: payload.active
            ? {
                workflowId: payload.workflowId ?? '',
                workflowName: payload.workflowName ?? payload.workflowId ?? '',
                scope: payload.scope ?? 'auto',
                deadline: payload.deadline ?? Date.now(),
              }
            : null,
        })),
      )
      break
    }

    case 'criteria.updated': {
      const sessionId = message.sessionId
      const payload = message.payload as CriteriaUpdatedPayload
      if (
        !applyChat(set, get, sessionId, (pane) =>
          pane.session ? { ...pane, session: { ...pane.session, criteria: payload.criteria } } : pane,
        )
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'metadata.updated': {
      const sessionId = message.sessionId
      const payload = message.payload as MetadataUpdatedPayload
      if (
        !applyChat(set, get, sessionId, (pane) =>
          pane.session
            ? {
                ...pane,
                session: {
                  ...pane.session,
                  metadataEntries: {
                    ...pane.session.metadataEntries,
                    [payload.key]: payload.entries,
                  },
                },
              }
            : pane,
        )
      ) {
        markBackgroundSessionUnread(set, message)
      }
      break
    }

    case 'context.state': {
      const payload = message.payload as ContextStatePayload
      const sessionId = message.sessionId
      const isCurrentSession = isLivePane(get(), sessionId)

      if (payload.subAgentId) {
        if (isCurrentSession && sessionId) {
          set((state) =>
            updatePane(state, sessionId, (pane) => ({
              ...pane,
              subAgentContextStates: {
                ...pane.subAgentContextStates,
                [payload.subAgentId!]: payload.context,
              },
            })),
          )
        }
      } else {
        if (isCurrentSession && sessionId) {
          set((state) => updatePane(state, sessionId, (pane) => ({ ...pane, contextState: payload.context })))
        } else {
          markBackgroundSessionUnread(set, message)
        }
      }
      break
    }

    case 'session.name_generated': {
      const payload = message.payload as { name: string }
      const eventSessionId = message.sessionId
      const activeSessionId = get().focusedSessionId ?? get().currentSession?.id

      set((state) => {
        const base =
          eventSessionId && state.panes[eventSessionId]?.session
            ? updatePane(state, eventSessionId, (p) => ({
                ...p,
                session: { ...p.session!, metadata: { ...p.session!.metadata, title: payload.name } },
              }))
            : state
        return {
          ...base,
          sessions: base.sessions.map((s) => (s.id === eventSessionId ? { ...s, title: payload.name } : s)),
          currentSession:
            activeSessionId === eventSessionId && base.currentSession
              ? { ...base.currentSession, metadata: { ...base.currentSession.metadata, title: payload.name } }
              : base.currentSession,
        }
      })
      break
    }

    case 'queue.state': {
      const payload = message.payload as QueueStatePayload
      const sessionId = message.sessionId ?? effectiveFocusedId(get())
      if (sessionId && isLivePane(get(), sessionId)) {
        set((state) => updatePane(state, sessionId, (p) => ({ ...p, queuedMessages: payload.messages ?? [] })))
      } else {
        set({ queuedMessages: payload.messages ?? [] })
      }
      break
    }

    case 'mcp.servers.changed': {
      const payload = message.payload as { servers?: McpServerInfo[] }
      if (payload?.servers) {
        const sorted = [...payload.servers].sort((a, b) => a.name.localeCompare(b.name))
        // WS write-through: update the cache entry directly so every subscriber
        // converges without a refetch (and no refetch storm).
        mcpServersResource.write(sorted)
      }
      window.dispatchEvent(new CustomEvent('mcp-servers-changed'))
      break
    }

    case 'git.status': {
      const payload = message.payload as { branch: string | null; diff: { files: GitDiffFile[] } }
      const sessionId = message.sessionId ?? effectiveFocusedId(get())
      if (sessionId && isLivePane(get(), sessionId)) {
        set((state) =>
          updatePane(state, sessionId, (p) => ({ ...p, gitStatus: { branch: payload.branch, diff: payload.diff } })),
        )
      } else {
        set({ gitStatus: { branch: payload.branch, diff: payload.diff } })
      }
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

    case 'tasks.update': {
      useTasksStore.getState().handleTasksUpdate(message.payload as import('@shared/protocol.js').TasksUpdatePayload)
      break
    }

    case 'error': {
      const payload = message.payload as { code: string; message: string }
      console.error('Server error:', payload)
      const sessionId = message.sessionId ?? effectiveFocusedId(get())
      set((state) => {
        if (sessionId && isLivePane(state, sessionId)) {
          return updatePane(state, sessionId, (p) => ({
            ...p,
            error: { code: payload.code, message: payload.message },
          }))
        }
        return { error: { code: payload.code, message: payload.message } }
      })
      break
    }
  }
}
