/**
 * Claude Code Compatibility
 *
 * Claude Code stores its project configuration under `.claude/` and its memory
 * in `CLAUDE.md`. When compatibility is on, OpenFox also reads those locations
 * (skills, memory files, `@file` imports) instead of only its own conventions.
 *
 * The `compat.claudeCode` setting is tri-state:
 *   - `auto` (default) — enabled when the project looks like a Claude Code project
 *   - `true`           — always enabled
 *   - `false`          — always disabled
 */

import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { getSetting } from '../db/settings.js'

const CLAUDE_COMPAT_SETTING = 'compat.claudeCode'

/** Directory Claude Code keeps its project configuration in. */
export const CLAUDE_DIR = '.claude'

/** Claude Code memory filename, both at the project root and inside `.claude/`. */
export const CLAUDE_MEMORY_FILENAME = 'CLAUDE.md'

/** Presence of any of these in a directory marks it as a Claude Code project. */
const PROJECT_MARKERS = [CLAUDE_DIR, CLAUDE_MEMORY_FILENAME]

export type ClaudeCompatMode = 'auto' | 'enabled' | 'disabled'

export function readClaudeCompatMode(): ClaudeCompatMode {
  const raw = getSetting(CLAUDE_COMPAT_SETTING)
  if (raw === 'true') return 'enabled'
  if (raw === 'false') return 'disabled'
  return 'auto'
}

/** True when the directory carries a Claude Code marker (`.claude/` or `CLAUDE.md`). */
export async function isClaudeCodeProject(dir: string): Promise<boolean> {
  const checks = await Promise.all(
    PROJECT_MARKERS.map(async (marker) => {
      try {
        await access(join(dir, marker), constants.R_OK)
        return true
      } catch {
        return false
      }
    }),
  )
  return checks.includes(true)
}

/**
 * Resolve whether Claude Code compatibility applies for a directory.
 * `override` short-circuits the setting entirely (used by callers and tests).
 */
export async function resolveClaudeCompat(dir?: string, override?: boolean): Promise<boolean> {
  if (override !== undefined) return override
  const mode = readClaudeCompatMode()
  if (mode !== 'auto') return mode === 'enabled'
  return dir ? isClaudeCodeProject(dir) : false
}
