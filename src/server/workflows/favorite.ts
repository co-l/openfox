/**
 * Favorite workflow resolution.
 *
 * Mirrors the "default agent" resolution pattern: a project-scoped override
 * (projects.favorite_workflow_id, set via project settings) wins over the
 * global DB setting (workflow.favoriteWorkflow, set in Settings > Advanced).
 * An empty/absent value means "no favorite": auto-launch stays disabled and
 * the manual workflow-choice behavior applies.
 */

import type { WorkflowScope } from '../../shared/types.js'
import {
  clearProjectFavoriteWorkflowId,
  getProjectFavoriteWorkflowId,
  getProjectByWorkdir,
  listProjects,
} from '../db/projects.js'
import { getSetting, setSetting, SETTINGS_KEYS } from '../db/settings.js'
import { logger } from '../utils/logger.js'
import { listAvailableWorkflows } from './registry.js'

export interface ResolvedFavoriteWorkflow {
  id: string
  name: string
  scope: WorkflowScope
}

/** Raw configured favorite id, project-scoped override first. Empty when unset. */
export function resolveFavoriteWorkflowId(projectId?: string): string {
  if (projectId) {
    try {
      const projectFavorite = getProjectFavoriteWorkflowId(projectId)
      if (projectFavorite && projectFavorite.trim().length > 0) {
        return projectFavorite.trim()
      }
    } catch (err) {
      logger.debug('Failed to read project favoriteWorkflowId from DB', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    const dbSetting = getSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)
    if (dbSetting && dbSetting.trim().length > 0) {
      return dbSetting.trim()
    }
  } catch (err) {
    logger.debug('Failed to read favoriteWorkflow from DB settings', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return ''
}

/**
 * Resolve the configured favorite workflow against the effective catalog for
 * the project (deduplicated by id with project > user > builtin precedence, so
 * a launch by this id always picks that same effective definition). Returns
 * null when no favorite is configured or the referenced workflow no longer
 * exists (deleted) — callers fall back to manual choice.
 */
export async function resolveFavoriteWorkflow(
  configDir: string,
  projectId?: string,
  projectDir?: string,
): Promise<ResolvedFavoriteWorkflow | null> {
  const favoriteId = resolveFavoriteWorkflowId(projectId)
  if (!favoriteId) return null

  try {
    const catalog = await listAvailableWorkflows(configDir, projectDir)
    const entry = catalog.find((w) => w.id === favoriteId)
    if (!entry) return null
    return { id: entry.id, name: entry.name, scope: entry.scope }
  } catch (err) {
    logger.debug('Failed to resolve favorite workflow against catalog', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * After a workflow delete, reset every favorite-workflow config that still
 * points at the deleted id and no longer resolves anywhere: the global setting
 * (checked against the builtin/user catalog only — project-scoped ids can never
 * be configured globally) and each project override (checked against its own
 * effective catalog). Keeps working copies intact: deleting a project override
 * that shadows a same-id global workflow leaves favorites on that id alone.
 */
export async function sweepFavoritesAfterDelete(
  deletedId: string,
  configDir: string,
  deletedProjectDir?: string,
): Promise<void> {
  if (!deletedId) return

  const globalCatalog = await listAvailableWorkflows(configDir)
  if (globalCatalog.some((w) => w.id === deletedId)) return

  if (resolveFavoriteWorkflowId(undefined) === deletedId) {
    try {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, '')
    } catch (err) {
      logger.debug('Failed to clear global favorite workflow', { error: String(err) })
    }
  }

  const projectDirs = new Set<string>()
  if (deletedProjectDir) projectDirs.add(deletedProjectDir)
  for (const workdir of projectWorkdirsReferencing(deletedId)) projectDirs.add(workdir)

  for (const dir of projectDirs) {
    try {
      const catalog = await listAvailableWorkflows(configDir, dir)
      if (catalog.some((w) => w.id === deletedId)) continue
      const project = getProjectByWorkdir(dir)
      if (project && resolveFavoriteWorkflowId(project.id) === deletedId) {
        clearProjectFavoriteWorkflowId(project.id)
      }
    } catch (err) {
      logger.debug('Failed to sweep project favorite workflow', { dir, error: String(err) })
    }
  }
}

function projectWorkdirsReferencing(deletedId: string): string[] {
  try {
    return listProjects()
      .filter((p) => p.favoriteWorkflowId === deletedId)
      .map((p) => p.workdir)
  } catch (err) {
    logger.debug('Failed to list projects for favorite sweep', { error: String(err) })
    return []
  }
}
