import { describe, it, expect } from 'vitest'
import { TransitionHandlerRegistry, type TransitionHandlerContext } from './transition-handlers.js'

describe('TransitionHandlerRegistry', () => {
  it('registers and retrieves a handler by id', () => {
    const registry = new TransitionHandlerRegistry()
    const handler = async () => true
    registry.register('llm_decision', handler)
    expect(registry.has('llm_decision')).toBe(true)
    expect(registry.get('llm_decision')).toBe(handler)
  })

  it('reports has()=false for an unknown handler id', () => {
    const registry = new TransitionHandlerRegistry()
    expect(registry.has('llm_decision')).toBe(false)
    expect(registry.get('llm_decision')).toBeUndefined()
  })

  it('lists registered handler ids', () => {
    const registry = new TransitionHandlerRegistry()
    registry.register('llm_decision', async () => true)
    registry.register('cost_guard', async () => false)
    expect(registry.list().sort()).toEqual(['cost_guard', 'llm_decision'])
  })

  it('overwrites a handler registered twice under the same id', async () => {
    const registry = new TransitionHandlerRegistry()
    registry.register('llm_decision', async () => true)
    registry.register('llm_decision', async () => false)
    const handler = registry.get('llm_decision')
    expect(handler).toBeDefined()
    const ctx: TransitionHandlerContext = {
      stepOutcome: null,
      metadataEntries: undefined,
      workflowId: 'wf',
      stepId: 'step',
      config: undefined,
    }
    expect(await handler?.(ctx)).toBe(false)
  })

  it('rejects an empty handler id', () => {
    const registry = new TransitionHandlerRegistry()
    expect(() => registry.register('   ', async () => true)).toThrow()
  })
})
