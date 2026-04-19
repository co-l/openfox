/**
 * Skill Registry
 *
 * Discovers, loads, and manages skills from the skills directory.
 * Enable/disable state is stored in the SQLite settings table.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { pathExists, getDefaultIds, loadItemsFromDir } from '../shared/item-loader.js'
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

export async function loadDefaultSkills(): Promise<SkillDefinition[]> {
  let defaults = await loadItemsFromDir<SkillDefinition>(DEFAULTS_DIR, {
    extension: SKILL_EXTENSION,
    logName: 'skill',
  })
  if (!defaults.length) {
    defaults = await loadItemsFromDir<SkillDefinition>(DEFAULTS_DIR_ALT, {
      extension: SKILL_EXTENSION,
      logName: 'skill',
    })
  }
  return defaults
}

export async function loadUserSkills(configDir: string): Promise<SkillDefinition[]> {
  return loadItemsFromDir<SkillDefinition>(getSkillsDir(configDir), {
    extension: SKILL_EXTENSION,
    logName: 'skill',
  })
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