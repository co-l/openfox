import { memo } from 'react'
import type { Todo } from '@openfox/shared'

interface TodoListDisplayProps {
  todos: Todo[]
}

const statusConfig: Record<Todo['status'], { icon: string; color: string; animate?: boolean }> = {
  pending: { icon: '○', color: 'text-text-muted' },
  in_progress: { icon: '●', color: 'text-accent-warning', animate: true },
  completed: { icon: '✓', color: 'text-accent-success' },
}


export const TodoListDisplay = memo(function TodoListDisplay({ todos }: TodoListDisplayProps) {
  if (todos.length === 0) {
    return (
      <div className="text-xs text-text-muted italic my-1">
        No tasks
      </div>
    )
  }

  return (
    <div className="my-1 rounded border border-border bg-bg-tertiary overflow-hidden">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-border bg-bg-secondary">
        <span className="text-xs font-medium text-text-muted">Tasks</span>
      </div>
      
      {/* Task list */}
      <div>
        {todos.map((todo, index) => {
          const config = statusConfig[todo.status]
          
          return (
            <div
              key={index}
              className={`flex items-start gap-2 px-2 py-1.5 ${
                index > 0 ? 'border-t border-border' : ''
              }`}
            >
              <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''} text-sm leading-tight`}>
                {config.icon}
              </span>
              <span className={`text-sm leading-tight ${
                todo.status === 'completed' ? 'text-text-muted' : 'text-text-primary'
              }`}>
                {todo.content}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
