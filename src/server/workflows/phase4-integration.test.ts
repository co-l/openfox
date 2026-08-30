/**
 * Phase 4 — end-to-end composition of the "dream" workflow.
 *
 * Proves the three phases compose in one executeWorkflow run:
 *  - Phase 1/2: the step's resolved LLM client (per-step/team override) is
 *    what the orchestrator uses to route. Here sessionManager.createClientForAgent
 *    stands in for the team/step resolver and returns a distinct "team" client.
 *  - Phase 3: the `llm_decision` transition handler asks THAT client which step
 *    is next and fires only the matching transition.
 *
 * The session LLM client is a different mock; asserting it is NEVER called for
 * the routing decision proves the orchestrator is the step-resolved model, not
 * the session model — "which LLM orchestrates" is configurable per step.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkflowDefinition } from './types.js'
import type { OrchestratorOptions } from '../runner/types.js'
import type { LLMCompletionResponse } from '../llm/types.js'
import { TransitionHandlerRegistry } from './transition-handlers.js'
import { createLlmDecisionHandler, __resetLlmDecisionCache } from './llm-decision-handler.js'

// ============================================================================
// Module mocks (same shape as executor-mode.test.ts; jscpd ignores test files)
// ============================================================================

vi.mock('../events/index.js', () => ({
  getEventStore: () => ({
    append: vi.fn(),
    getLatestSeq: vi.fn(() => 0),
    getEvents: vi.fn(() => []),
    deleteEventsAfterSeq: vi.fn(),
  }),
  getCurrentContextWindowId: vi.fn(() => undefined),
}))

const { runAgentTurnMock } = vi.hoisted(() => ({
  runAgentTurnMock: vi.fn(
    async (
      _opts: unknown,
      _metrics: unknown,
      _agentId: string,
      _append: unknown,
      extra:
        | {
            onToolExecuted?: (
              tc: { name: string; arguments: unknown },
              tr: { success: boolean; output: string },
            ) => void
          }
        | undefined,
    ) => {
      // Every agent step calls step_done so the step completes and transitions run.
      extra?.onToolExecuted?.({ name: 'step_done', arguments: {} }, { success: true, output: '' })
      return { returnValueResult: 'completed', returnValueContent: '' }
    },
  ),
}))

vi.mock('../chat/orchestrator.js', () => ({
  runAgentTurn: runAgentTurnMock,
  createMessageStartEvent: vi.fn(() => ({ type: 'message.start', data: {} })),
  TurnMetrics: class {
    start = vi.fn()
    end = vi.fn()
    getMetrics = vi.fn(() => ({ durationMs: 0, tokenCount: 0 }))
  },
}))

vi.mock('../sub-agents/manager.js', () => ({
  executeSubAgent: vi.fn(async () => ({ content: '', result: 'success' })),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => []),
  findAgentById: vi.fn(() => undefined),
  resolveDefaultAgentId: vi.fn(() => 'planner'),
}))

vi.mock('../tools/index.js', () => ({
  getToolRegistryForAgent: vi.fn(() => ({ tools: [], definitions: [], execute: vi.fn() })),
}))

vi.mock('./shell.js', () => ({
  executeShellCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../shared/stats.js', () => ({
  computeSessionStats: vi.fn(() => ({ generationTokens: 0, avgGenerationSpeed: 0, responseCount: 0, llmCallCount: 0 })),
}))

vi.mock('../git/diff.js', () => ({
  formatGitDiffFiles: vi.fn(async () => '(none)'),
}))

import { executeWorkflow } from './executor.js'

// ============================================================================
// Fixtures
// ============================================================================

const CANDIDATES = [
  { goto: 'build', label: 'Retry build', description: 'Tests failed, rebuild' },
  { goto: 'review', label: 'Send to review', description: 'Build passed, review it' },
  { goto: '$done', label: 'Finish', description: 'Nothing left' },
]

function workflow(): WorkflowDefinition {
  return {
    metadata: { id: 'dream', name: 'Dream', description: '', version: '1' },
    entryStep: 'verify',
    settings: { maxIterations: 10 },
    steps: [
      {
        id: 'verify',
        name: 'Verifier',
        type: 'agent',
        phase: 'verification',
        agentId: 'verifier',
        prompt: 'Verify the build.',
        transitions: [
          {
            when: { type: 'custom', handler: 'llm_decision', config: { candidates: CANDIDATES, thisGoto: 'review' } },
            goto: 'review',
          },
          {
            when: { type: 'custom', handler: 'llm_decision', config: { candidates: CANDIDATES, thisGoto: 'build' } },
            goto: 'build',
          },
          { when: { type: 'always' }, goto: '$done' },
        ],
      },
      {
        id: 'review',
        name: 'Reviewer',
        type: 'agent',
        phase: 'review',
        agentId: 'reviewer',
        prompt: 'Review the code.',
        transitions: [{ when: { type: 'always' }, goto: '$done' }],
      },
      {
        id: 'build',
        name: 'Builder',
        type: 'agent',
        phase: 'build',
        agentId: 'builder',
        prompt: 'Rebuild.',
        transitions: [{ when: { type: 'always' }, goto: '$done' }],
      },
    ],
  }
}

describe('Phase 4 — dream workflow composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetLlmDecisionCache()
  })

  it('routes via the step-resolved (team) LLM client, not the session client', async () => {
    // The "team" client the per-step/team resolver returns. Its choice routes
    // to 'review' (label 'Send to review').
    const teamClient = {
      complete: vi.fn().mockResolvedValue({
        id: 'r',
        content: 'Send to review',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      } as LLMCompletionResponse),
    }
    // The session client — must NOT be consulted for the routing decision.
    const sessionClient = { complete: vi.fn(), getModel: () => 'session-model' }

    const createClientForAgent = vi.fn(
      (_sid: string, _aid: string, _fallback: unknown, _stepContext: unknown) => teamClient,
    )

    const options: OrchestratorOptions = {
      scope: 'auto',
      sessionId: 's1',
      llmClient: sessionClient as any,
      sessionManager: {
        requireSession: vi.fn(() => ({ workdir: '/tmp/t', messages: [], metadataEntries: {} })),
        setMode: vi.fn(),
        setPhase: vi.fn(),
        createClientForAgent,
        getEffectiveWorkdir: vi.fn().mockReturnValue('/tmp/t'),
        getProjectWorkdir: vi.fn().mockReturnValue('/tmp/t'),
        addMessage: vi.fn(),
        startWorkflow: vi.fn(),
        updateWorkflowStep: vi.fn(),
        completeWorkflow: vi.fn(),
        blockWorkflow: vi.fn(),
        waitAtStep: vi.fn(),
        resumeWorkflow: vi.fn(),
        getActiveWorkflowExecution: vi.fn(() => null),
        cancelWorkflow: vi.fn(),
      } as any,
      transitionHandlers: new TransitionHandlerRegistry(),
    }
    options.transitionHandlers!.register('llm_decision', createLlmDecisionHandler())

    const result = await executeWorkflow(workflow(), options)

    // 1. The llm_decision handler called the step-resolved (team) client once.
    expect(teamClient.complete).toHaveBeenCalledTimes(1)
    // 2. The session client was never used for routing.
    expect(sessionClient.complete).not.toHaveBeenCalled()
    // 3. createClientForAgent was called with the verify step's context
    //    (workflowId + stepId), proving the per-step resolver path ran.
    const verifyCall = createClientForAgent.mock.calls.find(
      (c: unknown[]) => (c[3] as { workflowId: string; stepId: string }).stepId === 'verify',
    )
    expect(verifyCall).toBeTruthy()
    expect((verifyCall![3] as { workflowId: string }).workflowId).toBe('dream')
    // 4. Routing followed the LLM's choice: verify -> review (agentId 'reviewer'),
    //    NOT build ('builder').
    const agentIds = runAgentTurnMock.mock.calls.map((c: unknown[]) => c[2] as string)
    expect(agentIds).toContain('verifier')
    expect(agentIds).toContain('reviewer')
    expect(agentIds).not.toContain('builder')
    // 5. Workflow reached the terminal $done state.
    expect(result.finalAction.type).toBe('DONE')
  })

  it('falls through to the always-fallback when the LLM response is unparseable', async () => {
    const teamClient = {
      complete: vi.fn().mockResolvedValue({
        id: 'r',
        content: 'absolutely no idea',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      } as LLMCompletionResponse),
    }
    const sessionClient = { complete: vi.fn(), getModel: () => 'session-model' }

    const options: OrchestratorOptions = {
      scope: 'auto',
      sessionId: 's1',
      llmClient: sessionClient as any,
      sessionManager: {
        requireSession: vi.fn(() => ({ workdir: '/tmp/t', messages: [], metadataEntries: {} })),
        setMode: vi.fn(),
        setPhase: vi.fn(),
        createClientForAgent: vi.fn((_s: string, _a: string, _fb: unknown) => teamClient),
        getEffectiveWorkdir: vi.fn().mockReturnValue('/tmp/t'),
        getProjectWorkdir: vi.fn().mockReturnValue('/tmp/t'),
        addMessage: vi.fn(),
        startWorkflow: vi.fn(),
        updateWorkflowStep: vi.fn(),
        completeWorkflow: vi.fn(),
        blockWorkflow: vi.fn(),
        waitAtStep: vi.fn(),
        resumeWorkflow: vi.fn(),
        getActiveWorkflowExecution: vi.fn(() => null),
        cancelWorkflow: vi.fn(),
      } as any,
      transitionHandlers: new TransitionHandlerRegistry(),
    }
    options.transitionHandlers!.register('llm_decision', createLlmDecisionHandler())

    const result = await executeWorkflow(workflow(), options)

    // Unparseable -> neither llm_decision transition fires -> always -> $done.
    const agentIds = runAgentTurnMock.mock.calls.map((c: unknown[]) => c[2] as string)
    expect(agentIds).toEqual(['verifier'])
    expect(agentIds).not.toContain('reviewer')
    expect(agentIds).not.toContain('builder')
    expect(result.finalAction.type).toBe('DONE')
  })
})
