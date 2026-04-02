import type { ToolResult, Todo } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'

type TodoAction = 'list' | 'write' | 'add' | 'update' | 'remove'
type TodoStatus = 'pending' | 'in_progress' | 'completed'

const sessionTodos = new Map<string, Todo[]>()

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

export const todoTool: Tool = {
  name: 'todo',
  definition: {
    type: 'function',
    function: {
      name: 'todo',
      description: 'Manage task list. Actions: list (show all), write (replace all), add (create new), update (modify), remove (delete).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'write', 'add', 'update', 'remove'],
            description: 'The action to perform',
          },
          todos: {
            type: 'array',
            description: 'Complete todo list (required for: write)',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
          content: {
            type: 'string',
            description: 'Task content (required for: add)',
          },
          index: {
            type: 'number',
            description: 'Task index 0-based (required for: update, remove)',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed'],
            description: 'Task status (required for: update)',
          },
        },
        required: ['action'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const action = args['action'] as TodoAction | undefined
      const todos = args['todos'] as Todo[] | undefined
      const content = args['content'] as string | undefined
      const index = args['index'] as number | undefined
      const status = args['status'] as TodoStatus | undefined
      
      if (!action || !['list', 'write', 'add', 'update', 'remove'].includes(action)) {
        return {
          success: false,
          error: `Invalid action: ${action}. Must be one of: list, write, add, update, remove`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'list') {
        const todosList = sessionTodos.get(context.sessionId) ?? []
        return {
          success: true,
          output: todosList.length === 0
            ? 'No tasks defined yet.'
            : JSON.stringify(todosList, null, 2),
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'write') {
        if (!todos) {
          return {
            success: false,
            error: 'Missing required field: todos',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        if (!Array.isArray(todos)) {
          return {
            success: false,
            error: 'todos must be an array',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        for (const todo of todos) {
          if (!todo.content || !todo.status) {
            return {
              success: false,
              error: 'Each todo must have content and status',
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
        }
        
        sessionTodos.set(context.sessionId, todos)
        
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
      }
      
      if (action === 'add') {
        if (!content) {
          return {
            success: false,
            error: 'Missing required field: content',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const todosList = sessionTodos.get(context.sessionId) ?? []
        const newTodo: Todo = { content, status: 'pending' }
        todosList.push(newTodo)
        sessionTodos.set(context.sessionId, todosList)
        
        if (onTodoUpdate) {
          onTodoUpdate(context.sessionId, todosList)
        }
        
        const pending = todosList.filter(t => t.status === 'pending').length
        const inProgress = todosList.filter(t => t.status === 'in_progress').length
        const completed = todosList.filter(t => t.status === 'completed').length
        
        return {
          success: true,
          output: `Added task "${content}". Task list: ${completed} completed, ${inProgress} in progress, ${pending} pending`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'update') {
        if (index === undefined) {
          return {
            success: false,
            error: 'Missing required field: index',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        if (!content && !status) {
          return {
            success: false,
            error: 'update requires content or status',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        if (status && !['pending', 'in_progress', 'completed'].includes(status)) {
          return {
            success: false,
            error: `Invalid status: ${status}. Must be pending, in_progress, or completed`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const todosList = sessionTodos.get(context.sessionId) ?? []
        
        if (index < 0 || index >= todosList.length) {
          return {
            success: false,
            error: `Index out of range: ${index}. Valid range: 0-${todosList.length - 1}`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const todo = todosList[index]
        if (!todo) {
          return {
            success: false,
            error: `Index out of range: ${index}. Valid range: 0-${todosList.length - 1}`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        if (content) {
          todo.content = content
        }
        if (status) {
          todo.status = status
        }
        
        sessionTodos.set(context.sessionId, todosList)
        
        if (onTodoUpdate) {
          onTodoUpdate(context.sessionId, todosList)
        }
        
        const pending = todosList.filter(t => t.status === 'pending').length
        const inProgress = todosList.filter(t => t.status === 'in_progress').length
        const completed = todosList.filter(t => t.status === 'completed').length
        
        return {
          success: true,
          output: `Updated task ${index}. Task list: ${completed} completed, ${inProgress} in progress, ${pending} pending`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (action === 'remove') {
        if (index === undefined) {
          return {
            success: false,
            error: 'Missing required field: index',
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const todosList = sessionTodos.get(context.sessionId) ?? []
        
        if (index < 0 || index >= todosList.length) {
          return {
            success: false,
            error: `Index out of range: ${index}. Valid range: 0-${todosList.length - 1}`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const removed = todosList.splice(index, 1)[0]!
        sessionTodos.set(context.sessionId, todosList)
        
        if (onTodoUpdate) {
          onTodoUpdate(context.sessionId, todosList)
        }
        
        if (todosList.length === 0) {
          return {
            success: true,
            output: `Removed task "${removed.content}". No tasks remaining.`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
        
        const pending = todosList.filter(t => t.status === 'pending').length
        const inProgress = todosList.filter(t => t.status === 'in_progress').length
        const completed = todosList.filter(t => t.status === 'completed').length
        
        return {
          success: true,
          output: `Removed task "${removed.content}". Task list: ${completed} completed, ${inProgress} in progress, ${pending} pending`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      return {
        success: false,
        error: 'Unexpected error',
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
