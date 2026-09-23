/**
 * Tool categorization for observability dashboards.
 *
 * Maps a tool name to one of the stable observability categories:
 *   read | search | edit | shell | test | git | browser | mcp | sub-agent | other
 *
 * The original name is preserved for drill-down — callers keep `toolName`
 * separately. This is a generic core helper (no plugin dependency).
 */

export type ToolCategory =
  'read' | 'search' | 'edit' | 'shell' | 'test' | 'git' | 'browser' | 'mcp' | 'sub-agent' | 'other'

const READ_TOOLS = new Set(['read_file', 'glob', 'grep'])
const SEARCH_TOOLS = new Set(['web_fetch', 'web_search'])
const EDIT_TOOLS = new Set(['write_file', 'edit_file'])
const SHELL_TOOLS = new Set(['run_command', 'shell_tail'])
const SUB_AGENT_TOOLS = new Set(['call_sub_agent'])

export function classifyTool(toolName: string): ToolCategory {
  if (!toolName) return 'other'
  if (SUB_AGENT_TOOLS.has(toolName)) return 'sub-agent'
  if (READ_TOOLS.has(toolName)) return 'read'
  if (SEARCH_TOOLS.has(toolName)) return 'search'
  if (EDIT_TOOLS.has(toolName)) return 'edit'
  if (SHELL_TOOLS.has(toolName)) return 'shell'
  if (toolName.startsWith('mcp__')) return 'mcp'
  if (toolName.startsWith('test_') || toolName.startsWith('run_test')) return 'test'
  if (toolName.startsWith('git_')) return 'git'
  if (toolName.startsWith('browser_') || toolName.startsWith('playwright_')) return 'browser'
  return 'other'
}
