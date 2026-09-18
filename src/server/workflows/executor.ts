/**
 * Workflow Executor
 *
 * Walks a workflow state machine: evaluate current step, execute it,
 * evaluate transitions, move to next step. Repeats until a terminal
 * state ($done or $blocked) is reached.
 */

import type { ToolCall, ToolResult, UserStepChoice } from '../../shared/types.js'
import type { OrchestratorOptions, OrchestratorResult, NextAction } from '../runner/types.js'
import type {
  WorkflowDefinition,
  WorkflowStep,
  Transition,
  TransitionCondition,
  AgentStep,
  ParallelStep,
  SubAgentStep,
  ShellStep,
  UserStep,
} from './types.js'
import { TERMINAL_DONE, TERMINAL_BLOCKED } from './types.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { createChatMessageMessage } from '../ws/protocol.js'
import { runAgentTurn, TurnMetrics, createMessageStartEvent } from '../chat/orchestrator.js'
import { loadAllAgentsDefault, resolveDefaultAgentId } from '../agents/registry.js'
import { computeSessionStats } from '../../shared/stats.js'
import { formatGitDiffFiles } from '../git/diff.js'
import { aggregateParallel, mapPool, runChild, runShellChild, runSubAgentChild, type RunChildDeps } from './parallel.js'
import { resolveTemplate, type TemplateContext } from './template.js'
import { resolveLLMClientForAgent, buildAgentOverrideStatsIdentity } from '../agents/model-overrides.js'
import { logger } from '../utils/logger.js'
import { LLMError } from '../utils/errors.js'

// ============================================================================
// Template Variables
// ============================================================================

// TemplateContext, TEMPLATE_VARIABLES and resolveTemplate live in template.js
// (shared with the parallel child runners); re-exported so existing imports
// from this module keep working.
export { TEMPLATE_VARIABLES, resolveTemplate } from './template.js'
export type { TemplateContext } from './template.js'

export function formatCriteriaList(entries: import('../../shared/types.js').MetadataEntry[]): string {
  if (entries.length === 0) return '(none)'
  return entries
    .map((e) => {
      const status =
        e.status === 'passed'
          ? '[PASSED]'
          : e.status === 'completed'
            ? '[NEEDS VERIFICATION]'
            : e.status === 'failed'
              ? '[FAILED]'
              : '[NOT COMPLETED]'
      return `- **${e.id}** ${status}: ${e.description}`
    })
    .join('\n')
}

export async function formatModifiedFiles(workdir: string): Promise<string> {
  return formatGitDiffFiles(workdir)
}

// ============================================================================
// Transition Evaluation
// ============================================================================

export interface StepOutcome {
  result: string
  output: Record<string, string>
}

export function evaluateCondition(
  condition: TransitionCondition,
  stepOutcome: StepOutcome | null,
  metadataEntries?: Record<string, import('../../shared/types.js').MetadataEntry[]>,
): boolean {
  switch (condition.type) {
    case 'step_result':
      if (!stepOutcome) return false
      return stepOutcome.result === condition.result

    case 'metadata_all_match': {
      if (!metadataEntries) return false
      const entries = metadataEntries[condition.key]
      if (!entries || entries.length === 0) return true
      return entries.every((e) => e[condition.field] === condition.value)
    }

    case 'metadata_all_in': {
      if (!metadataEntries) return false
      const entries = metadataEntries[condition.key]
      if (!entries || entries.length === 0) return true
      return entries.every((e) => condition.values.includes(e[condition.field] as string))
    }

    case 'always':
      return true
  }
}

export function findMatchingTransition(
  transitions: Transition[],
  stepOutcome: StepOutcome | null,
  metadataEntries?: Record<string, import('../../shared/types.js').MetadataEntry[]>,
): Transition | null {
  for (const transition of transitions) {
    if (evaluateCondition(transition.when, stepOutcome, metadataEntries)) {
      return transition
    }
  }
  return null
}

export function evaluateTransitions(
  transitions: Transition[],
  stepOutcome: StepOutcome | null,
  metadataEntries?: Record<string, import('../../shared/types.js').MetadataEntry[]>,
): string {
  return findMatchingTransition(transitions, stepOutcome, metadataEntries)?.goto ?? TERMINAL_BLOCKED
}

// ============================================================================
// Step-Done Nudge
// ============================================================================

const STEP_DONE_NUDGE =
  "You haven't called step_done(). If you haven't finished the task, continue and when you're finished call step_done()"
const STEP_DONE_REMINDER = 'If you have finished the task, call step_done()'

/**
 * True when a step's transition condition is already satisfied — the first
 * matching transition would move the workflow away from the current step. In
 * that case there is nothing left to do but call step_done, so the verbose
 * "keep working" nudge should be skipped. A transition that loops back to the
 * current step (the usual `always` fallback) means work remains.
 */
export function isStepTransitionSatisfied(
  transitions: Transition[],
  metadataEntries: Record<string, import('../../shared/types.js').MetadataEntry[]>,
  currentStepId: string,
): boolean {
  const fired = findMatchingTransition(transitions, null, metadataEntries)
  return fired !== null && fired.goto !== currentStepId
}

/**
 * Build the reminder injected when an agent step loops back without calling
 * step_done. When the transition condition is already satisfied (e.g. all
 * criteria completed but step_done forgotten), the verbose nudgePrompt is
 * skipped and only a simple "call step_done" reminder is emitted.
 */
export function buildAgentNudge(
  nudgePrompt: string | undefined,
  templateCtx: TemplateContext,
  transitions: Transition[],
  metadataEntries: Record<string, import('../../shared/types.js').MetadataEntry[]>,
  currentStepId: string,
): string {
  const transitionSatisfied = isStepTransitionSatisfied(transitions, metadataEntries, currentStepId)
  const parts: string[] = []
  if (nudgePrompt && !transitionSatisfied) {
    parts.push(resolveTemplate(nudgePrompt, templateCtx))
  }
  parts.push(transitionSatisfied ? STEP_DONE_REMINDER : STEP_DONE_NUDGE)
  return parts.join('\n\n')
}

// ============================================================================
// User-Step Choices
// ============================================================================

/** Result value used when a user step resumes without an explicit choice (matches 'always'). */
export const DEFAULT_USER_RESULT = 'continue'
/** Id of the synthetic "Continue" choice derived from an 'always' transition. */
export const CONTINUE_CHOICE_ID = 'continue'

/**
 * Derive interactive choices from a user step's transitions.
 *
 * Each `step_result` transition becomes a choice button (its result string is
 * both the id and label). An `always` transition becomes a "Continue" choice.
 * Deduplicated by id, preserving transition order.
 */
export function userStepChoices(step: UserStep): UserStepChoice[] {
  const seen = new Set<string>()
  const choices: UserStepChoice[] = []
  for (const t of step.transitions) {
    if (t.when.type === 'step_result') {
      const id = t.when.result
      if (seen.has(id)) continue
      seen.add(id)
      choices.push({ id, label: id, goto: t.goto })
    } else if (t.when.type === 'always') {
      if (seen.has(CONTINUE_CHOICE_ID)) continue
      seen.add(CONTINUE_CHOICE_ID)
      choices.push({ id: CONTINUE_CHOICE_ID, label: 'Continue', goto: t.goto })
    }
  }
  return choices
}

// ============================================================================
// Helper
// ============================================================================

function emitWorkflowMessage(
  eventStore: ReturnType<typeof getEventStore>,
  sessionId: string,
  content: string,
  windowOptions: { contextWindowId: string } | undefined,
  onMessage: ((msg: ReturnType<typeof createChatMessageMessage>) => void) | undefined,
): string {
  const msgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(msgId, 'user', content, {
      ...(windowOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'correction',
      metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: msgId } })
  if (onMessage) {
    onMessage(
      createChatMessageMessage({
        id: msgId,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        isSystemGenerated: true,
        messageKind: 'correction',
        metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
      }),
    )
  }
  return msgId
}

/** Generic fallback kickoff for agent steps without a prompt. */
function injectGenericKickoff(sessionId: string): void {
  const eventStore = getEventStore()
  const windowOpts = getCurrentWindowMessageOptions(sessionId)
  const msgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(msgId, 'user', 'Proceed with the current step.', {
      ...(windowOpts ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: msgId } })
}

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

export function buildReason(metadataEntries?: Record<string, import('../../shared/types.js').MetadataEntry[]>): string {
  const entries = metadataEntries?.['criteria'] ?? []
  const remaining = entries.filter((e) => e.status !== 'passed')
  return `${remaining.length} criteria remaining`
}

/** Build the RunChildDeps shared by the top-level sub_agent and shell step cases */
function buildStepChildDeps(
  options: OrchestratorOptions,
  templateCtx: TemplateContext,
  eventStore: ReturnType<typeof getEventStore>,
  windowOptions: { contextWindowId: string } | undefined,
): RunChildDeps {
  const { sessionManager, sessionId, llmClient, statsIdentity, signal, onMessage } = options
  return {
    sessionManager,
    sessionId,
    llmClient,
    ctx: templateCtx,
    ...(signal ? { signal } : {}),
    ...(onMessage ? { onMessage } : {}),
    ...(statsIdentity !== undefined ? { statsIdentity } : {}),
    eventStore,
    windowOptions,
  }
}

// ============================================================================
// Executor
// ============================================================================

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  options: OrchestratorOptions,
  subGroup?: string,
): Promise<OrchestratorResult> {
  const { sessionManager, sessionId, llmClient, signal, onMessage } = options
  const eventStore = getEventStore()
  const startTime = performance.now()
  let iterations = 0

  // Filter to sub-group if specified
  const activeSteps = subGroup ? workflow.steps.filter((s) => s.subGroup === subGroup) : workflow.steps

  // Resume support: if resuming from a user step, start from that step with accumulated output
  const resumeFromStep = options.resumeFromStep
  const isResume = !!resumeFromStep
  // Tracks whether we've already done the "skip prompt/nudge because we're resuming"
  // for this resume. After the first resumed runAgentTurn completes, this flips to
  // true so subsequent iterations of the same step get the nudge.
  let resumeConsumed = false
  let currentStepId = isResume
    ? resumeFromStep
    : subGroup
      ? (activeSteps[0]?.id ?? workflow.entryStep)
      : workflow.entryStep
  let lastStepOutput: Record<string, string> = options.initialStepOutput ?? {}
  const firstEntryForStep = new Set<string>()

  // Snapshot message count so we can compute workflow-scoped stats (not session-wide)
  const messagesBeforeWorkflow = sessionManager.requireSession(sessionId).messages.length

  const activeStepIds = new Set(activeSteps.map((s) => s.id))
  // Sub-groups whose tagged transitions are eligible in this slice run. Starts
  // with the running slice; each escape into another sub-group adds its tag.
  const activeSubGroups = new Set<string>()
  if (subGroup) {
    activeSubGroups.add(subGroup)
  }
  // Map every step so transitions escaping a sub-group slice (see transition
  // evaluation below) can resolve steps outside the active slice.
  const stepsById = new Map<string, WorkflowStep>()
  for (const step of workflow.steps) {
    stepsById.set(step.id, step)
  }

  // Validate resume target: must exist in the workflow
  if (resumeFromStep) {
    const targetStep = stepsById.get(resumeFromStep)
    if (!targetStep) {
      return {
        finalAction: {
          type: 'BLOCKED',
          reason: `Resume target step "${resumeFromStep}" not found in workflow "${workflow.metadata.id}"`,
          blockedCriteria: [],
        },
        iterations: 0,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }
  }

  logger.debug('Workflow executor starting', { sessionId, workflow: workflow.metadata.id })

  // Resolve the workflow execution id up-front so early failures (e.g. start
  // condition) can be marked blocked even on resume. On fresh starts it stays
  // undefined until the marker is emitted below.
  let executionId: string | undefined
  if (isResume) {
    const activeExec = sessionManager.getActiveWorkflowExecution(sessionId)
    if (activeExec) {
      executionId = activeExec.id
    }
  }

  // Evaluate start condition if present
  if (workflow.startCondition && workflow.startCondition.type !== 'always') {
    const session = sessionManager.requireSession(sessionId)
    const conditionMet = evaluateCondition(
      workflow.startCondition as TransitionCondition,
      null,
      session.metadataEntries,
    )
    if (!conditionMet) {
      logger.debug('Workflow start condition not met', { sessionId, condition: workflow.startCondition.type })
      return {
        finalAction: {
          type: 'BLOCKED',
          reason: `Start condition not met: ${workflow.startCondition.type}`,
          blockedCriteria: [],
        },
        iterations: 0,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }
  }

  // Emit workflow-started marker into the feed (skip on resume)
  if (!isResume) {
    const startMsgId = crypto.randomUUID()
    const startWindowOpts = getCurrentWindowMessageOptions(sessionId)
    eventStore.append(
      sessionId,
      createMessageStartEvent(
        startMsgId,
        'user',
        JSON.stringify({
          workflowName: workflow.metadata.name,
          workflowId: workflow.metadata.id,
          workflowColor: workflow.metadata.color,
        }),
        { ...(startWindowOpts ?? {}), isSystemGenerated: true, messageKind: 'workflow-started' },
      ),
    )
    eventStore.append(sessionId, { type: 'message.done', data: { messageId: startMsgId } })

    // Create workflow execution record
    executionId = crypto.randomUUID()
    sessionManager.startWorkflow(
      sessionId,
      executionId,
      workflow.metadata.id,
      workflow.metadata.name,
      workflow.metadata.color,
      options.params ?? {},
      subGroup,
    )
  }

  // Inject user-provided message on resume too (e.g. after abort, user types guidance)
  if (options.userMessage) {
    sessionManager.addMessage(sessionId, {
      role: 'user',
      content: options.userMessage.content,
      ...(options.userMessage.attachments ? { attachments: options.userMessage.attachments } : {}),
    })
  }

  while (iterations < workflow.settings.maxIterations) {
    // Check abort — don't cancel the workflow, just stop the current turn.
    // The workflow execution stays in the DB with status 'running' so the
    // user can continue by sending a message (auto-resume in sendMessage).
    if (signal?.aborted) {
      logger.debug('Workflow executor aborted — preserving execution', { sessionId, iterations })
      return {
        finalAction: { type: 'RUN_BUILDER', reason: 'Aborted' },
        iterations,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }

    iterations++

    const step = stepsById.get(currentStepId)
    if (!step) {
      logger.error('Workflow step not found', { sessionId, stepId: currentStepId })
      return {
        finalAction: { type: 'BLOCKED', reason: `Step "${currentStepId}" not found in workflow`, blockedCriteria: [] },
        iterations,
        totalTime: (performance.now() - startTime) / 1000,
      }
    }

    const session = sessionManager.requireSession(sessionId)
    const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

    // Build template context
    const criteriaEntries = session.metadataEntries['criteria'] ?? []
    const templateCtx: TemplateContext = {
      workdir: sessionManager.getEffectiveWorkdir(sessionId),
      reason: buildReason(session.metadataEntries),
      verifierFindings: lastStepOutput['content'] ?? '',
      previousStepOutput: lastStepOutput['stdout'] ?? '',
      criteriaCount: criteriaEntries.length,
      pendingCount: criteriaEntries.filter((e) => e.status !== 'passed').length,
      criteriaList: formatCriteriaList(criteriaEntries),
      modifiedFiles: await formatModifiedFiles(sessionManager.getEffectiveWorkdir(sessionId)),
      stepOutput: lastStepOutput,
      params: options.params ?? {},
    }

    // Set session phase
    sessionManager.setPhase(sessionId, step.phase as 'build' | 'verification' | 'waiting' | 'blocked' | 'done')

    // Track current step in workflow execution
    if (executionId) {
      sessionManager.updateWorkflowStep(
        sessionId,
        executionId,
        step.id,
        step.name,
        workflow.metadata.id,
        workflow.metadata.name,
        workflow.metadata.color,
      )
    }

    // Set session mode to match agent step's agentId
    if (step.type === 'agent') {
      const agentStep = step as AgentStep
      sessionManager.setMode(sessionId, agentStep.agentId ?? resolveDefaultAgentId())
    }

    logger.debug('Workflow step executing', { sessionId, iteration: iterations, stepId: step.id, stepType: step.type })

    let stepOutcome: StepOutcome | null = null

    // Execute step
    switch (step.type) {
      case 'agent': {
        const agentStep = step as AgentStep
        const STEP_DONE_PROMPT = "\n\nOnce you're done, call step_done()"

        // When resuming from the same step after abort, skip re-injecting the
        // prompt or nudge — the agent already knows what step it's in and the
        // user's message (which triggered the resume) is already in context.
        // LLM-failure retries happen inside streamLLMPure, so the prompt +
        // reminder stay in history untouched and are never re-injected.
        const isResumingCurrentStep = isResume && step.id === resumeFromStep && !resumeConsumed

        // Build prompt content
        let promptContent: string | null
        let nudgeContent: string | null

        if (!firstEntryForStep.has(step.id) && agentStep.prompt && !isResumingCurrentStep) {
          const resolvedPrompt = resolveTemplate(agentStep.prompt, templateCtx)
          promptContent = resolvedPrompt + STEP_DONE_PROMPT
          const promptMsgId = crypto.randomUUID()
          const msgMetadata = { type: 'workflow', name: 'Workflow', color: '#f59e0b' }
          eventStore.append(
            sessionId,
            createMessageStartEvent(promptMsgId, 'user', promptContent, {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'auto-prompt',
              metadata: msgMetadata,
            }),
          )
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: promptMsgId } })
          if (onMessage) {
            onMessage(
              createChatMessageMessage({
                id: promptMsgId,
                role: 'user',
                content: promptContent,
                timestamp: new Date().toISOString(),
                isSystemGenerated: true,
                messageKind: 'auto-prompt',
                metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
              }),
            )
          }
        } else if (firstEntryForStep.has(step.id) && !isResumingCurrentStep) {
          // Build nudge: if the transition condition is already satisfied (e.g.
          // all criteria completed but step_done forgotten), only remind to call
          // step_done instead of the verbose keep-working nudgePrompt.
          nudgeContent = buildAgentNudge(
            agentStep.nudgePrompt,
            templateCtx,
            step.transitions,
            session.metadataEntries,
            step.id,
          )

          emitWorkflowMessage(eventStore, sessionId, nudgeContent, currentWindowMessageOptions, onMessage)
        }

        // Block the execution when the LLM retry window is exhausted. Nothing
        // is rolled back: failed attempts were buffered in streamLLMPure and
        // never touched history. The step prompt stays in place so a user
        // retry (resume) reuses the exact same context.
        const blockOnLLMFailure = (errorMessage: string): OrchestratorResult => {
          sessionManager.setPhase(sessionId, 'blocked')
          if (executionId) {
            sessionManager.blockWorkflow(
              sessionId,
              executionId,
              workflow.metadata.id,
              workflow.metadata.name,
              workflow.metadata.color,
            )
          }
          const reason = `Step "${step.name}" failed: ${errorMessage}`
          return {
            finalAction: { type: 'BLOCKED', reason, blockedCriteria: [] },
            iterations,
            totalTime: (performance.now() - startTime) / 1000,
          }
        }

        const turnMetrics = new TurnMetrics()
        const es = getEventStore()
        const append = (event: import('../events/types.js').TurnEvent) => es.append(sessionId, event)

        let stepDoneCalled = false

        // Resolve the step's model: a per-agent override (e.g. builder-3.8-27b
        // pinned to qwen) wins over the session client — mirrors the sub-agent
        // path. Without an override the session client is used as before.
        const stepAgentId = agentStep.agentId ?? resolveDefaultAgentId()
        const effectiveProviderManager = sessionManager.getProviderManager?.()
        let stepLlmClient = llmClient
        let stepStatsIdentity = options.statsIdentity
        let stepGetSessionLLMClient = options.getSessionLLMClient
        if (effectiveProviderManager) {
          const pinnedEffort = session.providerPinnedEffort ?? undefined
          const resolved = resolveLLMClientForAgent(stepAgentId, llmClient, effectiveProviderManager, pinnedEffort)
          if (resolved.usedOverride && resolved.override) {
            stepLlmClient = resolved.client
            stepStatsIdentity = buildAgentOverrideStatsIdentity(
              effectiveProviderManager,
              resolved.client,
              resolved.override,
            )
            // Keep retries on the override client instead of the session client
            stepGetSessionLLMClient = undefined
          } else if (resolved.warning) {
            logger.warn('Agent step model override unavailable, falling back', {
              agentId: stepAgentId,
              warning: resolved.warning,
            })
          }
        }

        let agentResult: Awaited<ReturnType<typeof runAgentTurn>>
        try {
          agentResult = await runAgentTurn(
            {
              sessionManager,
              sessionId,
              llmClient: stepLlmClient,
              ...(stepGetSessionLLMClient ? { getSessionLLMClient: stepGetSessionLLMClient } : {}),
              ...(stepStatsIdentity ? { statsIdentity: stepStatsIdentity } : {}),
              ...(signal ? { signal } : {}),
              ...(onMessage ? { onMessage } : {}),
              ...(options.llmRetryPolicy ? { llmRetryPolicy: options.llmRetryPolicy } : {}),
              ...(isResumingCurrentStep ? { skipAgentReminder: true } : {}),
            },
            turnMetrics,
            stepAgentId,
            append,
            {
              ...(!firstEntryForStep.has(step.id) && !agentStep.prompt && !isResumingCurrentStep
                ? { injectKickoff: () => injectGenericKickoff(sessionId) }
                : {}),
              onToolExecuted: (toolCall: ToolCall, toolResult: ToolResult) => {
                // Also detected in execute-tools.ts (stepDoneCalled flag) to break
                // the agent loop immediately. This layer handles workflow orchestration
                // (transition evaluation) after the agent turn returns.
                if (toolCall.name === 'step_done' && toolResult.success) {
                  stepDoneCalled = true
                }
              },
            },
          )
        } catch (error) {
          // Controlled aborts are not failures — let them propagate as before.
          if (error instanceof Error && error.message === 'Aborted') {
            throw error
          }
          // A thrown LLMError means the retry window was exhausted (transient
          // failures are retried inside the stream layer). Unexpected internal
          // errors propagate as before instead of being masked.
          if (!(error instanceof LLMError)) {
            throw error
          }
          return blockOnLLMFailure(error.message)
        }

        // Soft LLM failure (retry window exhausted in streamLLMPure) — block
        // the execution so the user can retry the step on demand.
        if (agentResult.failed) {
          return blockOnLLMFailure(agentResult.failed.error)
        }

        firstEntryForStep.add(step.id)
        // After the first resumed turn completes, mark resume as consumed so
        // subsequent iterations of this step get the nudge if step_done wasn't called.
        resumeConsumed = true
        const agentReturnValue = agentResult.returnValueResult ?? 'completed'
        lastStepOutput = {
          ...(agentResult.returnValueContent ? { content: agentResult.returnValueContent } : {}),
          ...(agentResult.returnValueResult ? { result: agentResult.returnValueResult } : {}),
          stepDoneCalled: String(stepDoneCalled),
        }
        stepOutcome = { result: agentReturnValue, output: lastStepOutput }

        // If step_done was not called, loop back to continue the agent step
        if (!stepDoneCalled) {
          logger.debug('step_done not called, looping agent step', {
            sessionId,
            stepId: step.id,
            iteration: iterations,
          })
          continue
        }

        break
      }

      case 'sub_agent': {
        const subStep = step as SubAgentStep
        const outcome = await runSubAgentChild(
          subStep,
          buildStepChildDeps(options, templateCtx, eventStore, currentWindowMessageOptions),
        )
        lastStepOutput = outcome.output
        stepOutcome = { result: outcome.result, output: lastStepOutput }
        break
      }

      case 'shell': {
        const shellStep = step as ShellStep
        const outcome = await runShellChild(
          shellStep,
          buildStepChildDeps(options, templateCtx, eventStore, currentWindowMessageOptions),
        )
        lastStepOutput = outcome.output
        stepOutcome = { result: outcome.result, output: lastStepOutput }
        break
      }

      case 'parallel': {
        const parallelStep = step as ParallelStep
        if (parallelStep.children.length === 0) {
          logger.warn('Parallel step has no children', { sessionId, stepId: step.id })
        }
        const childIds = parallelStep.children.map((c) => c.id)
        if (new Set(childIds).size !== childIds.length) {
          logger.warn('Parallel step has duplicate child ids', { sessionId, stepId: step.id, ids: childIds })
        }
        const allAgents = await loadAllAgentsDefault(sessionManager.getProjectWorkdir(sessionId))
        const baseDeps: RunChildDeps = {
          sessionManager,
          sessionId,
          llmClient,
          ctx: templateCtx,
          ...(signal ? { signal } : {}),
          ...(onMessage ? { onMessage } : {}),
          eventStore,
          windowOptions: currentWindowMessageOptions,
          statsIdentity: options.statsIdentity ?? {
            providerId: '',
            providerName: '',
            backend: 'unknown',
            model: llmClient.getModel(),
          },
          agents: allAgents,
        }
        const limit = Math.min(
          Math.max(Math.floor(parallelStep.maxConcurrency ?? parallelStep.children.length), 1),
          parallelStep.children.length,
        )
        const outcomes = await mapPool(parallelStep.children, limit, (child) =>
          runChild(child, { ...baseDeps, label: child.id }),
        )
        const aggregate = aggregateParallel(outcomes)
        lastStepOutput = aggregate.output
        stepOutcome = { result: aggregate.result, output: lastStepOutput }
        break
      }

      case 'user': {
        // On resume for THIS specific step, route by the user's choice
        if (resumeFromStep === step.id) {
          const choice = options.userChoice
          const result = choice === undefined || choice === CONTINUE_CHOICE_ID ? DEFAULT_USER_RESULT : choice
          stepOutcome = { result, output: lastStepOutput }
          break
        }

        // Pause workflow execution — frontend shows choice/Continue buttons
        if (executionId) {
          const choices = userStepChoices(step).map((choice) => {
            const target = choice.goto ? stepsById.get(choice.goto) : undefined
            return target ? { ...choice, nextStepName: target.name } : choice
          })
          sessionManager.waitAtStep(
            sessionId,
            executionId,
            step.id,
            step.name,
            lastStepOutput,
            workflow.metadata.id,
            workflow.metadata.name,
            workflow.metadata.color,
            choices,
          )
        }

        logger.debug('Workflow paused at user step', { sessionId, stepId: step.id, stepName: step.name })

        return {
          finalAction: {
            type: 'WAITING',
            reason: `Paused at user step: ${step.name}`,
            workflowId: workflow.metadata.id,
            stepId: step.id,
            stepOutput: lastStepOutput,
          },
          iterations,
          totalTime: (performance.now() - startTime) / 1000,
        }
      }
    }

    // Evaluate transitions. In a slice run, only untagged transitions and
    // transitions tagged with an entered sub-group are candidates; on full runs
    // every transition applies.
    const refreshedSession = sessionManager.requireSession(sessionId)
    const candidates = subGroup
      ? step.transitions.filter((t) => !t.subGroup || activeSubGroups.has(t.subGroup))
      : step.transitions
    const fired = findMatchingTransition(candidates, stepOutcome, refreshedSession.metadataEntries)
    let nextStepId = fired ? fired.goto : TERMINAL_BLOCKED

    // When running a sub-group, a transition leaving the active set either:
    // - escapes (tagged with an entered sub-group): the target step is pulled
    //   into the slice and executes, enabling loops across sub-groups; or
    // - clamps to $done (untagged or tagged with a sub-group never entered).
    if (subGroup && nextStepId !== TERMINAL_DONE && nextStepId !== TERMINAL_BLOCKED && !activeStepIds.has(nextStepId)) {
      if (fired && fired.subGroup && activeSubGroups.has(fired.subGroup)) {
        activeStepIds.add(nextStepId)
        const targetStep = stepsById.get(nextStepId)
        if (targetStep?.subGroup) {
          activeSubGroups.add(targetStep.subGroup)
        }
      } else {
        nextStepId = TERMINAL_DONE
      }
    }

    // Handle terminal states
    if (nextStepId === TERMINAL_DONE) {
      sessionManager.setPhase(sessionId, 'done')

      // Clean up workflow execution
      if (executionId) {
        sessionManager.completeWorkflow(
          sessionId,
          executionId,
          workflow.metadata.id,
          workflow.metadata.name,
          workflow.metadata.color,
        )
      }

      const totalTimeSeconds = Math.round((performance.now() - startTime) / 100) / 10
      const completedSession = sessionManager.requireSession(sessionId)
      // Only aggregate stats for messages created during this workflow run
      const workflowMessages = completedSession.messages.slice(messagesBeforeWorkflow)
      const workflowStats = computeSessionStats(workflowMessages)
      const totalToolCalls = workflowMessages.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0)
      const taskCompletedData = {
        summary: null,
        iterations,
        totalTimeSeconds,
        totalToolCalls,
        totalTokensGenerated: workflowStats?.generationTokens ?? 0,
        avgGenerationSpeed: workflowStats?.avgGenerationSpeed ?? 0,
        responseCount: workflowStats?.responseCount ?? 0,
        llmCallCount: workflowStats?.llmCallCount ?? 0,
        criteria: [] as Array<{ id: string; description: string; status: string }>,
        workflowName: workflow.metadata.name,
        workflowId: workflow.metadata.id,
        ...(workflow.metadata.color ? { workflowColor: workflow.metadata.color } : {}),
      }
      eventStore.append(sessionId, { type: 'task.completed', data: taskCompletedData })

      const markerMsgId = crypto.randomUUID()
      eventStore.append(
        sessionId,
        createMessageStartEvent(markerMsgId, 'user', JSON.stringify(taskCompletedData), {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'task-completed',
        }),
      )
      eventStore.append(sessionId, { type: 'message.done', data: { messageId: markerMsgId } })

      logger.debug('Workflow executor complete', { sessionId, iterations })
      const doneAction: NextAction = { type: 'DONE' }
      return {
        finalAction: doneAction,
        iterations,
        totalTime: totalTimeSeconds,
      }
    }

    if (nextStepId === TERMINAL_BLOCKED) {
      sessionManager.setPhase(sessionId, 'blocked')

      // Clean up workflow execution
      if (executionId) {
        sessionManager.blockWorkflow(
          sessionId,
          executionId,
          workflow.metadata.id,
          workflow.metadata.name,
          workflow.metadata.color,
        )
      }

      const reason = 'No matching transition'

      emitWorkflowMessage(eventStore, sessionId, `Runner blocked: ${reason}`, currentWindowMessageOptions, onMessage)

      logger.warn('Workflow executor blocked', { sessionId, iterations, reason })
      const blockedAction: NextAction = { type: 'BLOCKED', reason, blockedCriteria: [] }
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
  logger.warn('Workflow executor max iterations reached', { sessionId, iterations })
  return {
    finalAction: {
      type: 'BLOCKED',
      reason: `Max iterations (${workflow.settings.maxIterations}) reached`,
      blockedCriteria: [],
    },
    iterations,
    totalTime: (performance.now() - startTime) / 1000,
  }
}
