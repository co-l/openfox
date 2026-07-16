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

  // Sub-agent call - show sub-agent type
  if (tool === 'call_sub_agent') {
    return String(args.subAgentType ?? '')
  }

  // Load skill - show skill ID
  if (tool === 'load_skill') {
    return String(args.skillId ?? '')
  }

  // Web fetch - show URL
  if (tool === 'web_fetch') {
    return String(args.url ?? '')
  }

  // Web search - show query
  if (tool === 'web_search') {
    const query = String(args.query ?? '')
    return query.length > 60 ? query.slice(0, 57) + '...' : query
  }

  // Dev server - show action
  if (tool === 'dev_server') {
    return String(args.action ?? '')
  }

  // Background process - show action and optional name
  if (tool === 'background_process') {
    const action = String(args.action ?? '')
    const name = args.name ? String(args.name) : ''
    return name ? `${action}: ${name}` : action
  }

  // MCP config - show action
  if (tool === 'mcp_config') {
    return String(args.action ?? '')
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
  metadata?: Record<string, unknown>,
): string {
  const base = formatToolArgs(tool, args)

  // Enrich with metadata when available
  if (tool === 'read_file' && metadata) {
    const format = metadata.format as string | undefined
    const pageCount = metadata.pageCount as number | undefined
    if (format === 'pdf' && pageCount != null) {
      return `${base} (PDF, ${pageCount}p)`
    }
    if (format === 'image') {
      return `${base} (image)`
    }
  }

  if (tool === 'web_fetch' && metadata) {
    const contentType = metadata.contentType as string | undefined
    if (contentType) {
      const shortType = contentType.split(';')[0]?.trim() ?? ''
      if (shortType && shortType !== 'text/html') {
        return `${base} (${shortType})`
      }
    }
  }

  return base
}

/**
 * Format args for full display (no truncation, pretty printed)
 */
export function formatToolArgsFull(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2)
}
