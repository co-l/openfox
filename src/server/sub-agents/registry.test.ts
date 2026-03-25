/**
 * Sub-Agent Registry Tests
 */

import { describe, it, expect } from 'vitest'
import { createSubAgentRegistry } from './registry.js'

describe('SubAgentRegistry', () => {
  it('should define verifier with correct structure', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')
    
    expect(verifier).toBeDefined()
    expect(verifier?.id).toBe('verifier')
    expect(verifier?.name).toBe('Verifier')
    expect(typeof verifier?.description).toBe('string')
    expect(typeof verifier?.systemPrompt).toBe('string')
    expect(verifier?.tools).toEqual(['read_file', 'run_command', 'pass_criterion', 'fail_criterion', 'web_fetch'])
    expect(typeof verifier?.createContext).toBe('function')
  })

  it('should define code_reviewer with correct structure', () => {
    const registry = createSubAgentRegistry()
    const codeReviewer = registry.getSubAgent('code_reviewer')
    
    expect(codeReviewer).toBeDefined()
    expect(codeReviewer?.id).toBe('code_reviewer')
    expect(codeReviewer?.name).toBe('Code Reviewer')
    expect(typeof codeReviewer?.description).toBe('string')
    expect(typeof codeReviewer?.systemPrompt).toBe('string')
    expect(codeReviewer?.tools).toEqual(['read_file', 'grep', 'web_fetch'])
    expect(typeof codeReviewer?.createContext).toBe('function')
  })

  it('should define test_generator with correct structure', () => {
    const registry = createSubAgentRegistry()
    const testGenerator = registry.getSubAgent('test_generator')
    
    expect(testGenerator).toBeDefined()
    expect(testGenerator?.id).toBe('test_generator')
    expect(testGenerator?.name).toBe('Test Generator')
    expect(typeof testGenerator?.description).toBe('string')
    expect(typeof testGenerator?.systemPrompt).toBe('string')
    expect(testGenerator?.tools).toEqual(['read_file', 'write_file', 'run_command', 'web_fetch'])
    expect(typeof testGenerator?.createContext).toBe('function')
  })

  it('should define debugger with correct structure', () => {
    const registry = createSubAgentRegistry()
    const debuggerAgent = registry.getSubAgent('debugger')
    
    expect(debuggerAgent).toBeDefined()
    expect(debuggerAgent?.id).toBe('debugger')
    expect(debuggerAgent?.name).toBe('Debugger')
    expect(typeof debuggerAgent?.description).toBe('string')
    expect(typeof debuggerAgent?.systemPrompt).toBe('string')
    expect(debuggerAgent?.tools).toEqual(['read_file', 'run_command', 'grep', 'web_fetch'])
    expect(typeof debuggerAgent?.createContext).toBe('function')
  })

  it('should return undefined for unknown sub-agent types', () => {
    const registry = createSubAgentRegistry()
    const unknown = registry.getSubAgent('unknown')
    
    expect(unknown).toBeUndefined()
  })

  it('should return all registered sub-agents', () => {
    const registry = createSubAgentRegistry()
    const all = registry.getAllSubAgents()
    
    expect(all).toHaveLength(4)
    expect(all.map(a => a.id)).toEqual(['verifier', 'code_reviewer', 'test_generator', 'debugger'])
  })
})
