/**
 * Phase 0 integration — plugin contract for custom transition handlers.
 *
 * Proves the end-to-end wiring: a plugin calls
 * `ProviderRegistry.registerTransitionHandler(id, handler)`, the registry
 * exposes it via `getTransitionHandlers()`, and the executor's async
 * transition resolver uses it to route a workflow step with a
 * `when: { type: 'custom', handler }` transition.
 */

import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from '../providers/plugins/registry.js'
import { findMatchingTransitionAsync } from './executor.js'
import type { Transition } from './types.js'

describe('Plugin custom transition handler — integration', () => {
  it('routes a workflow step via a plugin-registered handler', async () => {
    const providerRegistry = new ProviderRegistry({ mode: 'production', configDirectory: '/tmp/openfox' })

    // A plugin's register() would call this:
    providerRegistry.registerTransitionHandler('decide_next', async (ctx) => {
      // Fire only when the orchestrator signals "more work" in the config.
      return ctx.config?.['verdict'] === 'retry'
    })

    // The server threads this into OrchestratorOptions.transitionHandlers:
    const transitionHandlers = providerRegistry.getTransitionHandlers()
    expect(transitionHandlers.has('decide_next')).toBe(true)

    const transitions: Transition[] = [
      { when: { type: 'custom', handler: 'decide_next', config: { verdict: 'retry' } }, goto: 'build' },
      { when: { type: 'always' }, goto: '$done' },
    ]

    // Handler fires → first transition wins → routes back to 'build'.
    const fired = await findMatchingTransitionAsync(transitions, null, undefined, transitionHandlers, {
      stepOutcome: null,
      metadataEntries: undefined,
      workflowId: 'wf',
      stepId: 'verify',
    })
    expect(fired?.goto).toBe('build')
  })

  it('falls through to the always-transition when the plugin handler does not fire', async () => {
    const providerRegistry = new ProviderRegistry({ mode: 'production', configDirectory: '/tmp/openfox' })
    providerRegistry.registerTransitionHandler('decide_next', async (ctx) => ctx.config?.['verdict'] === 'retry')
    const transitionHandlers = providerRegistry.getTransitionHandlers()

    const transitions: Transition[] = [
      { when: { type: 'custom', handler: 'decide_next', config: { verdict: 'done' } }, goto: 'build' },
      { when: { type: 'always' }, goto: '$done' },
    ]

    const fired = await findMatchingTransitionAsync(transitions, null, undefined, transitionHandlers, {
      stepOutcome: null,
      metadataEntries: undefined,
      workflowId: 'wf',
      stepId: 'verify',
    })
    expect(fired?.goto).toBe('$done')
  })

  it('survives an unregistered handler id (graceful fallthrough)', async () => {
    const providerRegistry = new ProviderRegistry({ mode: 'production', configDirectory: '/tmp/openfox' })
    const transitionHandlers = providerRegistry.getTransitionHandlers()

    const transitions: Transition[] = [
      { when: { type: 'custom', handler: 'never_registered' }, goto: 'build' },
      { when: { type: 'always' }, goto: '$done' },
    ]

    const fired = await findMatchingTransitionAsync(transitions, null, undefined, transitionHandlers, {
      stepOutcome: null,
      metadataEntries: undefined,
      workflowId: 'wf',
      stepId: 'verify',
    })
    expect(fired?.goto).toBe('$done')
  })
})
