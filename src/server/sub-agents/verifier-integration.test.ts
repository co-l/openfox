/**
 * Verifier Sub-Agent Integration Tests
 *
 * Tests that the verifier is properly defined in the agent registry.
 */

import { describe, it, expect } from 'vitest'
import { loadBuiltinAgents, findAgentById } from '../agents/registry.js'

describe('Verifier Sub-Agent Integration', () => {
  it('should have verifier defined in agent registry', async () => {
    const agents = await loadBuiltinAgents()
    const verifier = findAgentById('verifier', agents)

    expect(verifier).toBeDefined()
    expect(verifier?.metadata.id).toBe('verifier')
    expect(verifier?.metadata.subagent).toBe(true)
    expect(verifier?.metadata.name).toBe('Verifier')
    expect(typeof verifier?.metadata.description).toBe('string')
    expect(typeof verifier?.prompt).toBe('string')
    expect(verifier?.metadata.tools).toEqual(['read_file', 'run_command', 'criterion', 'web_fetch'])
  })
})
