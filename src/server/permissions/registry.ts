import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import {
  permissionConfigSchema,
  EMPTY_CONFIG,
  type PermissionConfig,
  type PermissionRule,
  type StoredPermissionRule,
} from './schema.js'
import { logger } from '../utils/logger.js'
import { getSetting, setSetting, deleteSetting } from '../db/settings.js'

export type PermissionsScope = 'global' | 'project'

export function getGlobalPermissionsPath(configDir: string): string {
  return join(resolve(configDir), 'permissions.json')
}

/**
 * Project rules are personal (per user, per project), so they live in the
 * database rather than in the repository's `.openfox/` directory.
 */
export function getProjectPermissionsKey(workdir: string): string {
  return `permissions.project.${resolve(workdir)}`
}

async function readRaw(scope: PermissionsScope, configDir: string, workdir: string): Promise<string | null> {
  if (scope === 'project') return getSetting(getProjectPermissionsKey(workdir))
  try {
    return await readFile(getGlobalPermissionsPath(configDir), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writeRaw(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
  raw: string | null,
): Promise<void> {
  if (scope === 'project') {
    const key = getProjectPermissionsKey(workdir)
    if (raw === null) deleteSetting(key)
    else setSetting(key, raw)
    return
  }
  const path = getGlobalPermissionsPath(configDir)
  if (raw === null) {
    await rm(path, { force: true })
    return
  }
  await mkdir(resolve(configDir), { recursive: true })
  await writeFile(path, raw, 'utf-8')
}

/** A config as it may arrive from disk or from a client: ids not guaranteed. */
export interface PermissionConfigInput {
  version: 1
  rules: (PermissionRule & { id?: string | undefined })[]
}

/** Give every rule an id, so callers can address one by identity, not position. */
function withIds(rules: (PermissionRule & { id?: string | undefined })[]): StoredPermissionRule[] {
  return rules.map((rule) => ({ ...rule, id: rule.id ? rule.id : randomUUID() }))
}

export async function loadPermissionsConfig(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
): Promise<PermissionConfig> {
  const path = scope === 'global' ? getGlobalPermissionsPath(configDir) : getProjectPermissionsKey(workdir)
  try {
    const raw = await readRaw(scope, configDir, workdir)
    if (raw === null) return EMPTY_CONFIG
    const parsed = JSON.parse(raw)
    const config = permissionConfigSchema.parse(parsed)
    return { version: config.version, rules: withIds(config.rules) }
  } catch (err) {
    if (err instanceof Error && 'issues' in err) {
      logger.warn('permissions.json validation failed, ignoring', { path, error: String(err) })
    } else if (err instanceof Error) {
      logger.warn('permissions.json parse error, ignoring', { path, error: err.message })
    }
    return EMPTY_CONFIG
  }
}

export async function savePermissionsConfig(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
  config: PermissionConfigInput,
): Promise<PermissionConfig> {
  if (config.rules.length === 0) {
    await writeRaw(scope, configDir, workdir, null)
    return { version: 1, rules: [] }
  }
  const stored: PermissionConfig = { version: config.version, rules: withIds(config.rules) }
  await writeRaw(scope, configDir, workdir, JSON.stringify(stored, null, 2) + '\n')
  return stored
}

/**
 * Append a rule. Read-modify-write on the store rather than on a config the
 * client sent, so a stale client copy can never drop a rule added elsewhere.
 */
export async function addPermissionRule(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
  rule: PermissionRule,
): Promise<PermissionConfig> {
  const config = await loadPermissionsConfig(scope, configDir, workdir)
  const added: StoredPermissionRule = { ...rule, id: randomUUID() }
  return savePermissionsConfig(scope, configDir, workdir, { version: 1, rules: [...config.rules, added] })
}

/** Replace a rule by id, keeping its id and its position. Null when the id is gone. */
export async function updatePermissionRule(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
  id: string,
  rule: PermissionRule,
): Promise<PermissionConfig | null> {
  const config = await loadPermissionsConfig(scope, configDir, workdir)
  if (!config.rules.some((existing) => existing.id === id)) return null
  const rules = config.rules.map((existing) => (existing.id === id ? { ...rule, id } : existing))
  return savePermissionsConfig(scope, configDir, workdir, { version: 1, rules })
}

/** Remove a rule by id. Null when the id is gone. */
export async function deletePermissionRule(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
  id: string,
): Promise<PermissionConfig | null> {
  const config = await loadPermissionsConfig(scope, configDir, workdir)
  const rules = config.rules.filter((existing) => existing.id !== id)
  if (rules.length === config.rules.length) return null
  return savePermissionsConfig(scope, configDir, workdir, { version: 1, rules })
}

export async function loadMergedRules(configDir: string, workdir: string): Promise<StoredPermissionRule[]> {
  const globalConfig = await loadPermissionsConfig('global', configDir, workdir)
  const projectConfig = await loadPermissionsConfig('project', configDir, workdir)
  return [...globalConfig.rules, ...projectConfig.rules]
}
