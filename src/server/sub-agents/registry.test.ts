/**
 * Sub-Agent Registry Tests
 *
 * Tests that the agent registry provides correct sub-agent definitions.
 * This replaces the old hardcoded registry tests with tests against the
 * new file-based agent registry (.agent.md files).
 */

import { describe, it, expect } from 'vitest'
import { loadBuiltinAgents, findAgentById, getSubAgents } from '../agents/registry.js'

describe('SubAgentRegistry (via agent registry)', () => {
  it('should define verifier with correct structure', async () => {
    const agents = await loadBuiltinAgents()
    const verifier = findAgentById('verifier', agents)

    expect(verifier).toBeDefined()
    expect(verifier?.metadata.id).toBe('verifier')
    expect(verifier?.metadata.name).toBe('Verifier')
    expect(typeof verifier?.metadata.description).toBe('string')
    expect(typeof verifier?.prompt).toBe('string')
    expect(verifier?.metadata.allowedTools).toEqual(['read_file', 'run_command', 'criterion:pass,fail', 'web_fetch'])
    expect(verifier?.metadata.subagent).toBe(true)
  })

  it('should define code_reviewer with correct structure', async () => {
    const agents = await loadBuiltinAgents()
    const codeReviewer = findAgentById('code_reviewer', agents)

    expect(codeReviewer).toBeDefined()
    expect(codeReviewer?.metadata.id).toBe('code_reviewer')
    expect(codeReviewer?.metadata.name).toBe('Code Reviewer')
    expect(typeof codeReviewer?.metadata.description).toBe('string')
    expect(typeof codeReviewer?.prompt).toBe('string')
    expect(codeReviewer?.metadata.allowedTools).toEqual(['read_file', 'grep', 'web_fetch'])
    expect(codeReviewer?.metadata.subagent).toBe(true)
  })

  it('should define test_generator with correct structure', async () => {
    const agents = await loadBuiltinAgents()
    const testGenerator = findAgentById('test_generator', agents)

    expect(testGenerator).toBeDefined()
    expect(testGenerator?.metadata.id).toBe('test_generator')
    expect(testGenerator?.metadata.name).toBe('Test Generator')
    expect(typeof testGenerator?.metadata.description).toBe('string')
    expect(typeof testGenerator?.prompt).toBe('string')
    expect(testGenerator?.metadata.allowedTools).toEqual(['read_file', 'write_file', 'run_command', 'web_fetch'])
    expect(testGenerator?.metadata.subagent).toBe(true)
  })

  it('should define debugger with correct structure', async () => {
    const agents = await loadBuiltinAgents()
    const debuggerAgent = findAgentById('debugger', agents)

    expect(debuggerAgent).toBeDefined()
    expect(debuggerAgent?.metadata.id).toBe('debugger')
    expect(debuggerAgent?.metadata.name).toBe('Debugger')
    expect(typeof debuggerAgent?.metadata.description).toBe('string')
    expect(typeof debuggerAgent?.prompt).toBe('string')
    expect(debuggerAgent?.metadata.allowedTools).toEqual(['read_file', 'run_command', 'grep', 'web_fetch'])
    expect(debuggerAgent?.metadata.subagent).toBe(true)
  })

  it('should return undefined for unknown sub-agent types', async () => {
    const agents = await loadBuiltinAgents()
    const unknown = findAgentById('unknown', agents)

    expect(unknown).toBeUndefined()
  })

  it('should return all registered sub-agents', async () => {
    const agents = await loadBuiltinAgents()
    const all = getSubAgents(agents)

    expect(all.length).toBeGreaterThanOrEqual(4)
    const ids = all.map(a => a.metadata.id)
    expect(ids).toContain('verifier')
    expect(ids).toContain('code_reviewer')
    expect(ids).toContain('test_generator')
    expect(ids).toContain('debugger')
  })
})
