import type { ToolResult, Todo } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { validateAction, checkActionPermission, unexpectedError, catchError } from './tool-helpers.js'

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

function saveTodosAndBuildSuccess(
  sessionId: string,
  todosList: Todo[],
  startTime: number,
  output: string,
): ToolResult {
  sessionTodos.set(sessionId, todosList)

  if (onTodoUpdate) {
    onTodoUpdate(sessionId, todosList)
  }

  return {
    success: true,
    output,
    durationMs: Date.now() - startTime,
    truncated: false,
  }
}

function buildErrorResponse(error: string, startTime: number): ToolResult {
  return {
    success: false,
    error,
    durationMs: Date.now() - startTime,
    truncated: false,
  }
}

function saveTodosResult(todosList: Todo[], sessionId: string, output: string, startTime: number): ToolResult {
  sessionTodos.set(sessionId, todosList)
  if (onTodoUpdate) {
    onTodoUpdate(sessionId, todosList)
  }
  return {
    success: true,
    output,
    durationMs: Date.now() - startTime,
    truncated: false,
  }
}

function buildTaskListSummary(todosList: Todo[]): string {
  const pending = todosList.filter(t => t.status === 'pending').length
  const inProgress = todosList.filter(t => t.status === 'in_progress').length
  const completed = todosList.filter(t => t.status === 'completed').length
  return `${completed} completed, ${inProgress} in progress, ${pending} pending`
}

export const todoTool: Tool = {
  name: 'todo',
  permittedActions: ['list', 'write', 'add', 'update', 'remove'],
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
      
      const allowedActions = ['list', 'write', 'add', 'update', 'remove']
      const actionError = validateAction(action, allowedActions, startTime)
      if (actionError) return actionError

      const permittedActions = context.permittedActions?.['todo']
      const permissionError = checkActionPermission(action, permittedActions, startTime)
      if (permissionError) return permissionError
      
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
        
        return saveTodosAndBuildSuccess(
          context.sessionId,
          todos,
          startTime,
          `Task list updated: ${todos.filter(t => t.status === 'completed').length} completed, ${todos.filter(t => t.status === 'in_progress').length} in progress, ${todos.filter(t => t.status === 'pending').length} pending`,
        )
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

        return saveTodosAndBuildSuccess(
          context.sessionId,
          todosList,
          startTime,
          `Added task "${content}". Task list: ${todosList.filter(t => t.status === 'completed').length} completed, ${todosList.filter(t => t.status === 'in_progress').length} in progress, ${todosList.filter(t => t.status === 'pending').length} pending`,
        )
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
          return buildErrorResponse(`Index out of range: ${index}. Valid range: 0-${todosList.length - 1}`, startTime)
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
        
        if (content) {
          todo.content = content
        }
        if (status) {
          todo.status = status
        }

        return saveTodosResult(
          todosList,
          context.sessionId,
          `Updated task ${index}. Task list: ${buildTaskListSummary(todosList)}`,
          startTime,
        )
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
          return buildErrorResponse(`Index out of range: ${index}. Valid range: 0-${todosList.length - 1}`, startTime)
        }
        
        const removed = todosList.splice(index, 1)[0]!

        if (todosList.length === 0) {
          return saveTodosResult(
            todosList,
            context.sessionId,
            `Removed task "${removed.content}". No tasks remaining.`,
            startTime,
          )
        }

        return saveTodosResult(
          todosList,
          context.sessionId,
          `Removed task "${removed.content}". Task list: ${buildTaskListSummary(todosList)}`,
          startTime,
        )
      }
      
      return unexpectedError(startTime)
    } catch (error) {
      return catchError(error, startTime)
    }
  },
}
