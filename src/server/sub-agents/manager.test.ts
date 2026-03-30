/**
 * Sub-Agent Manager Tests
 */

import { describe, it, expect, vi } from 'vitest'
import { loadBuiltinAgents, findAgentById, getSubAgents } from '../agents/registry.js'

describe('SubAgentManager', () => {
  it('should have verifier available in agent registry', async () => {
    const agents = await loadBuiltinAgents()
    const verifier = findAgentById('verifier', agents)

    expect(verifier).toBeDefined()
    expect(verifier!.metadata.subagent).toBe(true)
    expect(verifier!.metadata.tools).toContain('criterion')
  })

  it('should return undefined for unknown sub-agent type', async () => {
    const agents = await loadBuiltinAgents()
    const unknown = findAgentById('unknown_type', agents)

    expect(unknown).toBeUndefined()
  })

  it('should return correct tools for each sub-agent type', async () => {
    const agents = await loadBuiltinAgents()

    expect(findAgentById('verifier', agents)?.metadata.tools).toEqual([
      'read_file',
      'run_command',
      'criterion',
      'web_fetch',
    ])

    expect(findAgentById('code_reviewer', agents)?.metadata.tools).toEqual([
      'read_file',
      'grep',
      'web_fetch',
    ])

    expect(findAgentById('test_generator', agents)?.metadata.tools).toEqual([
      'read_file',
      'write_file',
      'run_command',
      'web_fetch',
    ])

    expect(findAgentById('debugger', agents)?.metadata.tools).toEqual([
      'read_file',
      'run_command',
      'grep',
      'web_fetch',
    ])
  })
})
