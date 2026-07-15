/**
 * Skill Registry
 *
 * Discovers, loads, and manages skills from the skills directory.
 * Enable/disable state is stored in the SQLite settings table.
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { writeFile, mkdir, unlink, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import matter from 'gray-matter'
import { pathExists, getDefaultIds, loadItemsFromDir, deleteItemFromDir } from '../shared/item-loader.js'
import { getSetting, setSetting, deleteSetting } from '../db/settings.js'
import type { SkillDefinition, SkillSource } from './types.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'skill-defaults')
const SKILL_EXTENSION = '.skill.md'
const SKILL_SETTING_PREFIX = 'skill.enabled.'
const PORTABLE_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function getSkillsDir(configDir: string): string {
  return join(configDir, 'skills')
}

function getProjectSkillsDir(projectDir: string): string {
  return join(projectDir, '.openfox', 'skills')
}

export interface SkillDiscoveryOptions {
  homeDir?: string
  selectedDirectories?: string[]
}

function portableDisplayName(data: Record<string, unknown>, id: string): string {
  const metadata = data['metadata']
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return id
  const openfox = (metadata as Record<string, unknown>)['openfox']
  if (!openfox || typeof openfox !== 'object' || Array.isArray(openfox)) return id
  const displayName = (openfox as Record<string, unknown>)['displayName']
  return typeof displayName === 'string' && displayName.trim() ? displayName : id
}

function portableVersion(data: Record<string, unknown>): string {
  const metadata = data['metadata']
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const version = (metadata as Record<string, unknown>)['version']
    if (version !== undefined) return String(version)
  }
  return data['version'] === undefined ? '' : String(data['version'])
}

async function loadPortableSkills(dir: string, source: SkillSource): Promise<SkillDefinition[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: SkillDefinition[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const packageDir = join(dir, entry.name)
    const entrypoint = join(packageDir, 'SKILL.md')
    try {
      const content = await readFile(entrypoint, 'utf-8')
      const parsed = matter(content)
      const data = parsed.data as Record<string, unknown>
      const id = typeof data['name'] === 'string' ? data['name'].trim() : ''
      const description = typeof data['description'] === 'string' ? data['description'].trim() : ''
      const prompt = parsed.content.trim()
      if (!id || !description || !prompt) continue
      const resolvedDirectory = await realpath(packageDir)
      const warnings: string[] = []
      if (id.length > 64 || !PORTABLE_NAME_REGEX.test(id)) {
        warnings.push('Skill name must use 1-64 lowercase letters, numbers, and single hyphens')
      }
      if (id !== entry.name) {
        warnings.push(`Skill name "${id}" does not match package directory "${entry.name}"`)
      }
      skills.push({
        metadata: {
          id,
          name: portableDisplayName(data, id),
          description,
          version: portableVersion(data),
        },
        prompt,
        rawMetadata: data,
        entrypoint,
        directory: resolvedDirectory,
        source,
        legacy: false,
        warnings,
      })
    } catch {
      // Invalid or unreadable packages do not block discovery.
    }
  }
  return skills
}

async function annotateLegacySkills(
  skills: SkillDefinition[],
  dir: string,
  source: SkillSource,
): Promise<SkillDefinition[]> {
  return Promise.all(
    skills.map(async (skill) => {
      const entrypoint = join(dir, `${skill.metadata.id}${SKILL_EXTENSION}`)
      let resolvedEntrypoint = entrypoint
      try {
        resolvedEntrypoint = await realpath(entrypoint)
      } catch {
        // Loader already verified readability; retain configured path if realpath races.
      }
      return {
        ...skill,
        rawMetadata: { ...skill.metadata },
        entrypoint: resolvedEntrypoint,
        directory: dirname(resolvedEntrypoint),
        source,
        legacy: true,
        warnings: ['Legacy .skill.md format'],
      }
    }),
  )
}

async function loadSkillsDirectory(dir: string, source: SkillSource): Promise<SkillDefinition[]> {
  const [legacyRaw, portable] = await Promise.all([
    loadItemsFromDir<SkillDefinition>(dir, { extension: SKILL_EXTENSION, logName: 'skill' }),
    loadPortableSkills(dir, source),
  ])
  const legacy = await annotateLegacySkills(legacyRaw, dir, source)
  const merged = new Map(legacy.map((skill) => [skill.metadata.id, skill]))
  for (const skill of portable) merged.set(skill.metadata.id, skill)
  return [...merged.values()]
}

function getSelectedSkillDirectories(): string[] {
  const raw = getSetting('skills.directories')
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
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
  return annotateLegacySkills(
    defaults,
    defaults.length ? ((await pathExists(DEFAULTS_DIR)) ? DEFAULTS_DIR : DEFAULTS_DIR_ALT) : DEFAULTS_DIR,
    'bundled',
  )
}

export async function loadUserSkills(configDir: string): Promise<SkillDefinition[]> {
  return loadSkillsDirectory(getSkillsDir(configDir), 'global-openfox')
}

export async function loadProjectSkills(projectDir: string): Promise<SkillDefinition[]> {
  return loadSkillsDirectory(getProjectSkillsDir(projectDir), 'project-openfox')
}

export async function loadAllSkills(
  configDir: string,
  projectDir?: string,
  options: SkillDiscoveryOptions = {},
): Promise<SkillDefinition[]> {
  return (await loadAllSkillsWithDiagnostics(configDir, projectDir, options)).skills
}

export async function loadAllSkillsWithDiagnostics(
  configDir: string,
  projectDir?: string,
  options: SkillDiscoveryOptions = {},
): Promise<{ skills: SkillDefinition[]; diagnostics: string[] }> {
  const home = options.homeDir ?? homedir()
  const selected = (options.selectedDirectories ?? getSelectedSkillDirectories()).map((dir) =>
    dir === '~' ? home : dir.startsWith('~/') ? join(home, dir.slice(2)) : dir,
  )
  const locations: Array<Promise<SkillDefinition[]>> = [
    loadDefaultSkills(),
    loadSkillsDirectory(join(home, '.agents', 'skills'), 'global-shared'),
    loadUserSkills(configDir),
    ...selected.map((dir) => loadSkillsDirectory(dir, 'selected')),
    ...(projectDir
      ? [loadSkillsDirectory(join(projectDir, '.agents', 'skills'), 'project-shared'), loadProjectSkills(projectDir)]
      : []),
  ]
  const groups = await Promise.all(locations)
  const skillMap = new Map<string, SkillDefinition>()
  const diagnostics: string[] = []
  for (const group of groups) {
    for (const skill of group) {
      const previous = skillMap.get(skill.metadata.id)
      if (previous) {
        if (previous.directory === skill.directory && previous.legacy === skill.legacy) {
          diagnostics.push(`Skill "${skill.metadata.id}" reached through multiple paths`)
        } else {
          diagnostics.push(
            `Skill "${skill.metadata.id}" from ${skill.source ?? 'unknown'} overrides ${previous.source ?? 'unknown'}`,
          )
        }
      }
      skillMap.set(skill.metadata.id, skill)
    }
  }

  return { skills: Array.from(skillMap.values()), diagnostics }
}

export async function getEnabledSkills(configDir: string, projectDir?: string): Promise<SkillDefinition[]> {
  const all = await loadAllSkills(configDir, projectDir)
  return all.filter((s) => isSkillEnabled(s.metadata.id))
}

export async function getEnabledSkillMetadata(configDir: string, projectDir?: string) {
  const enabled = await getEnabledSkills(configDir, projectDir)
  return enabled.map((s) => s.metadata)
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
  return defaults.find((s) => s.metadata.id === skillId) ?? null
}

export async function isDefaultSkill(skillId: string): Promise<boolean> {
  const defaultIds = await getDefaultSkillIds()
  return defaultIds.includes(skillId)
}

export function findSkillById(skillId: string, skills: SkillDefinition[]): SkillDefinition | undefined {
  return skills.find((s) => s.metadata.id === skillId)
}

export async function skillExists(configDir: string, skillId: string, projectDir?: string): Promise<boolean> {
  if (await pathExists(join(getSkillsDir(configDir), `${skillId}${SKILL_EXTENSION}`))) return true
  if (await pathExists(join(getSkillsDir(configDir), skillId, 'SKILL.md'))) return true
  if (projectDir && (await pathExists(join(getProjectSkillsDir(projectDir), `${skillId}${SKILL_EXTENSION}`))))
    return true
  if (projectDir && (await pathExists(join(getProjectSkillsDir(projectDir), skillId, 'SKILL.md')))) return true
  return false
}

function portableFrontmatter(skill: SkillDefinition): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (skill.metadata.version) metadata['version'] = skill.metadata.version
  if (skill.metadata.name !== skill.metadata.id) {
    metadata['openfox'] = { displayName: skill.metadata.name }
  }
  return {
    name: skill.metadata.id,
    description: skill.metadata.description,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  }
}

async function savePortableSkill(dir: string, skill: SkillDefinition): Promise<void> {
  const packageDir = join(dir, skill.metadata.id)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'SKILL.md'), matter.stringify(skill.prompt, portableFrontmatter(skill)), 'utf-8')
}

export async function saveSkill(configDir: string, skill: SkillDefinition): Promise<void> {
  await savePortableSkill(getSkillsDir(configDir), skill)
}

export async function saveSkillToProject(projectDir: string, skill: SkillDefinition): Promise<void> {
  await savePortableSkill(getProjectSkillsDir(projectDir), skill)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function updatedPortableFrontmatter(
  existing: SkillDefinition,
  metadata: SkillDefinition['metadata'],
): Record<string, unknown> {
  const frontmatter = { ...(existing.rawMetadata ?? {}) }
  const portableMetadata = { ...asRecord(frontmatter['metadata']) }
  const openfox = { ...asRecord(portableMetadata['openfox']) }
  frontmatter['name'] = existing.metadata.id
  frontmatter['description'] = metadata.description
  if (metadata.version) portableMetadata['version'] = metadata.version
  else delete portableMetadata['version']
  if (metadata.name !== existing.metadata.id) openfox['displayName'] = metadata.name
  else delete openfox['displayName']
  if (Object.keys(openfox).length) portableMetadata['openfox'] = openfox
  else delete portableMetadata['openfox']
  if (Object.keys(portableMetadata).length) frontmatter['metadata'] = portableMetadata
  else delete frontmatter['metadata']
  return frontmatter
}

function canModifySkill(existing: SkillDefinition): boolean {
  if (existing.source === 'global-openfox' || existing.source === 'project-openfox') return true
  return (
    !existing.legacy &&
    (existing.source === 'global-shared' || existing.source === 'selected' || existing.source === 'project-shared')
  )
}

export async function updateOwnedSkill(
  existing: SkillDefinition,
  changes: Partial<SkillDefinition>,
): Promise<SkillDefinition | null> {
  if (!existing.entrypoint || !canModifySkill(existing)) return null
  const normalizedMetadata = {
    ...existing.metadata,
    ...(changes.metadata ?? {}),
    id: existing.metadata.id,
  }
  if (!existing.legacy) {
    const frontmatter = updatedPortableFrontmatter(existing, normalizedMetadata)
    const updated = {
      ...existing,
      ...changes,
      metadata: normalizedMetadata,
      rawMetadata: frontmatter,
      prompt: changes.prompt ?? existing.prompt,
    }
    await writeFile(existing.entrypoint, matter.stringify(updated.prompt, frontmatter), 'utf-8')
    return updated
  }
  const metadata = {
    ...(existing.rawMetadata ?? existing.metadata),
    ...(changes.metadata ?? {}),
    id: existing.metadata.id,
  }
  const updated: SkillDefinition = {
    ...existing,
    ...changes,
    metadata: metadata as SkillDefinition['metadata'],
    rawMetadata: metadata,
    prompt: changes.prompt ?? existing.prompt,
  }
  await writeFile(existing.entrypoint, matter.stringify(updated.prompt, metadata), 'utf-8')
  return updated
}

export async function deleteOwnedSkill(existing: SkillDefinition): Promise<{ success: boolean; reason?: string }> {
  if (!existing.entrypoint || !canModifySkill(existing)) {
    return { success: false, reason: 'This skill is read-only' }
  }
  try {
    if (existing.legacy) await unlink(existing.entrypoint)
    else await rm(dirname(existing.entrypoint), { recursive: true })
    deleteSetting(`${SKILL_SETTING_PREFIX}${existing.metadata.id}`)
    return { success: true }
  } catch {
    return { success: false, reason: 'Cannot delete this skill' }
  }
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

export async function deleteProjectSkill(
  projectDir: string,
  skillId: string,
): Promise<{ success: boolean; reason?: string }> {
  return deleteItemFromDir(getProjectSkillsDir(projectDir), skillId, SKILL_EXTENSION)
}

export async function getOverrideSkillIds(configDir: string, projectDir?: string): Promise<string[]> {
  const [defaultIds, userSkills, projectSkills] = await Promise.all([
    getDefaultSkillIds(),
    loadUserSkills(configDir),
    projectDir ? loadProjectSkills(projectDir) : [],
  ])
  const userOverrides = userSkills.map((skill) => skill.metadata.id).filter((id) => defaultIds.includes(id))
  const projectOverrides = projectSkills.map((skill) => skill.metadata.id).filter((id) => defaultIds.includes(id))
  return [...userOverrides, ...projectOverrides]
}
