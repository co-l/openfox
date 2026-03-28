/**
 * Unit tests for step_done tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stepDoneTool } from './step-done.js'
import type { ToolContext } from './types.js'

// Mock sessionManager for test context
const mockSessionManager = {
  recordFileRead: vi.fn(),
  getReadFiles: vi.fn().mockReturnValue({}),
  updateFileHash: vi.fn(),
} as any

const mockContext: ToolContext = {
  sessionManager: mockSessionManager,
  workdir: '/test/workdir',
  sessionId: 'test-session',
}

describe('stepDoneTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return success when called with no arguments', async () => {
    const result = await stepDoneTool.execute({}, mockContext)

    expect(result.success).toBe(true)
    expect(result.output).toBe('Step completion signal recorded.')
    expect(result.durationMs).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('should return success when called with empty object', async () => {
    const result = await stepDoneTool.execute({}, mockContext)

    expect(result.success).toBe(true)
    expect(result.output).toBe('Step completion signal recorded.')
  })

  it('should ignore extra arguments', async () => {
    const result = await stepDoneTool.execute({ foo: 'bar', baz: 123 }, mockContext)

    expect(result.success).toBe(true)
    expect(result.output).toBe('Step completion signal recorded.')
  })

  it('should have correct tool definition', () => {
    expect(stepDoneTool.name).toBe('step_done')
    expect(stepDoneTool.definition.type).toBe('function')
    expect(stepDoneTool.definition.function.name).toBe('step_done')
    expect(stepDoneTool.definition.function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    })
  })

  it('should have descriptive tool description', () => {
    const description = stepDoneTool.definition.function.description
    expect(description).toContain('completed')
    expect(description).toContain('workflow step')
    expect(description).toContain('once')
  })
})
