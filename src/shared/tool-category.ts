/**
 * Tool categorization for observability dashboards.
 *
 * Returns a stable `ToolCategory` from a raw tool name without losing the
 * original name (callers keep `toolName` separately for drill-down).
 *
 * Categories follow the mission spec:
 *   read | search | edit | shell | test | git | browser | mcp | sub-agent | other
 */

import type { ToolCategory } from './types.js'

const READ_TOOLS = new Set(['read_file', 'glob', 'grep'])
const SEARCH_TOOLS = new Set(['web_fetch', 'web_search'])
const EDIT_TOOLS = new Set(['write_file', 'edit_file'])
const SHELL_TOOLS = new Set(['run_command', 'shell_tail'])
const SUB_AGENT_TOOLS = new Set(['call_sub_agent'])
const TEST_PREFIXES = ['test_', 'run_test', 'pytest', 'jest_', 'vitest_']
const GIT_PREFIXES = ['git_']
const BROWSER_PREFIXES = ['browser_', 'playwright_', 'puppeteer_']
const MCP_PREFIX = 'mcp__'

function startsWithAny(name: string, prefixes: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return prefixes.some((p) => lower.startsWith(p))
}

export function classifyTool(toolName: string): ToolCategory {
  if (!toolName) return 'other'
  if (SUB_AGENT_TOOLS.has(toolName)) return 'sub-agent'
  if (READ_TOOLS.has(toolName)) return 'read'
  if (SEARCH_TOOLS.has(toolName)) return 'search'
  if (EDIT_TOOLS.has(toolName)) return 'edit'
  if (SHELL_TOOLS.has(toolName)) return 'shell'
  if (toolName.startsWith(MCP_PREFIX)) return 'mcp'
  if (startsWithAny(toolName, TEST_PREFIXES)) return 'test'
  if (startsWithAny(toolName, GIT_PREFIXES)) return 'git'
  if (startsWithAny(toolName, BROWSER_PREFIXES)) return 'browser'
  return 'other'
}

/** Human-friendly label used in dashboard breakdowns. */
export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  read: 'read',
  search: 'search',
  edit: 'edit',
  shell: 'shell',
  test: 'test',
  git: 'git',
  browser: 'browser',
  mcp: 'mcp',
  'sub-agent': 'sub-agents',
  other: 'other',
}

/** Stable order for chart legends. */
export const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  'read',
  'search',
  'edit',
  'shell',
  'test',
  'git',
  'browser',
  'mcp',
  'sub-agent',
  'other',
]
