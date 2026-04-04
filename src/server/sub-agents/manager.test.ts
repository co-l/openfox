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
    expect(verifier!.metadata.allowedTools).toContain('criterion:pass,fail')
  })

  it('should return undefined for unknown sub-agent type', async () => {
    const agents = await loadBuiltinAgents()
    const unknown = findAgentById('unknown_type', agents)

    expect(unknown).toBeUndefined()
  })

  it('should return correct tools for each sub-agent type', async () => {
    const agents = await loadBuiltinAgents()

    expect(findAgentById('verifier', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'run_command',
      'criterion:pass,fail',
      'web_fetch',
    ])

    expect(findAgentById('code_reviewer', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'web_fetch',
    ])

    expect(findAgentById('test_generator', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'write_file',
      'run_command',
      'web_fetch',
    ])

    expect(findAgentById('debugger', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'run_command',
      'web_fetch',
    ])
  })
})
