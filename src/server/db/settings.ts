import { getDatabase } from './index.js'

// ============================================================================
// Settings Operations
// ============================================================================

// Well-known settings keys
export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  DISPLAY_SHOW_THINKING: 'display.showThinking',
  DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT: 'display.showVerboseToolOutput',
  DISPLAY_SHOW_STATS: 'display.showStats',
  DISPLAY_SHOW_AGENT_DEFINITIONS: 'display.showAgentDefinitions',
  DISPLAY_SHOW_WORKFLOW_BARS: 'display.showWorkflowBars',
  DISPLAY_THEME: 'display.theme',
  DISPLAY_USER_PRESETS: 'display.userPresets',
} as const

export const SETTINGS_DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.DISPLAY_SHOW_THINKING]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_STATS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS]: 'true',
  [SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS]: 'true',
}

export type SettingsKey = typeof SETTINGS_KEYS[keyof typeof SETTINGS_KEYS]

interface SettingsRow {
  key: string
  value: string
  updated_at: string
}

/**
 * Get a setting value by key.
 */
export function getSetting(key: string): string | null {
  const db = getDatabase()
  
  const row = db.prepare(`
    SELECT value FROM settings WHERE key = ?
  `).get(key) as { value: string } | undefined
  
  return row?.value ?? null
}

/**
 * Set a setting value. Creates if not exists, updates if exists.
 */
export function setSetting(key: string, value: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now)
}

/**
 * Delete a setting by key.
 */
export function deleteSetting(key: string): void {
  const db = getDatabase()
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
}

/**
 * Get all settings as a key-value object.
 */
export function getAllSettings(): Record<string, string> {
  const db = getDatabase()
  
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as SettingsRow[]
  
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}
