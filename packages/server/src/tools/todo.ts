import type { ToolResult, Todo } from '@openfox/shared'
import type { Tool, ToolContext } from './types.js'

// Store todos per session (in-memory for now, could be persisted later)
const sessionTodos = new Map<string, Todo[]>()

// Callback to emit todo updates (set by the chat handler)
let onTodoUpdate: ((sessionId: string, todos: Todo[]) => void) | null = null

export function setTodoUpdateCallback(callback: (sessionId: string, todos: Todo[]) => void): void {
  onTodoUpdate = callback
}

export function getTodos(sessionId: string): Todo[] {
  return sessionTodos.get(sessionId) ?? []
}

export function clearTodos(sessionId: string): void {
  sessionTodos.delete(sessionId)
}

/**
 * todo_write - Update the task list (visible in chat)
 */
export const todoWriteTool: Tool = {
  name: 'todo_write',
  definition: {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Update your task list. This helps you plan and track your work. The list is visible to the user in the chat.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The complete updated todo list',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Brief description of the task',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Current status of the task',
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'Priority level of the task',
                },
              },
              required: ['content', 'status', 'priority'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const todos = args['todos'] as Todo[]
      
      // Validate todos
      if (!Array.isArray(todos)) {
        return {
          success: false,
          error: 'todos must be an array',
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      for (const todo of todos) {
        if (!todo.content || !todo.status || !todo.priority) {
          return {
            success: false,
            error: 'Each todo must have content, status, and priority',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
          return {
            success: false,
            error: `Invalid status: ${todo.status}. Must be pending, in_progress, or completed`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        if (!['high', 'medium', 'low'].includes(todo.priority)) {
          return {
            success: false,
            error: `Invalid priority: ${todo.priority}. Must be high, medium, or low`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
      }
      
      // Store todos
      sessionTodos.set(context.sessionId, todos)
      
      // Emit update if callback is set
      if (onTodoUpdate) {
        onTodoUpdate(context.sessionId, todos)
      }
      
      const pending = todos.filter(t => t.status === 'pending').length
      const inProgress = todos.filter(t => t.status === 'in_progress').length
      const completed = todos.filter(t => t.status === 'completed').length
      
      return {
        success: true,
        output: `Task list updated: ${completed} completed, ${inProgress} in progress, ${pending} pending`,
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
