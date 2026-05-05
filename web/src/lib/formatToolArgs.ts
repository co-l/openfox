/**
 * Format tool arguments for display in a concise way.
 * Shows the most relevant argument for each tool type.
 */
export function formatToolArgs(tool: string, args: Record<string, unknown>): string {
  // Read file - show path with offset/limit params when non-default
  if (tool === 'read_file') {
    const path = String(args.path ?? '')
    const offset = args.offset as number | undefined
    const limit = args.limit as number | undefined
    const params = []
    if (offset !== undefined && offset !== 1) params.push(`offset=${offset}`)
    if (limit !== undefined) params.push(`limit=${limit}`)
    return params.length > 0 ? `${path} [${params.join(', ')}]` : path
  }

  // Other file operations - show path
  if (tool === 'write_file' || tool === 'edit_file') {
    return String(args.path ?? '')
  }

  // Command execution - show command
  if (tool === 'run_command' || tool === 'bash') {
    return String(args.command ?? '')
  }

  // Return value - show truncated content preview
  if (tool === 'return_value') {
    const content = String(args.content ?? '')
    return content.length > 60 ? content.slice(0, 60) + '...' : content
  }

  // Fallback: stringify with truncation
  const str = JSON.stringify(args)
  return str.length > 50 ? str.slice(0, 50) + '...' : str
}

/**
 * Format tool arguments with metadata for enhanced display.
 * Includes structured metadata like counts and truncation status.
 */
export function formatToolArgsWithMetadata(
  tool: string,
  args: Record<string, unknown>,
  _metadata?: Record<string, unknown>,
): string {
  return formatToolArgs(tool, args)
}

/**
 * Format args for full display (no truncation, pretty printed)
 */
export function formatToolArgsFull(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2)
}
