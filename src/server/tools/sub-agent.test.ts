/**
 * Call Sub-Agent Tool Tests
 */

import { describe, it, expect, vi } from 'vitest'
import { callSubAgentTool } from './sub-agent.js'
import type { ToolContext } from './types.js'
import type { SessionManager } from '../session/index.js'

describe('call_sub_agent tool', () => {
  it('should have correct tool definition', () => {
    expect(callSubAgentTool.name).toBe('call_sub_agent')
    expect(callSubAgentTool.definition.type).toBe('function')
    expect(callSubAgentTool.definition.function.name).toBe('call_sub_agent')
    
    const params = callSubAgentTool.definition.function.parameters as any
    expect(params.properties.subAgentType.type).toBe('string')
    expect(params.required).toContain('subAgentType')
    expect(params.required).toContain('prompt')
  })

  it('should reject unknown sub-agent types', async () => {
    const context: ToolContext = {
      sessionManager: {} as SessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    const result = await callSubAgentTool.execute(
      { 'subAgentType': 'unknown_type' as any, 'prompt': 'test' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown sub-agent type')
  })

  it('should require both subAgentType and prompt parameters', async () => {
    const context: ToolContext = {
      sessionManager: {} as SessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    // Missing prompt
    const result = await callSubAgentTool.execute(
      { 'subAgentType': 'verifier' } as any,
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required parameter')
  })
})
