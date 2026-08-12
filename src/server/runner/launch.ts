/**
 * Shared workflow-run launcher.
 *
 * Single code path for starting a workflow-orchestrator run in a session,
 * used by the WebSocket `runner.launch` handler and by the project-tasks
 * service when a slash-workflow task is seeded. Owns the running-state
 * lifecycle, error surfacing, and a small registry so `abortRunnerRun` can
 * cancel task-launched runs (the WS layer additionally tracks its own
 * controllers for client-initiated runs).
 */

import type { Attachment, StatsIdentity, WorkflowLaunchScope } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { runOrchestrator } from './index.js'
import { normalizeWorkflowScope } from '../workflows/registry.js'
import { logger } from '../utils/logger.js'
import { createSessionRunningMessage } from '../ws/protocol.js'

export interface WorkflowLaunchPayload {
  workflowId?: string
  params?: Record<string, string>
  subGroup?: string
  scope?: WorkflowLaunchScope
  /** Resume from a paused user step. */
  resumeFrom?: string
  /** Step output supplied when resuming. */
  stepOutput?: Record<string, string>
  /** Branch chosen by the user at a paused user step. */
  userChoice?: string
  content?: string
  attachments?: Attachment[]
}

export interface LaunchWorkflowRunDeps {
  sessionManager: SessionManager
  sessionId: string
  controller: AbortController
  llmClient: LLMClientWithModel
  /** Re-resolve the session's LLM client per retry attempt (provider switch mid-run). */
  getSessionLLMClient?: () => LLMClientWithModel
  statsIdentity: StatsIdentity
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
  /** Turn-bookkeeping cleanup after the run settles (queue drain, restart, …). */
  onFinished?: () => void
}

const activeRuns = new Map<string, AbortController>()

/** Abort a task-launched workflow run for a session. Returns whether one was found. */
export function abortRunnerRun(sessionId: string): boolean {
  const controller = activeRuns.get(sessionId)
  if (!controller) return false
  controller.abort()
  return true
}

export function launchWorkflowRun(deps: LaunchWorkflowRunDeps, payload: WorkflowLaunchPayload): void {
  const {
    sessionManager,
    sessionId,
    controller,
    llmClient,
    getSessionLLMClient,
    statsIdentity,
    broadcastForSession,
    onFinished,
  } = deps
  const signal = controller.signal

  activeRuns.set(sessionId, controller)

  // Mark session as running (emits running.changed event)
  sessionManager.setRunning(sessionId, true)
  broadcastForSession(sessionId, createSessionRunningMessage(true))

  const launchAttachments = payload.attachments
  const hasUserContent = payload.content && payload.content.trim().length > 0
  const hasUserAttachments = launchAttachments && launchAttachments.length > 0

  runOrchestrator({
    sessionManager,
    sessionId,
    llmClient,
    ...(getSessionLLMClient ? { getSessionLLMClient } : {}),
    statsIdentity,
    scope: normalizeWorkflowScope(payload.scope),
    ...(payload.workflowId ? { workflowId: payload.workflowId } : {}),
    ...(payload.subGroup ? { subGroup: payload.subGroup } : {}),
    ...(payload.params ? { params: payload.params } : {}),
    ...(payload.resumeFrom ? { resumeFromStep: payload.resumeFrom } : {}),
    ...(payload.stepOutput ? { initialStepOutput: payload.stepOutput } : {}),
    ...(payload.userChoice ? { userChoice: payload.userChoice } : {}),
    ...(payload.resumeFrom
      ? (() => {
          const exec = sessionManager.getLatestWorkflowExecution(sessionId)
          if (!exec) return {}

          if (exec.status === 'waiting' || exec.status === 'blocked') {
            // Re-activate a paused (waiting) or failed-and-blocked execution so
            // the resumed/retried run stays tracked: status flips back to
            // 'running' (same execution id) and params/step output are restored.
            const resumed = sessionManager.resumeWorkflow(
              sessionId,
              exec.id,
              exec.workflowId,
              exec.workflowName,
              exec.workflowColor,
            )
            if (resumed) {
              return {
                params: resumed.params,
                initialStepOutput: resumed.stepOutput,
                ...(exec.currentStepId ? { resumeFromStep: exec.currentStepId } : {}),
                ...(exec.subGroup ? { subGroup: exec.subGroup } : {}),
              }
            }
          }

          // For 'running' status (e.g. abort during agent step), use existing
          // execution info without calling resumeWorkflow — status is already current.
          return {
            ...(Object.keys(exec.params).length > 0 ? { params: exec.params } : {}),
            ...(Object.keys(exec.stepOutput).length > 0 ? { initialStepOutput: exec.stepOutput } : {}),
            ...(exec.currentStepId ? { resumeFromStep: exec.currentStepId } : {}),
            ...(exec.subGroup ? { subGroup: exec.subGroup } : {}),
          }
        })()
      : {}),
    ...(hasUserContent || hasUserAttachments
      ? {
          userMessage: {
            content: payload.content ?? '',
            ...(hasUserAttachments ? { attachments: launchAttachments! } : {}),
          },
        }
      : {}),
    signal,
    onMessage: (msg) => broadcastForSession(sessionId, msg), // For path confirmation dialogs
  })
    .catch((error: unknown) => {
      // Don't create error message for controlled abort
      if (error instanceof Error && error.message === 'Aborted') {
        return
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Runner error', { error: errorMessage, sessionId })
      // Surface validation errors to the user (e.g. missing required params)
      broadcastForSession(sessionId, createServerMessage('chat.error', { error: errorMessage, recoverable: false }))
    })
    .finally(() => {
      if (activeRuns.get(sessionId) === controller) {
        activeRuns.delete(sessionId)
      }
      try {
        // The orchestrator bypasses runChatTurn, so isRunning must be cleared here
        sessionManager.setRunning(sessionId, false)
        broadcastForSession(sessionId, createSessionRunningMessage(false))
        onFinished?.()
      } catch {
        // Session may have been deleted during execution
      }
    })
}
