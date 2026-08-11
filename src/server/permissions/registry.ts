import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { permissionConfigSchema, EMPTY_CONFIG, type PermissionConfig, type PermissionRule } from './schema.js'
import { logger } from '../utils/logger.js'

export type PermissionsScope = 'global' | 'project'

export function getGlobalPermissionsPath(configDir: string): string {
  return join(resolve(configDir), 'permissions.json')
}

export function getProjectPermissionsPath(workdir: string): string {
  return join(resolve(workdir), '.openfox', 'permissions.json')
}

function getPath(scope: PermissionsScope, configDir: string, workdir: string): string {
  return scope === 'global' ? getGlobalPermissionsPath(configDir) : getProjectPermissionsPath(workdir)
}

export async function loadPermissionsConfig(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
): Promise<PermissionConfig> {
  const path = getPath(scope, configDir, workdir)
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return permissionConfigSchema.parse(parsed)
  } catch (err) {
    if (err instanceof Error && 'issues' in err) {
      logger.warn('permissions.json validation failed, ignoring', { path, error: String(err) })
    } else if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('permissions.json parse error, ignoring', { path, error: err.message })
    }
    return EMPTY_CONFIG
  }
}

export async function savePermissionsConfig(
  scope: PermissionsScope,
  configDir: string,
  workdir: string,
  config: PermissionConfig,
): Promise<void> {
  const path = getPath(scope, configDir, workdir)
  if (config.rules.length === 0) {
    await rm(path, { force: true })
    return
  }
  if (scope === 'project') {
    const dir = join(resolve(workdir), '.openfox')
    await mkdir(dir, { recursive: true })
  } else {
    await mkdir(resolve(configDir), { recursive: true })
  }
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export async function loadMergedRules(configDir: string, workdir: string): Promise<PermissionRule[]> {
  const globalConfig = await loadPermissionsConfig('global', configDir, workdir)
  const projectConfig = await loadPermissionsConfig('project', configDir, workdir)
  return [...globalConfig.rules, ...projectConfig.rules]
}
