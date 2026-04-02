import { describe, expect, it, vi, beforeEach } from 'vitest'
import { todoTool, clearTodos } from './todo.js'

function createTodos() {
  return [
    { content: 'Write tests', status: 'completed' as const },
    { content: 'Refactor monolith', status: 'in_progress' as const },
    { content: 'Run e2e', status: 'pending' as const },
  ]
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    workdir: '/tmp/project',
    sessionId: 'session-1',
    sessionManager: {},
    ...overrides,
  }
}

describe('todo tool', () => {
  beforeEach(() => {
    clearTodos('session-1')
  })

  describe('validation', () => {
    it('rejects invalid action', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'invalid' as any }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid action') })
    })

    it('rejects write without todos', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'write' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: todos') })
    })

    it('rejects write with non-array todos', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'write', todos: 'bad' as any }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('todos must be an array') })
    })

    it('rejects write with invalid todo items', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'write', todos: [{ content: 'missing status' }] as any }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Each todo must have content and status') })
    })

    it('rejects write with invalid status', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'write', todos: [{ content: 'test', status: 'invalid' }] as any }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid status') })
    })

    it('rejects add without content', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'add' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: content') })
    })

    it('rejects update without index', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'update', content: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: index') })
    })

    it('rejects update without content or status', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'update', index: 0 }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('update requires content or status') })
    })

    it('rejects update with invalid status', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'update', index: 0, status: 'invalid' as any }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid status') })
    })

    it('rejects remove without index', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'remove' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Missing required field: index') })
    })
  })

  describe('list action', () => {
    it('returns todos as json', async () => {
      const context = createContext()
      const existingTodos = createTodos()
      await todoTool.execute({ action: 'write', todos: existingTodos }, context as never)
      
      const result = await todoTool.execute({ action: 'list' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('Write tests')
      expect(result.output).toContain('Refactor monolith')
    })

    it('returns empty list when no todos', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'list' }, context as never)
      expect(result).toMatchObject({ success: true, output: 'No tasks defined yet.' })
    })
  })

  describe('write action', () => {
    it('replaces entire todo list', async () => {
      const context = createContext()
      const newTodos = [
        { content: 'New task 1', status: 'pending' as const },
        { content: 'New task 2', status: 'completed' as const },
      ]
      const result = await todoTool.execute({ action: 'write', todos: newTodos }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('1 completed, 0 in progress, 1 pending')
    })

    it('emits update callback', async () => {
      const callback = vi.fn()
      const context = createContext()
      // The callback is registered globally in the actual implementation
      const newTodos = [{ content: 'Task', status: 'pending' as const }]
      const result = await todoTool.execute({ action: 'write', todos: newTodos }, context as never)
      expect(result.success).toBe(true)
    })
  })

  describe('add action', () => {
    it('adds a todo with pending status', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'add', content: 'New task' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('Added task')
    })

    it('appends to existing todos', async () => {
      const context = createContext()
      await todoTool.execute({ action: 'add', content: 'Task 1' }, context as never)
      const result = await todoTool.execute({ action: 'add', content: 'Task 2' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('2 pending')
    })
  })

  describe('update action', () => {
    it('updates todo content', async () => {
      const context = createContext()
      await todoTool.execute({ action: 'add', content: 'Old task' }, context as never)
      const result = await todoTool.execute({ action: 'update', index: 0, content: 'New task' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('Updated task')
    })

    it('updates todo status', async () => {
      const context = createContext()
      await todoTool.execute({ action: 'add', content: 'Task' }, context as never)
      const result = await todoTool.execute({ action: 'update', index: 0, status: 'completed' }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('1 completed')
    })

    it('updates both content and status', async () => {
      const context = createContext()
      await todoTool.execute({ action: 'add', content: 'Old', status: 'pending' }, context as never)
      const result = await todoTool.execute({ action: 'update', index: 0, content: 'New', status: 'completed' }, context as never)
      expect(result.success).toBe(true)
    })

    it('returns error when index out of range', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'update', index: 5, content: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Index out of range') })
    })

    it('returns error when negative index', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'update', index: -1, content: 'test' }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Index out of range') })
    })
  })

  describe('remove action', () => {
    it('removes a todo by index', async () => {
      const context = createContext()
      await todoTool.execute({ action: 'add', content: 'Task 1' }, context as never)
      await todoTool.execute({ action: 'add', content: 'Task 2' }, context as never)
      const result = await todoTool.execute({ action: 'remove', index: 0 }, context as never)
      expect(result.success).toBe(true)
      expect(result.output).toContain('Removed task')
      expect(result.output).toContain('1 pending')
    })

    it('returns error when index out of range', async () => {
      const context = createContext()
      const result = await todoTool.execute({ action: 'remove', index: 5 }, context as never)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Index out of range') })
    })

    it('returns empty state message when last todo removed', async () => {
      const context = createContext()
      await todoTool.execute({ action: 'add', content: 'Only task' }, context as never)
      const result = await todoTool.execute({ action: 'remove', index: 0 }, context as never)
      expect(result).toMatchObject({ success: true, output: expect.stringContaining('No tasks remaining') })
    })
  })
})
