import { memo } from 'react'
import { ToolIcon } from './ToolIcon'

interface ToolCallPreparingProps {
  name: string
  arguments?: string
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
  criterion: 'Managing criterion',
  todo_write: 'Updating tasks',
}

function getToolDescription(name: string): string {
  return toolDescriptions[name] ?? `Preparing ${name}`
}

function extractCommandFromArgs(args: string): string | null {
  try {
    const cleaned = args.replace(/\s*\}\s*$/, '')
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.command === 'string') return parsed.command
  } catch {
    const match = args.match(/"command"\s*:\s*"([^"]*)/)
    if (match && match[1]) return match[1]
  }
  return null
}

export const ToolCallPreparing = memo(function ToolCallPreparing({ name, arguments: args }: ToolCallPreparingProps) {
  const description = getToolDescription(name)
  
  let detailText = description + '...'
  if (name === 'run_command' && args) {
    const command = extractCommandFromArgs(args)
    if (command) {
      detailText = command
    }
  }
  
  return (
    <div className="border border-border rounded overflow-hidden my-1 min-w-0 animate-pulse">
      <div className="flex items-center gap-1.5 p-2 bg-bg-tertiary">
        <span className="text-accent-warning animate-pulse">...</span>
        <ToolIcon tool={name} />
        <span className="font-mono text-accent-primary text-sm">{name}</span>
        {name === 'run_command' && args ? (
          <code className="text-text-muted text-xs flex-1 truncate">{detailText}</code>
        ) : (
          <span className="text-text-muted text-xs flex-1">{detailText}</span>
        )}
      </div>
    </div>
  )
})
