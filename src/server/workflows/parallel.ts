/**
 * Workflow Parallel Step
 *
 * Machinery for `parallel` steps: a bounded-concurrency pool (mapPool), the
 * result aggregator (aggregateParallel), and the child runners shared between
 * top-level sub_agent/shell steps and parallel children.
 */

import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { StatsIdentity } from '../../shared/types.js'
import type { AgentDefinition } from '../agents/types.js'
import { getEventStore } from '../events/index.js'
import { createMessageStartEvent, TurnMetrics } from '../chat/orchestrator.js'
import { createChatMessageMessage } from '../ws/protocol.js'
import { executeSubAgent } from '../sub-agents/manager.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { getToolRegistryForAgent } from '../tools/index.js'
import { executeShellCommand } from './shell.js'
import { serverT } from '../i18n.js'
import { logger } from '../utils/logger.js'
import { resolveTemplate, type TemplateContext } from './template.js'
import type { ParallelChildStep, SubAgentChildStep, ShellChildStep } from './types.js'

// ============================================================================
// Concurrency pool
// ============================================================================

/**
 * Run `task` over every item with at most `limit` tasks in flight at once.
 * Results preserve input order. All tasks are allowed to settle before the
 * first error is rethrown (all-settled semantics), so an aborted or failed
 * child never leaves its siblings as unhandled rejections.
 */
export async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let firstError: unknown = null
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = await task(items[index]!)
      } catch (error) {
        if (firstError === null) {
          firstError = error
        }
      }
    }
  })
  await Promise.all(workers)
  if (firstError !== null) {
    throw firstError
  }
  return results
}

// ============================================================================
// Result aggregation
// ============================================================================

/** Outcome of one child execution */
export interface ChildOutcome {
  id: string
  /** e.g. 'success', 'failure', 'error', or the sub-agent's custom result */
  result: string
  /** Child-type output keys (stdout/stderr/exitCode, content, error, …) */
  output: Record<string, string>
}

/**
 * Aggregate child outcomes into the parent step outcome:
 * - all children `success` → `success`
 * - no child `success`     → `failure`
 * - mixed                  → `partial`
 * - no children            → `failure`
 *
 * The output map is flat with dotted per-child keys: `result`, `summary`
 * (one line per child), `<childId>.result`, and `<childId>.<key>` for each of
 * the child's own output keys.
 */
export function aggregateParallel(outcomes: ChildOutcome[]): { result: string; output: Record<string, string> } {
  const successCount = outcomes.filter((o) => o.result === 'success').length
  const result =
    outcomes.length === 0
      ? 'failure'
      : successCount === outcomes.length
        ? 'success'
        : successCount === 0
          ? 'failure'
          : 'partial'
  const output: Record<string, string> = {
    result,
    summary: outcomes.map((o) => `- ${o.id}: ${o.result}`).join('\n'),
  }
  for (const o of outcomes) {
    output[`${o.id}.result`] = o.result
    for (const [key, value] of Object.entries(o.output)) {
      output[`${o.id}.${key}`] = value
    }
  }
  return { result, output }
}

// ============================================================================
// Child runners (shared by top-level steps and parallel children)
// ============================================================================

export interface RunChildDeps {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  /** Template context — children resolve prompts/commands against the pre-run context */
  ctx: TemplateContext
  /** Label for chat messages (the child id inside a parallel step; omitted at top level) */
  label?: string
  signal?: AbortSignal
  onMessage?: (msg: ServerMessage) => void
  eventStore: ReturnType<typeof getEventStore>
  windowOptions: { contextWindowId: string } | undefined
  statsIdentity?: StatsIdentity
  /** Agents loaded once per step/parallel run; loaded when omitted */
  agents?: AgentDefinition[]
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Aborted'
}

function failureOutcome(id: string, error: unknown): ChildOutcome {
  const message = error instanceof Error ? error.message : String(error)
  logger.warn('Workflow child step failed', { child: id, error: message })
  return { id, result: 'failure', output: { error: message } }
}

/**
 * Run a sub_agent child. Returns the sub-agent's result (or 'success' when
 * absent). An unknown sub-agent type yields result 'error'; any other thrown
 * error (e.g. an exhausted LLM retry window) yields result 'failure' with the
 * message in `output.error`. 'Aborted' propagates so the workflow's abort
 * contract is preserved.
 */
export async function runSubAgentChild(child: SubAgentChildStep, deps: RunChildDeps): Promise<ChildOutcome> {
  const { sessionManager, sessionId, llmClient, ctx, signal, onMessage } = deps
  try {
    const turnMetrics = new TurnMetrics()

    const promptTemplate = child.prompt ?? 'Perform your task.'
    const resolvedPrompt = resolveTemplate(promptTemplate, ctx)

    const allAgents = deps.agents ?? (await loadAllAgentsDefault(sessionManager.getProjectWorkdir(sessionId)))
    const agentDef = findAgentById(child.subAgentType, allAgents)
    if (!agentDef) {
      logger.error('Sub-agent definition not found', { subAgentType: child.subAgentType })
      return { id: child.id, result: 'error', output: { error: `Unknown sub-agent type: ${child.subAgentType}` } }
    }

    const toolRegistry = getToolRegistryForAgent(agentDef)
    // Filter out step_done tool from sub-agents (it's workflow-executor-only)
    const filteredToolRegistry = {
      tools: toolRegistry.tools.filter((t) => t.name !== 'step_done'),
      definitions: toolRegistry.definitions.filter((d) => d.type === 'function' && d.function.name !== 'step_done'),
      execute: toolRegistry.execute,
    }

    const result = await executeSubAgent({
      subAgentType: child.subAgentType,
      prompt: resolvedPrompt,
      sessionManager,
      sessionId,
      llmClient,
      toolRegistry: filteredToolRegistry,
      turnMetrics,
      providerManager: sessionManager.getProviderManager?.(),
      statsIdentity: deps.statsIdentity ?? {
        providerId: '',
        providerName: '',
        backend: 'unknown',
        model: llmClient.getModel(),
      },
      ...(signal ? { signal } : {}),
      ...(onMessage ? { onMessage } : {}),
    })

    return {
      id: child.id,
      result: result.result ?? 'success',
      output: { content: result.content ?? '', ...(result.result ? { result: result.result } : {}) },
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return failureOutcome(child.id, error)
  }
}

/**
 * Run a shell child. Resolves with 'success'/'failure' from the exit code;
 * an aborted signal rejects with 'Aborted' (workflow abort contract).
 */
export async function runShellChild(child: ShellChildStep, deps: RunChildDeps): Promise<ChildOutcome> {
  const { sessionManager, sessionId, ctx, label, signal, onMessage, eventStore, windowOptions } = deps
  if (child.command === undefined) {
    logger.warn('Shell child has no command', { child: child.id })
    return { id: child.id, result: 'error', output: { error: 'Missing command' } }
  }
  const command = resolveTemplate(child.command, ctx)
  const timeout = child.timeout ?? 60_000
  const successCodes = child.successExitCodes ?? [0]

  const runningContent = label
    ? serverT(
        { en: 'Running ({{label}}): `{{command}}`', fr: 'Exécution ({{label}}) : `{{command}}`' },
        { label, command },
      )
    : serverT({ en: 'Running: `{{command}}`', fr: 'Exécution : `{{command}}`' }, { command })
  const shellMsgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(shellMsgId, 'user', runningContent, {
      ...(windowOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
    }),
  )
  if (onMessage) {
    onMessage(
      createChatMessageMessage({
        id: shellMsgId,
        role: 'user',
        content: runningContent,
        timestamp: new Date().toISOString(),
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
      }),
    )
  }

  const result = await executeShellCommand(command, sessionManager.getEffectiveWorkdir(sessionId), timeout, signal)

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  const outputContent = output
    ? label
      ? serverT(
          {
            en: 'Exit code ({{label}}): {{code}}\n```\n{{output}}\n```',
            fr: 'Code de sortie ({{label}}) : {{code}}\n```\n{{output}}\n```',
          },
          { label, code: result.exitCode, output: output.slice(0, 10000) },
        )
      : serverT(
          { en: 'Exit code: {{code}}\n```\n{{output}}\n```', fr: 'Code de sortie : {{code}}\n```\n{{output}}\n```' },
          { code: result.exitCode, output: output.slice(0, 10000) },
        )
    : label
      ? serverT(
          { en: 'Exit code ({{label}}): {{code}}', fr: 'Code de sortie ({{label}}) : {{code}}' },
          { label, code: result.exitCode },
        )
      : serverT({ en: 'Exit code: {{code}}', fr: 'Code de sortie : {{code}}' }, { code: result.exitCode })
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: shellMsgId } })

  const outputMsgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(outputMsgId, 'user', outputContent, {
      ...(windowOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'correction',
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: outputMsgId } })
  if (onMessage) {
    onMessage(
      createChatMessageMessage({
        id: outputMsgId,
        role: 'user',
        content: outputContent,
        timestamp: new Date().toISOString(),
        isSystemGenerated: true,
        messageKind: 'correction',
      }),
    )
  }

  return {
    id: child.id,
    result: successCodes.includes(result.exitCode) ? 'success' : 'failure',
    output: { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: String(result.exitCode) },
  }
}

/** Dispatch a child by type */
export async function runChild(child: ParallelChildStep, deps: RunChildDeps): Promise<ChildOutcome> {
  return child.type === 'sub_agent' ? runSubAgentChild(child, deps) : runShellChild(child, deps)
}
