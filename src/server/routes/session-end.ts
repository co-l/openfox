/**
 * End-of-session routes
 *
 * "Delete session" is two-phase: POST /sessions/:id/end-session runs the
 * configured end-of-session command (default: bundled `end-of-session`) inside
 * the session and marks it closing, so the chat ends with the routine's summary
 * and the user confirms the actual delete from the chat. Cancelling the closing
 * (DELETE) just lets the session live on.
 *
 * When the setting is empty the routine is off and end-session deletes right
 * away; a configured command that cannot run is a 409 instead, because deleting
 * silently is not what the user clicked.
 */

import { Router, type Request, type Response } from 'express'
import type { ServerMessage, SessionClosingPayload } from '../../shared/protocol.js'
import type { SessionManager } from '../session/manager.js'
import { getSetting, SETTINGS_KEYS, DEFAULT_END_OF_SESSION_COMMAND } from '../db/settings.js'
import { updateSessionClosing } from '../db/sessions.js'
import { loadAllCommands, findCommandById } from '../commands/registry.js'
import { expandCommandPrompt } from '../tasks/slash.js'
import { serverT } from '../i18n.js'
import { logger } from '../utils/logger.js'

export interface SessionEndRoutesDeps {
  sessionManager: Pick<
    SessionManager,
    'getSession' | 'queueMessage' | 'cancelQueuedMessage' | 'getQueueState' | 'setMode' | 'getProjectWorkdir'
  >
  configDir: string
  /** The destructive path (abort + delete + broadcast), owned by the caller. */
  hardDelete: (sessionId: string) => void | Promise<void>
  broadcast?: (message: ServerMessage) => void
}

export interface EndOfSessionLaunch {
  commandId: string
  prompt: string
  agentMode?: string
}

export type EndOfSessionReason = 'disabled' | 'not_found' | 'needs_params'

export type EndOfSessionResolution =
  | ({ available: true; reason?: undefined } & EndOfSessionLaunch)
  | { available: false; reason: EndOfSessionReason; commandId?: string }

/**
 * Resolve the configured end-of-session command for a project, told as an
 * availability verdict rather than a bare null: "the user switched it off" and
 * "the configured command cannot run" must not look the same to the client,
 * since one deletes right away and the other is a broken setting to report.
 */
export async function resolveEndOfSessionCommand(
  configDir: string,
  projectDir?: string,
): Promise<EndOfSessionResolution> {
  const configured = (getSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND) ?? DEFAULT_END_OF_SESSION_COMMAND).trim()
  if (!configured) return { available: false, reason: 'disabled' }

  const command = findCommandById(configured, await loadAllCommands(configDir, projectDir))
  if (!command) {
    logger.warn(`End-of-session command "${configured}" not found - running the plain close instead`, { projectDir })
    return { available: false, reason: 'not_found', commandId: configured }
  }

  const { prompt, unfilledParams } = expandCommandPrompt(command.prompt, [])
  if (unfilledParams.length > 0) {
    logger.warn(`End-of-session command "${configured}" needs parameters - running the plain close instead`)
    return { available: false, reason: 'needs_params', commandId: configured }
  }

  return {
    available: true,
    commandId: configured,
    prompt,
    ...(command.metadata.agentMode ? { agentMode: command.metadata.agentMode } : {}),
  }
}

/**
 * Boot recovery for sessions still marked closing. The queued routine prompt is
 * transient runtime state that dies with the process while closing_at persists,
 * so without this the UI would claim "done" for a routine that never ran and
 * never will. Re-arming re-queues the configured command; a routine that had
 * already concluded before the restart simply runs its harmless, idempotent
 * wrap-up again. Commands that cannot run any more leave the session alone.
 */
export async function recoverClosingSessions(
  configDir: string,
  sessions: { id: string; workdir: string }[],
  manager: Pick<SessionManager, 'queueMessage' | 'setMode'>,
): Promise<number> {
  let requeued = 0
  for (const session of sessions) {
    const resolution = await resolveEndOfSessionCommand(configDir, session.workdir).catch(() => null)
    if (!resolution?.available) continue
    if (resolution.agentMode) {
      try {
        manager.setMode(session.id, resolution.agentMode)
      } catch {
        // Unknown agent id - keep the session's current agent.
      }
    }
    manager.queueMessage(session.id, 'asap', resolution.prompt, undefined, 'command')
    requeued++
  }
  return requeued
}

export function registerSessionEndRoutes(router: Router, deps: SessionEndRoutesDeps): void {
  const findSession = (req: Request, res: Response) => {
    const sessionId = req.params['id'] as string
    const session = deps.sessionManager.getSession(sessionId)
    if (!session) {
      res.status(404).json({ error: serverT({ en: 'Session not found', fr: 'Session introuvable' }) })
      return null
    }
    return { sessionId, session }
  }

  router.post('/sessions/:id/end-session', async (req: Request, res: Response) => {
    const target = findSession(req, res)
    if (!target) return
    const { sessionId, session } = target

    let resolution: EndOfSessionResolution
    try {
      resolution = await resolveEndOfSessionCommand(deps.configDir, session.workdir)
    } catch (error) {
      // A broken command definition must never block closing a session.
      logger.error('Failed to resolve the end-of-session command', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      resolution = { available: false, reason: 'not_found' }
    }

    if (!resolution.available) {
      if (resolution.reason !== 'disabled') {
        // The user asked for the routine; deleting instead would be a silent
        // surprise, so nothing moves and the client shows the reason.
        return res.status(409).json({
          error: serverT({
            en: `End-of-session command "${resolution.commandId ?? ''}" cannot run`,
            fr: `La commande de fin de session « ${resolution.commandId ?? ''} » ne peut pas s'exécuter`,
          }),
          reason: resolution.reason,
          command: resolution.commandId,
        })
      }
      await deps.hardDelete(sessionId)
      return res.json({ deleted: true })
    }

    const launch = resolution
    if (launch.agentMode) {
      try {
        deps.sessionManager.setMode(sessionId, launch.agentMode)
      } catch {
        // Unknown agent id - keep the session's current agent.
      }
    }

    const closingAt = new Date().toISOString()
    updateSessionClosing(sessionId, closingAt)
    deps.sessionManager.queueMessage(sessionId, 'asap', launch.prompt, undefined, 'command')
    deps.broadcast?.({
      type: 'session.closing',
      sessionId,
      payload: { closingAt } satisfies SessionClosingPayload,
    })
    res.json({ closing: true, command: launch.commandId })
  })

  router.delete('/sessions/:id/end-session', async (req: Request, res: Response) => {
    const target = findSession(req, res)
    if (!target) return
    const { sessionId, session } = target

    // Withdraw the routine when it never got its turn (the session was busy, so
    // the prompt is still queued): a kept session must not wrap itself up later.
    const launch = await resolveEndOfSessionCommand(deps.configDir, session.workdir).catch(() => null)
    if (launch?.available) {
      for (const queued of deps.sessionManager.getQueueState(sessionId)) {
        if (queued.messageKind === 'command' && queued.content === launch.prompt) {
          deps.sessionManager.cancelQueuedMessage(sessionId, queued.queueId)
        }
      }
    }

    updateSessionClosing(sessionId, null)
    deps.broadcast?.({ type: 'session.closing', sessionId, payload: { closingAt: null } })
    res.json({ success: true })
  })
}
