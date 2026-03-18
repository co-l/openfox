import { describe, it, expect, vi } from 'vitest'
import { createTool, type ToolHelpers } from './tool-helpers.js'
import type { ToolContext } from './types.js'
import type { ToolResult } from '../../shared/types.js'
import { PathAccessDeniedError } from './path-security.js'

describe('createTool', () => {
  const mockContext: ToolContext = {
    workdir: '/test/workdir',
    sessionId: 'test-session',
  }

  const testDefinition = {
    type: 'function' as const,
    function: {
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object' as const,
        properties: {
          input: { type: 'string' as const, description: 'Test input' },
        },
        required: ['input'] as string[],
      },
    },
  }

  it('wraps handler with timing', async () => {
    const tool = createTool<{ input: string }>(
      'test_tool',
      testDefinition,
      async (_args, _context, helpers) => {
        return helpers.success('output')
      }
    )

    const result = await tool.execute({ input: 'test' }, mockContext)
    
    expect(result.success).toBe(true)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('provides resolvePath helper', async () => {
    let resolvedPath = ''
    
    const tool = createTool<{ path: string }>(
      'test_tool',
      testDefinition,
      async (args, _context, helpers) => {
        resolvedPath = helpers.resolvePath(args.path)
        return helpers.success(resolvedPath)
      }
    )

    // Relative path
    await tool.execute({ path: 'src/file.ts' }, mockContext)
    expect(resolvedPath).toBe('/test/workdir/src/file.ts')

    // Absolute path
    await tool.execute({ path: '/absolute/path.ts' }, mockContext)
    expect(resolvedPath).toBe('/absolute/path.ts')
  })

  it('provides success helper', async () => {
    const tool = createTool<{ input: string }>(
      'test_tool',
      testDefinition,
      async (_args, _context, helpers) => {
        return helpers.success('output', true, { diagnostics: [] })
      }
    )

    const result = await tool.execute({ input: 'test' }, mockContext)
    
    expect(result.success).toBe(true)
    expect(result.output).toBe('output')
    expect(result.truncated).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('provides error helper', async () => {
    const tool = createTool<{ input: string }>(
      'test_tool',
      testDefinition,
      async (_args, _context, helpers) => {
        return helpers.error('something went wrong')
      }
    )

    const result = await tool.execute({ input: 'test' }, mockContext)
    
    expect(result.success).toBe(false)
    expect(result.error).toBe('something went wrong')
    expect(result.truncated).toBe(false)
  })

  it('catches errors and returns error result', async () => {
    const tool = createTool<{ input: string }>(
      'test_tool',
      testDefinition,
      async () => {
        throw new Error('unexpected error')
      }
    )

    const result = await tool.execute({ input: 'test' }, mockContext)
    
    expect(result.success).toBe(false)
    expect(result.error).toBe('unexpected error')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('re-throws PathAccessDeniedError for orchestrator handling', async () => {
    const tool = createTool<{ input: string }>(
      'test_tool',
      testDefinition,
      async () => {
        throw new PathAccessDeniedError(['/secret/file'], 'test_tool', 'sensitive_file')
      }
    )

    await expect(tool.execute({ input: 'test' }, mockContext))
      .rejects.toThrow(PathAccessDeniedError)
  })

  it('provides checkPathAccess helper that calls requestPathAccess', async () => {
    const mockOnEvent = vi.fn()
    const contextWithEvent: ToolContext = {
      ...mockContext,
      onEvent: mockOnEvent,
    }

    let checkPathCalled = false
    
    const tool = createTool<{ path: string }>(
      'test_tool',
      testDefinition,
      async (args, _context, helpers) => {
        const fullPath = helpers.resolvePath(args.path)
        // checkPathAccess should be a no-op when path is in workdir
        await helpers.checkPathAccess([fullPath])
        checkPathCalled = true
        return helpers.success('done')
      }
    )

    // Path inside workdir - should not trigger confirmation
    const result = await tool.execute({ path: 'src/file.ts' }, contextWithEvent)
    
    expect(checkPathCalled).toBe(true)
    expect(result.success).toBe(true)
    // No path confirmation event should be sent for paths inside workdir
    expect(mockOnEvent).not.toHaveBeenCalled()
  })

  it('creates tool with correct name and definition', () => {
    const tool = createTool<{ input: string }>(
      'my_tool',
      testDefinition,
      async (_args, _context, helpers) => helpers.success('output')
    )

    expect(tool.name).toBe('my_tool')
    expect(tool.definition).toBe(testDefinition)
  })

  it('handles non-Error throws gracefully', async () => {
    const tool = createTool<{ input: string }>(
      'test_tool',
      testDefinition,
      async () => {
        throw 'string error'  // Non-Error throw
      }
    )

    const result = await tool.execute({ input: 'test' }, mockContext)
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown error')
  })
})
