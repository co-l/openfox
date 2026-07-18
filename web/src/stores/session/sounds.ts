import type { ServerMessage, ChatDonePayload, PhaseChangedPayload } from '@shared/protocol.js'
import { playNotification, playAchievement, playIntervention, playWaitingForUser } from '../../lib/sound'
import type { AgentType } from '../notifications'
import type { SessionState } from './types'

const lastSeenPhase = new Map<string, string>()

export function resolveAgentType(state: SessionState, sessionId?: string): AgentType | undefined {
  const session = sessionId === state.currentSession?.id ? state.currentSession : null
  const summary = state.sessions.find((s) => s.id === sessionId)
  const mode = session?.mode ?? summary?.mode
  if (mode === 'planner') return 'planner'
  if (mode === 'builder') return 'build'
  return 'planner'
}

export function handleGlobalSoundEffects(message: ServerMessage, state: SessionState): void {
  if (message.type === 'chat.done') {
    const payload = message.payload as ChatDonePayload
    const resolvedAgent = resolveAgentType(state, message.sessionId)
    const agent = payload.agentType ?? resolvedAgent
    if (payload.reason === 'complete') {
      playNotification(agent)
    }
    if (payload.reason === 'waiting_for_user') {
      playWaitingForUser(agent)
    }
    return
  }

  if (message.type === 'chat.path_confirmation') {
    const agent = resolveAgentType(state, message.sessionId)
    playWaitingForUser(agent)
    return
  }

  if (message.type === 'session.confirmation_pending') {
    const agent = resolveAgentType(state, message.sessionId)
    playWaitingForUser(agent)
    return
  }

  if (message.type === 'task.completed') {
    const agent = resolveAgentType(state, message.sessionId)
    playAchievement(agent)
    return
  }

  if (message.type === 'phase.changed' && message.sessionId) {
    const payload = message.payload as PhaseChangedPayload
    const previousPhase = lastSeenPhase.get(message.sessionId) ?? null
    lastSeenPhase.set(message.sessionId, payload.phase)

    if (previousPhase === payload.phase) {
      return
    }

    const agent = resolveAgentType(state, message.sessionId)
    if (payload.phase === 'blocked') {
      playIntervention(agent)
    }
  }
}

export const soundTestExports = {
  handleGlobalSoundEffects,
}
