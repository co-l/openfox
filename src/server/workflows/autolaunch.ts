/**
 * Favorite-workflow auto-launch countdown.
 *
 * Server-owned countdown (duration from the auto-action timeout setting):
 * when a session goes idle at the post-planner
 * "start building" choice point and a favorite workflow resolves, the backend
 * schedules a countdown and broadcasts a `workflow.autolaunch` message with
 * the deadline so any client (now or after a reload) can render it. On expiry
 * the favorite workflow launches through the same path as a manual click.
 * Cancelling happens on a manual workflow launch, a user message, a first
 * keystroke in the chat input (WS cancel), or the countdown's close button.
 */

import type { WorkflowScope } from '../../shared/types.js'
import type { ServerMessage, WorkflowAutoLaunchPayload } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import { logger } from '../utils/logger.js'

export interface AutoLaunchFavorite {
  id: string
  name: string
  scope: WorkflowScope
}

interface PendingAutoLaunch {
  favorite: AutoLaunchFavorite
  deadline: number
  timer: ReturnType<typeof setTimeout>
}

export interface AutoLaunchDeps {
  /** Route a message to clients subscribed to the session. */
  broadcast: (sessionId: string, msg: ServerMessage) => void
  /** Fire on expiry: launch the favorite workflow exactly like a user click. */
  fire: (sessionId: string, favorite: AutoLaunchFavorite) => void
  /** Countdown duration for this scope, from the auto-action timeout setting. */
  resolveDelayMs: (projectId?: string) => number
}

const pending = new Map<string, PendingAutoLaunch>()
let deps: AutoLaunchDeps | null = null

export function initAutoLaunch(nextDeps: AutoLaunchDeps): void {
  deps = nextDeps
}

function activeMessage(favorite: AutoLaunchFavorite, deadline: number): ServerMessage<WorkflowAutoLaunchPayload> {
  return createServerMessage('workflow.autolaunch', {
    active: true,
    workflowId: favorite.id,
    workflowName: favorite.name,
    scope: favorite.scope,
    deadline,
  })
}

const CLEARED_MESSAGE = createServerMessage<WorkflowAutoLaunchPayload>('workflow.autolaunch', { active: false })

/** Schedule the countdown for a session. No-op when one is already pending. */
export function scheduleAutoLaunch(sessionId: string, favorite: AutoLaunchFavorite, projectId?: string): void {
  if (pending.has(sessionId) || !deps) return
  const delayMs = deps.resolveDelayMs(projectId)
  const deadline = Date.now() + delayMs
  const timer = setTimeout(() => {
    pending.delete(sessionId)
    deps?.broadcast(sessionId, CLEARED_MESSAGE)
    logger.info('Favorite workflow auto-launching', { sessionId, workflowId: favorite.id })
    try {
      deps?.fire(sessionId, favorite)
    } catch (err) {
      logger.error('Auto-launch failed to start workflow', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, delayMs)
  timer.unref?.()
  pending.set(sessionId, { favorite, deadline, timer })
  deps.broadcast(sessionId, activeMessage(favorite, deadline))
}

/** Cancel a pending countdown (manual pick, message sent, typing, close button). */
export function cancelAutoLaunch(sessionId: string): void {
  const entry = pending.get(sessionId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(sessionId)
  deps?.broadcast(sessionId, CLEARED_MESSAGE)
}

/** Current countdown for reconnect/reload sync; null when nothing is pending. */
export function getAutoLaunchMessage(sessionId: string): ServerMessage<WorkflowAutoLaunchPayload> | null {
  const entry = pending.get(sessionId)
  if (!entry) return null
  return activeMessage(entry.favorite, entry.deadline)
}

/** Whether a countdown is currently pending for the session. */
export function hasAutoLaunchPending(sessionId: string): boolean {
  return pending.has(sessionId)
}

/** Test seam: drop all timers without firing. */
export function clearAllAutoLaunch(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
}
