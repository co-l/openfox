import { memo } from 'react'
import { ToolIcon } from './ToolIcon'

interface ToolCallPreparingProps {
  name: string
}

// Tool-specific descriptions for better UX
const toolDescriptions: Record<string, string> = {
  read_file: 'Reading file',
  write_file: 'Writing file',
  edit_file: 'Editing file',
  run_command: 'Running command',
  glob: 'Searching files',
  grep: 'Searching content',
  ask_user: 'Asking user',
  // Criterion tool (action-based)
  criterion: 'Managing criterion',
  // Task tracking
  todo_write: 'Updating tasks',
}

function getToolDescription(name: string): string {
  return toolDescriptions[name] ?? `Preparing ${name}`
}

export const ToolCallPreparing = memo(function ToolCallPreparing({ name }: ToolCallPreparingProps) {
  const description = getToolDescription(name)
  
  return (
    <div className="border border-border rounded overflow-hidden my-1 min-w-0 animate-pulse">
      <div className="flex items-center gap-1.5 p-2 bg-bg-tertiary">
        <span className="text-accent-warning animate-pulse">...</span>
        <ToolIcon tool={name} />
        <span className="font-mono text-accent-primary text-sm">{name}</span>
        <span className="text-text-muted text-xs flex-1">{description}...</span>
      </div>
    </div>
  )
})
