import { describe, expect, it, vi } from 'vitest'
import { clearTodos, getTodos, setTodoUpdateCallback, todoWriteTool } from './todo.js'

describe('todo_write tool', () => {
  it('validates todo input', async () => {
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    await expect(todoWriteTool.execute({ todos: 'bad' }, context)).resolves.toMatchObject({ success: false, error: 'todos must be an array' })
    await expect(todoWriteTool.execute({ todos: [{ content: 'missing status' }] }, context)).resolves.toMatchObject({ success: false, error: 'Each todo must have content and status' })
    await expect(todoWriteTool.execute({ todos: [{ content: 'bad status', status: 'oops' }] }, context)).resolves.toMatchObject({ success: false, error: 'Invalid status: oops. Must be pending, in_progress, or completed' })
  })

  it('stores todos, emits updates, and clears them', async () => {
    const callback = vi.fn()
    setTodoUpdateCallback(callback)
    const context = { workdir: '/tmp/project', sessionId: 'session-1', sessionManager: {} as never }

    const result = await todoWriteTool.execute({
      todos: [
        { content: 'Write tests', status: 'completed' },
        { content: 'Refactor monolith', status: 'in_progress' },
        { content: 'Run e2e', status: 'pending' },
      ],
    }, context)

    expect(result).toMatchObject({
      success: true,
      output: 'Task list updated: 1 completed, 1 in progress, 1 pending',
    })
    expect(getTodos('session-1')).toEqual([
      { content: 'Write tests', status: 'completed' },
      { content: 'Refactor monolith', status: 'in_progress' },
      { content: 'Run e2e', status: 'pending' },
    ])
    expect(callback).toHaveBeenCalledWith('session-1', getTodos('session-1'))

    clearTodos('session-1')
    expect(getTodos('session-1')).toEqual([])
  })
})
