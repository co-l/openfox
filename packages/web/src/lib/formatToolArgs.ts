/**
 * Format tool arguments for display in a concise way.
 * Shows the most relevant argument for each tool type.
 */
export function formatToolArgs(tool: string, args: Record<string, unknown>): string {
  // File operations - show path
  if (tool === 'read_file' || tool === 'write_file' || tool === 'edit_file') {
    return String(args.path ?? '')
  }
  
  // Search operations - show pattern
  if (tool === 'glob') {
    return String(args.pattern ?? '')
  }
  
  if (tool === 'grep') {
    return String(args.pattern ?? '')
  }
  
  // Command execution - show command
  if (tool === 'run_command' || tool === 'bash') {
    return String(args.command ?? '')
  }
  
  // Fallback: stringify with truncation
  const str = JSON.stringify(args)
  return str.length > 50 ? str.slice(0, 50) + '...' : str
}

/**
 * Format args for full display (no truncation, pretty printed)
 */
export function formatToolArgsFull(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2)
}
