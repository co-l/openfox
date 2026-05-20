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
  LLM_DISABLE_XML_PROTECTION: 'llm.disableXmlProtection',
} as const

export const SETTINGS_DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.DISPLAY_SHOW_THINKING]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_STATS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING]: 'true',
  [SETTINGS_KEYS.DISPLAY_THEME]: JSON.stringify({ preset: 'dark' }),
  [SETTINGS_KEYS.LLM_DISABLE_XML_PROTECTION]: 'false',
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
