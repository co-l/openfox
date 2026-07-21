import { getDatabase } from './index.js'

// ============================================================================
// Settings Operations
// ============================================================================

export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  DISPLAY_SHOW_THINKING: 'display.showThinking',
  DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT: 'display.showVerboseToolOutput',
  DISPLAY_SHOW_STATS: 'display.showStats',
  DISPLAY_SHOW_AGENT_DEFINITIONS: 'display.showAgentDefinitions',
  DISPLAY_SHOW_WORKFLOW_BARS: 'display.showWorkflowBars',
  DISPLAY_SHOW_SYNTAX_HIGHLIGHTING: 'display.showSyntaxHighlighting',
  DISPLAY_THEME: 'display.theme',
  DISPLAY_USER_PRESETS: 'display.userPresets',
  DISPLAY_FOLLOW_SYSTEM_THEME: 'display.followSystemTheme',
  DISPLAY_SHOW_OPEN_IN_EDITOR: 'display.showOpenInEditorLinks',
  DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems',
  LLM_DYNAMIC_SYSTEM_PROMPT: 'llm.dynamicSystemPrompt',
  CACHE_WARMING: 'cache.warming',
  KEYBINDINGS: 'keybindings',
  RETRY_PATTERNS: 'agent.retryPatterns',
  SKILLS_DIRECTORIES: 'skills.directories',
  SEARCH_ENGINE: 'search.engine',
  SEARCH_TAVILY_API_KEY: 'search.tavilyApiKey',
  SEARCH_SEARXNG_URL: 'search.searxngUrl',
  SEARCH_SEARXNG_API_KEY: 'search.searxngApiKey',
  TOOLS_USE_RTK: 'tools.useRtk',
  TOOLS_SHELL: 'tools.shell',
} as const

export const SETTINGS_DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.DISPLAY_SHOW_THINKING]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_STATS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING]: 'true',
  [SETTINGS_KEYS.DISPLAY_THEME]: JSON.stringify({ preset: 'dark' }),
  [SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]: 'false',
  [SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS]: '300',
  [SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT]: 'false',
  [SETTINGS_KEYS.CACHE_WARMING]: 'false',
  [SETTINGS_KEYS.RETRY_PATTERNS]: JSON.stringify({ patterns: [], maxRetriesPerTurn: 10 }),
  [SETTINGS_KEYS.KEYBINDINGS]: JSON.stringify({
    terminalToggle: { type: 'double-press', key: 'Control', threshold: 300 },
    quickAction: { type: 'double-press', key: 'Shift', threshold: 300 },
    agentSwitching: [
      { type: 'chord', key: '1', modifiers: ['ctrl'] },
      { type: 'chord', key: '2', modifiers: ['ctrl'] },
      { type: 'chord', key: '3', modifiers: ['ctrl'] },
      { type: 'chord', key: '4', modifiers: ['ctrl'] },
    ],
  }),
  [SETTINGS_KEYS.TOOLS_USE_RTK]: 'false',
  [SETTINGS_KEYS.TOOLS_SHELL]: 'cmd',
}

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS]

interface SettingsRow {
  key: string
  value: string
  updated_at: string
}

export function getSetting(key: string): string | null {
  try {
    const db = getDatabase()
    const row = db
      .prepare(
        `
      SELECT value FROM settings WHERE key = ?
    `,
      )
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(key, value, now)
}

export function deleteSetting(key: string): void {
  const db = getDatabase()
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase()

  const rows = db.prepare(`SELECT key, value FROM settings`).all() as SettingsRow[]

  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

export function getMaxVisibleItems(): number {
  const setting = getSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS)
  return setting ? parseInt(setting, 10) : 0
}
