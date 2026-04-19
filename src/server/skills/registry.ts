/**
 * Skill Registry
 *
 * Discovers, loads, and manages skills from the skills directory.
 * Enable/disable state is stored in the SQLite settings table.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { readdir, readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { logger } from '../utils/logger.js'
import { getSetting, setSetting, deleteSetting } from '../db/settings.js'
import type { SkillDefinition } from './types.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'skill-defaults')
const SKILL_EXTENSION = '.skill.md'
const SKILL_SETTING_PREFIX = 'skill.enabled.'

function getSkillsDir(configDir: string): string {
  return join(configDir, 'skills')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function loadDefaultSkills(): Promise<SkillDefinition[]> {
  let defaults: SkillDefinition[] = []
  try {
    defaults = await loadSkillsFromDir(DEFAULTS_DIR)
  } catch { /* try alt */ }
  if (!defaults.length) {
    try {
      defaults = await loadSkillsFromDir(DEFAULTS_DIR_ALT)
    } catch { /* no defaults */ }
  }
  return defaults
}

async function loadSkillsFromDir(dir: string): Promise<SkillDefinition[]> {
  if (!await pathExists(dir)) {
    return []
  }
  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(SKILL_EXTENSION))
  } catch {
    return []
  }
  const skills: SkillDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const { data, content } = matter(raw)
      if ((data as { id?: string }).id && content.trim()) {
        skills.push({
          metadata: data as SkillDefinition['metadata'],
          prompt: content.trim(),
        })
      } else {
        logger.warn('Skipping invalid skill file', { file })
      }
    } catch (err) {
      logger.warn('Failed to parse skill file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return skills
}

export async function loadUserSkills(configDir: string): Promise<SkillDefinition[]> {
  return loadSkillsFromDir(getSkillsDir(configDir))
}

export async function loadAllSkills(configDir: string): Promise<SkillDefinition[]> {
  const [defaultSkills, userSkills] = await Promise.all([
    loadDefaultSkills(),
    loadUserSkills(configDir),
  ])

  const skillMap = new Map<string, SkillDefinition>()
  for (const skill of defaultSkills) {
    skillMap.set(skill.metadata.id, skill)
  }
  for (const skill of userSkills) {
    skillMap.set(skill.metadata.id, skill)
  }

  return Array.from(skillMap.values())
}

export async function getEnabledSkills(configDir: string): Promise<SkillDefinition[]> {
  const all = await loadAllSkills(configDir)
  return all.filter(s => isSkillEnabled(s.metadata.id))
}

export async function getEnabledSkillMetadata(configDir: string) {
  const enabled = await getEnabledSkills(configDir)
  return enabled.map(s => s.metadata)
}

export function isSkillEnabled(skillId: string): boolean {
  const value = getSetting(`${SKILL_SETTING_PREFIX}${skillId}`)
  if (value === null) return true
  return value === 'true'
}

export function setSkillEnabled(skillId: string, enabled: boolean): void {
  setSetting(`${SKILL_SETTING_PREFIX}${skillId}`, String(enabled))
}

async function getDefaultIds(dir: string, extension: string): Promise<string[]> {
  try {
    const files = (await readdir(dir)).filter(f => f.endsWith(extension))
    return files.map(f => f.replace(extension, ''))
  } catch {
    return []
  }
}

export async function getDefaultSkillIds(): Promise<string[]> {
  const ids = await getDefaultIds(DEFAULTS_DIR, SKILL_EXTENSION)
  if (ids.length) return ids
  return getDefaultIds(DEFAULTS_DIR_ALT, SKILL_EXTENSION)
}

export async function getDefaultSkillContent(skillId: string): Promise<SkillDefinition | null> {
  const defaults = await loadDefaultSkills()
  return defaults.find(s => s.metadata.id === skillId) ?? null
}

export async function isDefaultSkill(skillId: string): Promise<boolean> {
  const defaultIds = await getDefaultSkillIds()
  return defaultIds.includes(skillId)
}

export function findSkillById(skillId: string, skills: SkillDefinition[]): SkillDefinition | undefined {
  return skills.find(s => s.metadata.id === skillId)
}

export async function skillExists(configDir: string, skillId: string): Promise<boolean> {
  return pathExists(join(getSkillsDir(configDir), `${skillId}${SKILL_EXTENSION}`))
}

export async function saveSkill(configDir: string, skill: SkillDefinition): Promise<void> {
  const skillsDir = getSkillsDir(configDir)
  if (!await pathExists(skillsDir)) {
    await mkdir(skillsDir, { recursive: true })
  }
  const filePath = join(skillsDir, `${skill.metadata.id}${SKILL_EXTENSION}`)
  const content = matter.stringify(skill.prompt, skill.metadata)
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteSkill(configDir: string, skillId: string): Promise<{ success: boolean; reason?: string }> {
  const isDefault = await isDefaultSkill(skillId)
  if (isDefault) {
    return { success: false, reason: 'Cannot delete built-in defaults' }
  }
  const filePath = join(getSkillsDir(configDir), `${skillId}${SKILL_EXTENSION}`)
  try {
    await unlink(filePath)
    deleteSetting(`${SKILL_SETTING_PREFIX}${skillId}`)
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function getOverrideSkillIds(configDir: string): Promise<string[]> {
  const [defaultIds, userSkills] = await Promise.all([
    getDefaultSkillIds(),
    loadUserSkills(configDir),
  ])
  return userSkills
    .map(skill => skill.metadata.id)
    .filter(id => defaultIds.includes(id))
}