/**
 * Async transition evaluation — `custom` condition type via the handler registry.
 *
 * Built-in condition types stay synchronous (covered by executor.test.ts);
 * this file covers the async path that lets plugins contribute custom
 * transition conditions.
 */

import { describe, it, expect } from 'vitest'
import type { MetadataEntry } from '../../shared/types.js'
import type { Transition } from './types.js'
import { TERMINAL_BLOCKED } from './types.js'
import { TransitionHandlerRegistry, type TransitionHandlerContext } from './transition-handlers.js'
import { evaluateConditionAsync, findMatchingTransitionAsync, type StepOutcome } from './executor.js'

function makeMetadataEntry(overrides: Partial<MetadataEntry> = {}): MetadataEntry {
  return { id: 'c1', description: 'Test', status: 'pending', ...overrides }
}

const baseHandlerCtx = (overrides: Partial<TransitionHandlerContext> = {}): TransitionHandlerContext => ({
  stepOutcome: null,
  metadataEntries: undefined,
  workflowId: 'wf',
  stepId: 'step',
  config: undefined,
  ...overrides,
})

describe('evaluateConditionAsync', () => {
  it('delegates built-in types to the synchronous evaluator (step_result)', async () => {
    const registry = new TransitionHandlerRegistry()
    const outcome: StepOutcome = { result: 'success', output: {} }
    await expect(
      evaluateConditionAsync(
        { type: 'step_result', result: 'success' },
        outcome,
        undefined,
        registry,
        baseHandlerCtx(),
      ),
    ).resolves.toBe(true)
    await expect(
      evaluateConditionAsync(
        { type: 'step_result', result: 'success' },
        { result: 'failure', output: {} },
        undefined,
        registry,
        baseHandlerCtx(),
      ),
    ).resolves.toBe(false)
  })

  it('delegates built-in types (always)', async () => {
    const registry = new TransitionHandlerRegistry()
    await expect(evaluateConditionAsync({ type: 'always' }, null, undefined, registry, baseHandlerCtx())).resolves.toBe(
      true,
    )
  })

  it('invokes a registered custom handler and forwards context', async () => {
    const registry = new TransitionHandlerRegistry()
    const seen: TransitionHandlerContext[] = []
    registry.register('llm_decision', async (ctx) => {
      seen.push(ctx)
      return ctx.config?.['decide'] === 'proceed'
    })
    const ctx = baseHandlerCtx({ config: { decide: 'proceed' }, stepId: 'verify' })
    await expect(
      evaluateConditionAsync(
        { type: 'custom', handler: 'llm_decision', config: { decide: 'proceed' } },
        null,
        undefined,
        registry,
        ctx,
      ),
    ).resolves.toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.stepId).toBe('verify')
    expect(seen[0]?.config).toEqual({ decide: 'proceed' })
  })

  it('returns false when no handler is registered for the custom id (graceful)', async () => {
    const registry = new TransitionHandlerRegistry()
    await expect(
      evaluateConditionAsync({ type: 'custom', handler: 'missing' }, null, undefined, registry, baseHandlerCtx()),
    ).resolves.toBe(false)
  })

  it('passes metadata entries through to the handler', async () => {
    const registry = new TransitionHandlerRegistry()
    let received: MetadataEntry[] | undefined
    registry.register('all_passed', async (ctx) => {
      received = ctx.metadataEntries?.['criteria']
      return received?.every((e) => e.status === 'passed') ?? false
    })
    const entries = { criteria: [makeMetadataEntry({ status: 'passed' })] }
    await expect(
      evaluateConditionAsync(
        { type: 'custom', handler: 'all_passed' },
        null,
        entries,
        registry,
        baseHandlerCtx({ metadataEntries: entries }),
      ),
    ).resolves.toBe(true)
    expect(received).toHaveLength(1)
  })
})

describe('findMatchingTransitionAsync', () => {
  it('returns the first transition whose custom handler fires', async () => {
    const registry = new TransitionHandlerRegistry()
    registry.register('llm_decision', async (ctx) => ctx.config?.['go'] === 'retry')
    const transitions: Transition[] = [
      { when: { type: 'custom', handler: 'llm_decision', config: { go: 'retry' } }, goto: 'build' },
      { when: { type: 'always' }, goto: '$done' },
    ]
    const fired = await findMatchingTransitionAsync(transitions, null, undefined, registry, baseHandlerCtx())
    expect(fired?.goto).toBe('build')
  })

  it('falls back to a built-in transition when the custom handler does not fire', async () => {
    const registry = new TransitionHandlerRegistry()
    registry.register('llm_decision', async () => false)
    const transitions: Transition[] = [
      { when: { type: 'custom', handler: 'llm_decision' }, goto: 'build' },
      { when: { type: 'always' }, goto: '$done' },
    ]
    const fired = await findMatchingTransitionAsync(transitions, null, undefined, registry, baseHandlerCtx())
    expect(fired?.goto).toBe('$done')
  })

  it('returns null when no transition matches and no handler is registered', async () => {
    const registry = new TransitionHandlerRegistry()
    const transitions: Transition[] = [{ when: { type: 'custom', handler: 'missing' }, goto: 'build' }]
    const fired = await findMatchingTransitionAsync(transitions, null, undefined, registry, baseHandlerCtx())
    expect(fired).toBeNull()
  })

  it('evaluates transitions in order — first match wins', async () => {
    const registry = new TransitionHandlerRegistry()
    registry.register('pick', async (ctx) => ctx.config?.['n'] === 1)
    const transitions: Transition[] = [
      { when: { type: 'custom', handler: 'pick', config: { n: 1 } }, goto: 'first' },
      { when: { type: 'custom', handler: 'pick', config: { n: 1 } }, goto: 'second' },
    ]
    const fired = await findMatchingTransitionAsync(transitions, null, undefined, registry, baseHandlerCtx())
    expect(fired?.goto).toBe('first')
  })

  it('returns null for an empty transition list (caller maps to $blocked)', async () => {
    const registry = new TransitionHandlerRegistry()
    const fired = await findMatchingTransitionAsync([], null, undefined, registry, baseHandlerCtx())
    expect(fired).toBeNull()
    // sanity: the caller's $blocked constant
    expect(TERMINAL_BLOCKED).toBe('$blocked')
  })
})
