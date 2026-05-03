/**
 * CRITICAL BUG: Tools Hash Changes Between Workflow and Regular Chat
 *
 * This test exposes the HORRIBLE performance bug where the tool registry
 * itself changes based on injectStepDone flag.
 *
 * The tools hash MUST remain stable. ALL tools must ALWAYS be sent to the LLM.
 * If the hash changes, the entire LLM cache is invalidated.
 */

import { describe, it, expect } from 'vitest'
import { filterToolRegistryForStepDone } from './orchestrator.js'
import type { ToolRegistry } from '../tools/types.js'

describe('CRITICAL BUG: Tools Hash Changes', () => {
  it('BUG: filterToolRegistryForStepDone changes tools hash, breaking LLM cache', () => {
    // CRITICAL: The tool registry MUST be identical regardless of injectStepDone.
    // If the tools hash changes, the LLM cache is invalidated and performance tanks.

    const mockRegistry: ToolRegistry = {
      tools: [{ name: 'read_file' } as any, { name: 'write_file' } as any, { name: 'step_done' } as any],
      definitions: [],
      execute: async () => {
        throw new Error('not implemented')
      },
    }

    // Call with injectStepDone=true (should keep all tools)
    const registryWithStepDone = filterToolRegistryForStepDone(mockRegistry, true)

    // Call with injectStepDone=false (FILTERS OUT step_done)
    const registryWithoutStepDone = filterToolRegistryForStepDone(mockRegistry, false)

    // CRITICAL BUG: The tool registries MUST be identical
    // Currently:
    // - registryWithStepDone.tools = [read_file, write_file, step_done]
    // - registryWithoutStepDone.tools = [read_file, write_file]  <-- step_done removed!
    //
    // This breaks LLM context caching!
    expect(registryWithStepDone.tools).toEqual(registryWithoutStepDone.tools)
  })

  it('BUG: system reminder includes step_done but filtered registry does not', () => {
    // This test shows the mismatch between what the system reminder says
    // and what tools are actually available.

    const mockRegistry: ToolRegistry = {
      tools: [{ name: 'read_file' } as any, { name: 'write_file' } as any, { name: 'step_done' } as any],
      definitions: [],
      execute: async () => {
        throw new Error('not implemented')
      },
    }

    // Simulate injectStepDone=false (filters out step_done)
    const filteredRegistry = filterToolRegistryForStepDone(mockRegistry, false)

    // System reminder would say "you have: read_file, write_file, step_done"
    // But actual tools available: read_file, write_file (step_done filtered out!)
    // This causes the LLM to try calling step_done when it's not available

    const hasStepDoneInReminder = true // System reminder includes all tools
    const hasStepDoneInRegistry = filteredRegistry.tools.some((t) => t.name === 'step_done')

    // BUG: Mismatch between reminder and actual tools
    expect(hasStepDoneInReminder).toBe(hasStepDoneInRegistry)
  })
})
