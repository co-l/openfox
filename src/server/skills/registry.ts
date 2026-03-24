/**
 * Skill Registry
 *
 * Discovers, loads, and manages skills from the skills directory.
 * Enable/disable state is stored in the SQLite settings table.
 */

import { readdir, readFile, writeFile, copyFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import type { SkillDefinition, SkillMetadata } from './types.js'
import { getSetting, setSetting } from '../db/settings.js'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__dirname, 'defaults')
const SKILL_EXTENSION = '.skill.md'
const SKILL_SETTING_PREFIX = 'skill.enabled.'

// ============================================================================
// Directory Helpers
// ============================================================================

function getSkillsDir(configDir: string): string {
  return join(configDir, 'skills')
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Default Skills Installation
// ============================================================================

/**
 * Copy bundled default skills to the config skills directory if they don't already exist.
 */
export async function ensureDefaultSkills(configDir: string): Promise<void> {
  const skillsDir = getSkillsDir(configDir)

  // Ensure skills directory exists
  if (!await dirExists(skillsDir)) {
    await mkdir(skillsDir, { recursive: true })
  }

  // Find bundled defaults
  let defaultFiles: string[]
  try {
    defaultFiles = (await readdir(DEFAULTS_DIR)).filter(f => f.endsWith(SKILL_EXTENSION))
  } catch {
    logger.warn('No bundled skill defaults found', { dir: DEFAULTS_DIR })
    return
  }

  // Copy each default that doesn't already exist in the target
  for (const file of defaultFiles) {
    const targetPath = join(skillsDir, file)
    if (!await dirExists(targetPath)) {
      try {
        await copyFile(join(DEFAULTS_DIR, file), targetPath)
        logger.info('Installed default skill', { file })
      } catch (err) {
        logger.error('Failed to copy default skill', { file, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}

// ============================================================================
// Skill Loading
// ============================================================================

/**
 * Load all skills from the skills directory.
 */
export async function loadAllSkills(configDir: string): Promise<SkillDefinition[]> {
  const skillsDir = getSkillsDir(configDir)

  if (!await dirExists(skillsDir)) {
    return []
  }

  let files: string[]
  try {
    files = (await readdir(skillsDir)).filter(f => f.endsWith(SKILL_EXTENSION))
  } catch {
    return []
  }

  const skills: SkillDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(skillsDir, file), 'utf-8')
      const { data, content } = matter(raw)
      const metadata = data as SkillMetadata
      if (metadata.id && content.trim()) {
        skills.push({ metadata, prompt: content.trim() })
      } else {
        logger.warn('Skipping invalid skill file', { file })
      }
    } catch (err) {
      logger.warn('Failed to parse skill file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return skills
}

/**
 * Load only enabled skills.
 */
export async function getEnabledSkills(configDir: string): Promise<SkillDefinition[]> {
  const all = await loadAllSkills(configDir)
  return all.filter(s => isSkillEnabled(s.metadata.id))
}

/**
 * Get metadata for all enabled skills (for system prompt listing).
 */
export async function getEnabledSkillMetadata(configDir: string): Promise<SkillMetadata[]> {
  const enabled = await getEnabledSkills(configDir)
  return enabled.map(s => s.metadata)
}

// ============================================================================
// Enable / Disable
// ============================================================================

/**
 * Check if a skill is enabled. Defaults to true if no setting exists.
 */
export function isSkillEnabled(skillId: string): boolean {
  const value = getSetting(`${SKILL_SETTING_PREFIX}${skillId}`)
  if (value === null) return true // enabled by default
  return value === 'true'
}

/**
 * Set whether a skill is enabled.
 */
export function setSkillEnabled(skillId: string, enabled: boolean): void {
  setSetting(`${SKILL_SETTING_PREFIX}${skillId}`, String(enabled))
}

// ============================================================================
// Skill Lookup
// ============================================================================

/**
 * Find a skill by ID from a list of loaded skills.
 */
export function findSkillById(skillId: string, skills: SkillDefinition[]): SkillDefinition | undefined {
  return skills.find(s => s.metadata.id === skillId)
}

// ============================================================================
// Skill CRUD
// ============================================================================

/**
 * Check if a skill file exists.
 */
export async function skillExists(configDir: string, skillId: string): Promise<boolean> {
  const filePath = join(getSkillsDir(configDir), `${skillId}${SKILL_EXTENSION}`)
  return dirExists(filePath)
}

/**
 * Save a skill definition to disk.
 */
export async function saveSkill(configDir: string, skill: SkillDefinition): Promise<void> {
  const skillsDir = getSkillsDir(configDir)
  if (!await dirExists(skillsDir)) {
    await mkdir(skillsDir, { recursive: true })
  }
  const filePath = join(skillsDir, `${skill.metadata.id}${SKILL_EXTENSION}`)
  const content = matter.stringify(skill.prompt, skill.metadata)
  await writeFile(filePath, content, 'utf-8')
}

/**
 * Delete a skill from disk and clean up its enabled setting.
 */
export async function deleteSkill(configDir: string, skillId: string): Promise<boolean> {
  const filePath = join(getSkillsDir(configDir), `${skillId}${SKILL_EXTENSION}`)
  try {
    await unlink(filePath)
    // Clean up the enabled setting
    const { deleteSetting } = await import('../db/settings.js')
    deleteSetting(`${SKILL_SETTING_PREFIX}${skillId}`)
    return true
  } catch {
    return false
  }
}
