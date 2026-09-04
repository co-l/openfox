import { getDatabase } from './index.js'

// ============================================================================
// Settings Operations
// ============================================================================

export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  LANGUAGE: 'agent.language',
  DISPLAY_SHOW_THINKING: 'display.showThinking',
  DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT: 'display.showVerboseToolOutput',
  DISPLAY_SHOW_STATS: 'display.showStats',
  DISPLAY_SHOW_AGENT_DEFINITIONS: 'display.showAgentDefinitions',
  DISPLAY_SHOW_WORKFLOW_BARS: 'display.showWorkflowBars',
  DISPLAY_SHOW_SYNTAX_HIGHLIGHTING: 'display.showSyntaxHighlighting',
  DISPLAY_LOCALE: 'display.locale',
  DISPLAY_THEME: 'display.theme',
  DISPLAY_USER_PRESETS: 'display.userPresets',
  DISPLAY_FOLLOW_SYSTEM_THEME: 'display.followSystemTheme',
  DISPLAY_SHOW_OPEN_IN_EDITOR: 'display.showOpenInEditorLinks',
  DISPLAY_SHOW_CHANGELOG_ON_UPDATE: 'display.showChangelogOnUpdate',
  DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems',
  DISPLAY_CUSTOM_CSS: 'display.customCss',
  DISPLAY_TERMINAL_FONT: 'display.terminalFont',
  DISPLAY_USE_NATIVE_SCROLLBARS: 'display.useNativeScrollbars',
  DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS: 'display.useNativeScrollbarsCodeBlocks',
  DISPLAY_COLLAPSE_LARGE_TOOL_CALLS: 'display.collapseLargeToolCalls',
  DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING: 'display.deferCodeHighlightWhileStreaming',
  DISPLAY_FEED_VIRTUALIZATION: 'display.feedVirtualization',
  DISPLAY_MODEL_SELECTOR_HEIGHT: 'display.modelSelectorHeight',
  DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT: 'display.collapseProvidersByDefault',
  DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT: 'display.collapseFavoritesByDefault',
  DISPLAY_MODEL_FAVORITES: 'display.modelFavorites',
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
  CONFIRM_ON_WORKSPACE_ACTIONS: 'tools.confirmOnWorkspaceActions',
  FEATURES_PER_SESSION_MCP: 'features.perSessionMcp',
  MAINTENANCE_SNAPSHOT_STREAMS_MIGRATED: 'maintenance.snapshotStreamsMigratedV1',
  PROXY_URL: 'network.proxyUrl',
  DEFAULT_AGENT: 'agent.defaultAgent',
  AGENT_MODEL_OVERRIDES: 'agent.modelOverrides',
  VSCODE_REMOTE_PREFIX: 'editor.vscodeRemotePrefix',
} as const

export const SETTINGS_DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.LANGUAGE]: 'automatic',
  [SETTINGS_KEYS.DISPLAY_LOCALE]: 'automatic',
  [SETTINGS_KEYS.DISPLAY_SHOW_THINKING]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_STATS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING]: 'true',
  [SETTINGS_KEYS.DISPLAY_THEME]: JSON.stringify({ preset: 'dark' }),
  [SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR]: 'false',
  [SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE]: 'true',
  [SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS]: '300',
  [SETTINGS_KEYS.DISPLAY_CUSTOM_CSS]: '',
  [SETTINGS_KEYS.DISPLAY_TERMINAL_FONT]:
    '"JetBrains Mono", "Cascadia Mono", "Menlo", "Consolas", "DejaVu Sans Mono", "Liberation Mono", monospace',
  [SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS]: 'false',
  [SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS]: 'false',
  [SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS]: 'false',
  [SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING]: 'false',
  [SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION]: 'false',
  [SETTINGS_KEYS.DISPLAY_MODEL_SELECTOR_HEIGHT]: 'default',
  [SETTINGS_KEYS.DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT]: 'false',
  [SETTINGS_KEYS.DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT]: 'false',
  [SETTINGS_KEYS.DISPLAY_MODEL_FAVORITES]: '[]',
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
  [SETTINGS_KEYS.CONFIRM_ON_WORKSPACE_ACTIONS]: 'false',
  [SETTINGS_KEYS.FEATURES_PER_SESSION_MCP]: 'false',
  [SETTINGS_KEYS.MAINTENANCE_SNAPSHOT_STREAMS_MIGRATED]: 'false',
  [SETTINGS_KEYS.VSCODE_REMOTE_PREFIX]: '',
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

export function pruneFavoriteModels(validProviders: Array<{ id: string; models?: Array<{ id: string }> }>): void {
  const raw = getSetting(SETTINGS_KEYS.DISPLAY_MODEL_FAVORITES)
  if (!raw) return
  try {
    const favorites = JSON.parse(raw) as string[]
    if (!Array.isArray(favorites) || favorites.length === 0) return

    const validSet = new Set<string>()
    for (const provider of validProviders) {
      for (const model of provider.models ?? []) {
        validSet.add(`${provider.id}/${model.id}`)
      }
    }

    const pruned = favorites.filter((fav) => validSet.has(fav))
    if (pruned.length !== favorites.length) {
      setSetting(SETTINGS_KEYS.DISPLAY_MODEL_FAVORITES, JSON.stringify(pruned))
    }
  } catch {
    // Ignore JSON parsing errors
  }
}

export function getMaxVisibleItems(): number {
  const setting = getSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS)
  const defaultValue = Number(SETTINGS_DEFAULTS[SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS])

  if (setting === null || setting.trim() === '') {
    return defaultValue
  }

  const value = Number(setting)
  return Number.isInteger(value) && value >= 0 ? value : defaultValue
}
