/**
 * Phase 3 tests — built-in `llm_decision` transition handler (dynamic orchestration).
 *
 * The handler lets a workflow step ask an LLM "which step next?" and route
 * accordingly. Each sibling transition declares the shared `candidates` list
 * plus its own `thisGoto`; the handler makes ONE LLM call per (workflow, step,
 * outcome) and fires only the transition whose `thisGoto` matches the LLM's
 * chosen candidate. The orchestrator LLM is ctx.llmClient — the step's resolved
 * model, honoring per-step/team overrides.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LLMCompletionResponse } from '../llm/types.js'
import type { TransitionHandlerContext } from './transition-handlers.js'
import { createLlmDecisionHandler, __resetLlmDecisionCache } from './llm-decision-handler.js'

/** Minimal mock LLM client — only `complete` is exercised. */
function mockClient(content: string) {
  const complete = vi.fn().mockResolvedValue({
    id: 'resp-1',
    content,
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  } as LLMCompletionResponse)
  return { complete }
}

function ctx(
  overrides: Partial<TransitionHandlerContext> & { config: Record<string, unknown> },
): TransitionHandlerContext {
  return {
    stepOutcome: null,
    metadataEntries: undefined,
    workflowId: 'wf',
    stepId: 'verify',
    signal: undefined,
    llmClient: undefined,
    ...overrides,
  } as TransitionHandlerContext
}

const CANDIDATES = [
  { goto: 'build', label: 'Retry build', description: 'Code did not compile' },
  { goto: 'review', label: 'Send to review', description: 'Build passed' },
  { goto: '$done', label: 'Finish', description: 'Nothing left to do' },
]

describe('llm_decision transition handler', () => {
  beforeEach(() => __resetLlmDecisionCache())

  it('fires only the transition whose thisGoto matches the LLM choice, with one LLM call', async () => {
    const client = mockClient('Send to review')
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }

    const retryCtx = ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'build', prompt: 'pick next' } })
    const reviewCtx = ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'review', prompt: 'pick next' } })
    const doneCtx = ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: '$done', prompt: 'pick next' } })

    expect(await handler(retryCtx)).toBe(false)
    expect(await handler(reviewCtx)).toBe(true)
    expect(await handler(doneCtx)).toBe(false)
    expect(client.complete).toHaveBeenCalledTimes(1)
  })

  it('caches the decision across sibling transitions (one LLM call per outcome)', async () => {
    const client = mockClient('Finish')
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }
    const buildCtx = ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'build' } })
    const doneCtx = ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: '$done' } })

    await handler(buildCtx)
    await handler(doneCtx)
    await handler(buildCtx)
    expect(client.complete).toHaveBeenCalledTimes(1)
  })

  it('re-queries the LLM for a different step outcome (cache keyed by outcome)', async () => {
    const client = mockClient('Retry build')
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }
    const passCtx = ctx({
      ...shared,
      stepOutcome: { result: 'success', output: {} },
      config: { candidates: CANDIDATES, thisGoto: 'build' },
    })
    const failCtx = ctx({
      ...shared,
      stepOutcome: { result: 'failure', output: { stderr: 'boom' } },
      config: { candidates: CANDIDATES, thisGoto: 'build' },
    })

    await handler(passCtx)
    await handler(failCtx)
    expect(client.complete).toHaveBeenCalledTimes(2)
  })

  it('parses the chosen label out of a verbose response (substring fallback)', async () => {
    const client = mockClient('I think the best option here is to Retry build because tests failed.')
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }
    const r = await handler(ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'build' } }))
    expect(r).toBe(true)
  })

  it('returns false for every transition when the response is unparseable', async () => {
    const client = mockClient('banana')
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }
    expect(await handler(ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'build' } }))).toBe(false)
    expect(await handler(ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'review' } }))).toBe(false)
    expect(client.complete).toHaveBeenCalledTimes(1)
  })

  it('falls through gracefully (returns false) when no llmClient is available', async () => {
    const handler = createLlmDecisionHandler()
    const r = await handler(ctx({ llmClient: undefined, config: { candidates: CANDIDATES, thisGoto: 'build' } }))
    expect(r).toBe(false)
  })

  it('falls through gracefully when the LLM call rejects', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('upstream down'))
    const client = { complete }
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }
    const r = await handler(ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: 'build' } }))
    expect(r).toBe(false)
  })

  it('forwards ctx.signal and temperature to the LLM client', async () => {
    const client = mockClient('Finish')
    const handler = createLlmDecisionHandler()
    const controller = new AbortController()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
      signal: controller.signal,
    }
    await handler(ctx({ ...shared, config: { candidates: CANDIDATES, thisGoto: '$done', temperature: 0.2 } }))

    expect(client.complete).toHaveBeenCalledTimes(1)
    const req = client.complete.mock.calls[0]![0]
    expect(req.signal).toBe(controller.signal)
    expect(req.temperature).toBe(0.2)
  })

  it('includes the step outcome and candidate labels in the prompt sent to the LLM', async () => {
    const client = mockClient('Finish')
    const handler = createLlmDecisionHandler()

    const shared = {
      workflowId: 'wf',
      stepId: 'verify',
      llmClient: client as unknown as TransitionHandlerContext['llmClient'],
    }
    await handler(
      ctx({
        ...shared,
        stepOutcome: { result: 'failure', output: { stderr: 'syntax error' } },
        config: { candidates: CANDIDATES, thisGoto: '$done', prompt: 'What should we do next?' },
      }),
    )

    const req = client.complete.mock.calls[0]![0]
    const userMessage = req.messages.find((m: { role: string }) => m.role === 'user')
    const userText: string = userMessage!.content
    expect(userText).toContain('What should we do next?')
    expect(userText).toContain('Retry build')
    expect(userText).toContain('Send to review')
    expect(userText).toContain('failure')
    expect(userText).toContain('syntax error')
  })
})
