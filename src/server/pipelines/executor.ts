/**
 * Pipeline Executor
 *
 * Walks a pipeline state machine: evaluate current step, execute it,
 * evaluate transitions, move to next step. Repeats until a terminal
 * state ($done or $blocked) is reached.
 */

import type { Criterion } from '../../shared/types.js'
import type { OrchestratorOptions, OrchestratorResult, NextAction } from '../runner/types.js'
import type {
  PipelineDefinition,
  PipelineStep,
  Transition,
  TransitionCondition,
  LLMTurnStep,
  SubAgentStep,
  ShellStep,
} from './types.js'
import { TERMINAL_DONE, TERMINAL_BLOCKED } from './types.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { runBuilderTurn, runVerifierTurn, TurnMetrics, createMessageStartEvent } from '../chat/orchestrator.js'
import { computeSessionStats } from '../../shared/stats.js'
import { executeShellCommand } from './shell.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Template Variables
// ============================================================================

interface TemplateContext {
  workdir: string
  reason: string
  verifierFindings: string
  previousStepOutput: string
  criteriaCount: number
  pendingCount: number
}

function resolveTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{workdir\}\}/g, ctx.workdir)
    .replace(/\{\{reason\}\}/g, ctx.reason)
    .replace(/\{\{verifierFindings\}\}/g, ctx.verifierFindings)
    .replace(/\{\{previousStepOutput\}\}/g, ctx.previousStepOutput)
    .replace(/\{\{criteriaCount\}\}/g, String(ctx.criteriaCount))
    .replace(/\{\{pendingCount\}\}/g, String(ctx.pendingCount))
}

// ============================================================================
// Transition Evaluation
// ============================================================================

interface StepOutcome {
  success: boolean
}

function evaluateCondition(
  condition: TransitionCondition,
  criteria: Criterion[],
  maxVerifyRetries: number,
  stepOutcome: StepOutcome | null,
): boolean {
  switch (condition.type) {
    case 'all_criteria_passed':
      return criteria.length === 0 || criteria.every(c => c.status.type === 'passed')

    case 'all_criteria_completed_or_passed':
      return criteria.every(c => c.status.type === 'completed' || c.status.type === 'passed')

    case 'any_criteria_blocked':
      return criteria.some(c =>
        c.status.type === 'failed' &&
        c.attempts.filter(a => a.status === 'failed').length >= maxVerifyRetries
      )

    case 'has_pending_criteria':
      return criteria.some(c => c.status.type !== 'passed')

    case 'step_result':
      if (!stepOutcome) return false
      return condition.result === 'success' ? stepOutcome.success : !stepOutcome.success

    case 'always':
      return true
  }
}

function evaluateTransitions(
  transitions: Transition[],
  criteria: Criterion[],
  maxVerifyRetries: number,
  stepOutcome: StepOutcome | null,
): string {
  for (const transition of transitions) {
    if (evaluateCondition(transition.when, criteria, maxVerifyRetries, stepOutcome)) {
      return transition.goto
    }
  }
  // No transition matched — treat as blocked
  return TERMINAL_BLOCKED
}

// ============================================================================
// Helper
// ============================================================================

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

function buildReason(criteria: Criterion[]): string {
  const remaining = criteria.filter(c => c.status.type !== 'passed')
  return `${remaining.length} criteria remaining`
}

// ============================================================================
// Executor
// ============================================================================

export async function executePipeline(
  pipeline: PipelineDefinition,
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const startTime = performance.now()
  let iterations = 0

  let currentStepId = pipeline.entryStep
  let lastVerifierContent = ''
  let lastShellOutput = ''
  let isFirstBuilderEntry = true

  const stepsById = new Map<string, PipelineStep>()
  for (const step of pipeline.steps) {
    stepsById.set(step.id, step)
  }

  logger.debug('Pipeline executor starting', { sessionId, pipeline: pipeline.metadata.id })

  while (iterations < pipeline.settings.maxIterations) {
    // Check abort
    if (signal?.aborted) {
      logger.debug('Pipeline executor aborted', { sessionId, iterations })
      return {
        finalAction: { type: 'RUN_BUILDER', reason: 'Aborted' },
        iterations,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }

    iterations++

    const step = stepsById.get(currentStepId)
    if (!step) {
      logger.error('Pipeline step not found', { sessionId, stepId: currentStepId })
      return {
        finalAction: { type: 'BLOCKED', reason: `Step "${currentStepId}" not found in pipeline`, blockedCriteria: [] },
        iterations,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }

    const session = sessionManager.requireSession(sessionId)
    const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)
    const criteria = session.criteria

    // Build template context
    const templateCtx: TemplateContext = {
      workdir: session.workdir,
      reason: buildReason(criteria),
      verifierFindings: lastVerifierContent,
      previousStepOutput: lastShellOutput,
      criteriaCount: criteria.length,
      pendingCount: criteria.filter(c => c.status.type !== 'passed').length,
    }

    // Set session phase
    sessionManager.setPhase(sessionId, step.phase as 'build' | 'verification' | 'blocked' | 'done')

    logger.debug('Pipeline step executing', { sessionId, iteration: iterations, stepId: step.id, stepType: step.type })

    let stepOutcome: StepOutcome | null = null

    // Execute step
    switch (step.type) {
      case 'llm_turn': {
        const llmStep = step as LLMTurnStep

        // Inject nudge/kickoff prompt
        if (!isFirstBuilderEntry && llmStep.nudgePrompt) {
          const nudgeContent = resolveTemplate(llmStep.nudgePrompt, templateCtx)
          const nudgeMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', nudgeContent, {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
        }

        const turnMetrics = new TurnMetrics()
        await runBuilderTurn({
          sessionManager,
          sessionId,
          llmClient,
          ...(options.statsIdentity ? { statsIdentity: options.statsIdentity } : {}),
          ...(isFirstBuilderEntry && options.injectBuilderKickoff === true ? { injectBuilderKickoff: true } : {}),
          ...(signal ? { signal } : {}),
          ...(onMessage ? { onMessage } : {}),
        }, turnMetrics)

        isFirstBuilderEntry = false
        stepOutcome = { success: true }
        break
      }

      case 'sub_agent': {
        const subStep = step as SubAgentStep
        const turnMetrics = new TurnMetrics()

        if (subStep.subAgentType === 'verifier') {
          const verifierResult = await runVerifierTurn({
            sessionManager,
            sessionId,
            llmClient,
            ...(options.statsIdentity ? { statsIdentity: options.statsIdentity } : {}),
            ...(signal ? { signal } : {}),
            ...(onMessage ? { onMessage } : {}),
          }, turnMetrics)
          lastVerifierContent = verifierResult.content ?? ''
          stepOutcome = { success: verifierResult.allPassed }
        } else {
          // Custom sub-agent types can be added here in the future
          logger.warn('Unknown sub-agent type', { subAgentType: subStep.subAgentType })
          stepOutcome = { success: false }
        }
        break
      }

      case 'shell': {
        const shellStep = step as ShellStep
        const command = resolveTemplate(shellStep.command, templateCtx)
        const timeout = shellStep.timeout ?? 60_000
        const successCodes = shellStep.successExitCodes ?? [0]

        // Emit a message showing the shell command being run
        const shellMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(shellMsgId, 'user', `Running: \`${command}\``, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'auto-prompt',
        }))

        const result = await executeShellCommand(command, session.workdir, timeout, signal)

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        lastShellOutput = output

        // Append output as message content
        const outputContent = output
          ? `Exit code: ${result.exitCode}\n\`\`\`\n${output.slice(0, 10000)}\n\`\`\``
          : `Exit code: ${result.exitCode}`
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: shellMsgId } })

        const outputMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageStartEvent(outputMsgId, 'user', outputContent, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: outputMsgId } })

        stepOutcome = { success: successCodes.includes(result.exitCode) }
        break
      }
    }

    // Evaluate transitions
    const refreshedSession = sessionManager.requireSession(sessionId)
    const nextStepId = evaluateTransitions(
      step.transitions,
      refreshedSession.criteria,
      pipeline.settings.maxVerifyRetries,
      stepOutcome,
    )

    // Handle terminal states
    if (nextStepId === TERMINAL_DONE) {
      sessionManager.setPhase(sessionId, 'done')

      const totalTimeSeconds = Math.round((performance.now() - startTime) / 100) / 10
      const completedSession = sessionManager.requireSession(sessionId)
      const sessionStats = computeSessionStats(completedSession.messages)
      const totalToolCalls = completedSession.messages.reduce(
        (sum, m) => sum + (m.toolCalls?.length ?? 0), 0
      )
      const taskCompletedData = {
        summary: completedSession.summary,
        iterations,
        totalTimeSeconds,
        totalToolCalls,
        totalTokensGenerated: sessionStats?.generationTokens ?? 0,
        avgGenerationSpeed: sessionStats?.avgGenerationSpeed ?? 0,
        responseCount: sessionStats?.responseCount ?? 0,
        llmCallCount: sessionStats?.llmCallCount ?? 0,
        criteria: completedSession.criteria.map(c => ({
          id: c.id,
          description: c.description,
          status: c.status.type,
        })),
      }
      eventStore.append(sessionId, { type: 'task.completed', data: taskCompletedData })

      const markerMsgId = crypto.randomUUID()
      eventStore.append(sessionId, createMessageStartEvent(markerMsgId, 'user', JSON.stringify(taskCompletedData), {
        ...(currentWindowMessageOptions ?? {}),
        isSystemGenerated: true,
        messageKind: 'task-completed',
      }))
      eventStore.append(sessionId, { type: 'message.done', data: { messageId: markerMsgId } })

      logger.debug('Pipeline executor complete', { sessionId, iterations })
      const doneAction: NextAction = { type: 'DONE' }
      return {
        finalAction: doneAction,
        iterations,
        totalTime: totalTimeSeconds,
      }
    }

    if (nextStepId === TERMINAL_BLOCKED) {
      sessionManager.setPhase(sessionId, 'blocked')

      const blockedCriteria = refreshedSession.criteria
        .filter(c => c.status.type === 'failed' &&
          c.attempts.filter(a => a.status === 'failed').length >= pipeline.settings.maxVerifyRetries)
        .map(c => c.id)
      const reason = blockedCriteria.length > 0
        ? `Retry limit reached for: ${blockedCriteria.join(', ')}`
        : 'No matching transition'

      const blockedMsgId = crypto.randomUUID()
      eventStore.append(sessionId, createMessageStartEvent(blockedMsgId, 'user', `Runner blocked: ${reason}`, {
        ...(currentWindowMessageOptions ?? {}),
        isSystemGenerated: true,
        messageKind: 'correction',
      }))
      eventStore.append(sessionId, { type: 'message.done', data: { messageId: blockedMsgId } })

      logger.warn('Pipeline executor blocked', { sessionId, iterations, reason })
      const blockedAction: NextAction = { type: 'BLOCKED', reason, blockedCriteria }
      return {
        finalAction: blockedAction,
        iterations,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }

    // Move to next step
    currentStepId = nextStepId
  }

  // Max iterations reached
  logger.warn('Pipeline executor max iterations reached', { sessionId, iterations })
  return {
    finalAction: { type: 'BLOCKED', reason: `Max iterations (${pipeline.settings.maxIterations}) reached`, blockedCriteria: [] },
    iterations,
    totalTime: (performance.now() - startTime) / 1000,
  }
}
