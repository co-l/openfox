/**
 * Skill Registry
 *
 * Discovers, loads, and manages skills from the skills directory.
 * Enable/disable state is stored in the SQLite settings table.
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getBundleDir, dirExists, ensureDir, loadItems, saveItem, deleteItem, findById, getDefaultIds, restoreDefault } from '../commands/registry-utils.js'
import { getSetting, setSetting } from '../db/settings.js'
import type { SkillDefinition } from './types.js'

const DEFAULTS_DIR = 'defaults'
const DEFAULTS_DIR_ALT = 'skill-defaults'
const SKILL_EXTENSION = '.skill.md'
const SKILL_SETTING_PREFIX = 'skill.enabled.'

function getSkillsDir(configDir: string): string {
  return join(configDir, 'skills')
}

export async function ensureDefaultSkills(configDir: string): Promise<void> {
  const bundleDir = getBundleDir()
  const skillsDir = getSkillsDir(configDir)
  await ensureDir(skillsDir)

  const ids = await getDefaultIds(bundleDir, DEFAULTS_DIR, SKILL_EXTENSION)
  for (const id of ids) {
    if (!(await restoreDefault(skillsDir, bundleDir, DEFAULTS_DIR, id, SKILL_EXTENSION))) {
      await restoreDefault(skillsDir, bundleDir, DEFAULTS_DIR_ALT, id, SKILL_EXTENSION)
    }
  }
}

export async function loadAllSkills(configDir: string): Promise<SkillDefinition[]> {
  return loadItems<SkillDefinition>(getSkillsDir(configDir), SKILL_EXTENSION)
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
  const bundleDir = getBundleDir()
  const ids = await getDefaultIds(bundleDir, DEFAULTS_DIR, SKILL_EXTENSION)
  if (ids.length) return ids
  return getDefaultIds(bundleDir, DEFAULTS_DIR_ALT, SKILL_EXTENSION)
}

export async function restoreDefaultSkill(configDir: string, skillId: string): Promise<boolean> {
  const bundleDir = getBundleDir()
  const skillsDir = getSkillsDir(configDir)
  return restoreDefault(skillsDir, bundleDir, DEFAULTS_DIR, skillId, SKILL_EXTENSION)
    || restoreDefault(skillsDir, bundleDir, DEFAULTS_DIR_ALT, skillId, SKILL_EXTENSION)
}

export async function getModifiedDefaultSkillIds(configDir: string): Promise<string[]> {
  const bundleDir = getBundleDir()
  const ids = await getDefaultSkillIds()
  const files = (await readdir(join(bundleDir, DEFAULTS_DIR))).filter(f => f.endsWith(SKILL_EXTENSION))
  return files.map(f => f.replace(SKILL_EXTENSION, '')).filter(id => ids.includes(id))
}

export async function restoreAllDefaultSkills(configDir: string): Promise<number> {
  const ids = await getDefaultSkillIds()
  let count = 0
  for (const id of ids) {
    if (await restoreDefaultSkill(configDir, id)) count++
  }
  return count
}

export function findSkillById(skillId: string, skills: SkillDefinition[]): SkillDefinition | undefined {
  return findById(skillId, skills)
}

export async function skillExists(configDir: string, skillId: string): Promise<boolean> {
  return dirExists(join(getSkillsDir(configDir), `${skillId}${SKILL_EXTENSION}`))
}

export async function saveSkill(configDir: string, skill: SkillDefinition): Promise<void> {
  return saveItem(getSkillsDir(configDir), skill.metadata.id, SKILL_EXTENSION, skill)
}

export async function deleteSkill(configDir: string, skillId: string): Promise<boolean> {
  const deleted = await deleteItem(getSkillsDir(configDir), skillId, SKILL_EXTENSION)
  if (deleted) {
    const { deleteSetting } = await import('../db/settings.js')
    deleteSetting(`${SKILL_SETTING_PREFIX}${skillId}`)
  }
  return deleted
}