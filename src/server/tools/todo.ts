import type { Todo } from '../../shared/types.js'
import { createTool, validateActionWithPermission } from './tool-helpers.js'

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

function buildTaskListSummary(todosList: Todo[]): string {
  const pending = todosList.filter(t => t.status === 'pending').length
  const inProgress = todosList.filter(t => t.status === 'in_progress').length
  const completed = todosList.filter(t => t.status === 'completed').length
  return `${completed} completed, ${inProgress} in progress, ${pending} pending`
}

interface TodoArgs {
  action: 'list' | 'write' | 'add' | 'update' | 'remove'
  todos?: Todo[]
  content?: string
  index?: number
  status?: 'pending' | 'in_progress' | 'completed'
}

export const todoTool = createTool<TodoArgs>(
  'todo',
  {
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
  async (args, context, helpers) => {
    const actionError = validateActionWithPermission(args.action, ['list', 'write', 'add', 'update', 'remove'], 'todo', context.permittedActions)
    if (actionError) return actionError

    if (args.action === 'list') {
      const todosList = sessionTodos.get(context.sessionId) ?? []
      return helpers.success(
        todosList.length === 0
          ? 'No tasks defined yet.'
          : JSON.stringify(todosList, null, 2)
      )
    }

    if (args.action === 'write') {
      if (!args.todos) return helpers.error('Missing required field: todos')
      if (!Array.isArray(args.todos)) return helpers.error('todos must be an array')
      for (const todo of args.todos) {
        if (!todo.content || !todo.status) return helpers.error('Each todo must have content and status')
        if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
          return helpers.error(`Invalid status: ${todo.status}. Must be pending, in_progress, or completed`)
        }
      }
      sessionTodos.set(context.sessionId, args.todos)
      if (onTodoUpdate) onTodoUpdate(context.sessionId, args.todos)
      return helpers.success(`${args.todos.filter(t => t.status === 'completed').length} completed, ${args.todos.filter(t => t.status === 'in_progress').length} in progress, ${args.todos.filter(t => t.status === 'pending').length} pending`)
    }

    if (args.action === 'add') {
      if (!args.content) return helpers.error('Missing required field: content')
      const todosList = sessionTodos.get(context.sessionId) ?? []
      todosList.push({ content: args.content, status: 'pending' })
      sessionTodos.set(context.sessionId, todosList)
      if (onTodoUpdate) onTodoUpdate(context.sessionId, todosList)
      return helpers.success(`Added task "${args.content}". Task list: ${buildTaskListSummary(todosList)}`)
    }

    if (args.action === 'update') {
      if (!args.content && !args.status) return helpers.error('update requires content or status')
      if (args.status && !['pending', 'in_progress', 'completed'].includes(args.status)) {
        return helpers.error(`Invalid status: ${args.status}. Must be pending, in_progress, or completed`)
      }
      const todosList = sessionTodos.get(context.sessionId) ?? []
      if (args.index === undefined) return helpers.error('Missing required field: index')
      if (args.index < 0 || args.index >= todosList.length) {
        return helpers.error(`Index out of range: ${args.index}. Valid range: 0-${todosList.length - 1}`)
      }
      const todo = todosList[args.index]!
      if (args.content) todo.content = args.content
      if (args.status) todo.status = args.status
      sessionTodos.set(context.sessionId, todosList)
      if (onTodoUpdate) onTodoUpdate(context.sessionId, todosList)
      return helpers.success(`Updated task ${args.index}. Task list: ${buildTaskListSummary(todosList)}`)
    }

    if (args.action === 'remove') {
      const todosList = sessionTodos.get(context.sessionId) ?? []
      if (args.index === undefined) return helpers.error('Missing required field: index')
      if (args.index < 0 || args.index >= todosList.length) {
        return helpers.error(`Index out of range: ${args.index}. Valid range: 0-${todosList.length - 1}`)
      }
      const removed = todosList.splice(args.index, 1)[0]!
      sessionTodos.set(context.sessionId, todosList)
      if (onTodoUpdate) onTodoUpdate(context.sessionId, todosList)
      return helpers.success(
        todosList.length === 0
          ? `Removed task "${removed.content}". No tasks remaining.`
          : `Removed task "${removed.content}". Task list: ${buildTaskListSummary(todosList)}`
      )
    }

    return helpers.error('Unexpected error')
  }
)