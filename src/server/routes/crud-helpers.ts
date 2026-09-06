import { Router } from 'express'
import { join } from 'node:path'
import { pathExists, findFileByInternalId } from '../shared/item-loader.js'
import { normalizeWorkflowScope } from '../workflows/registry.js'
import type { WorkflowLaunchScope, WorkflowScope } from '../../shared/types.js'
import { serverT } from '../i18n.js'

export function computeOverrideIds<T extends { metadata: { id: string } }>(defaults: T[], userItems: T[]): string[] {
  return userItems.filter((u) => defaults.some((d) => d.metadata.id === u.metadata.id)).map((u) => u.metadata.id)
}

export function resolveProjectDir(req: { query: Record<string, unknown> }, fallback?: string): string | undefined {
  const workdir = req.query['workdir']
  if (typeof workdir !== 'string') return fallback
  const trimmed = workdir.trim()
  return trimmed ? trimmed : fallback
}

/** Resolve a ?scope= query param; anything invalid falls back to 'auto' (server precedence). */
export function resolveScope(req: { query: Record<string, unknown> }): WorkflowLaunchScope {
  const scope = req.query['scope']
  return normalizeWorkflowScope(typeof scope === 'string' ? scope : undefined)
}

async function loadItemsForScope<T>(
  config: Pick<CrudRouteConfig<T>, 'loadDefaults' | 'loadUser' | 'loadProject' | 'loadAll'>,
  configDir: string,
  projectDir: string | undefined,
  scope: WorkflowLaunchScope,
): Promise<T[]> {
  if (scope === 'builtin') return config.loadDefaults()
  if (scope === 'user') return config.loadUser(configDir)
  if (scope === 'project') return projectDir ? config.loadProject(projectDir) : []
  return config.loadAll(configDir, projectDir)
}

export interface LoadFunctions<T> {
  loadDefaults: () => Promise<T[]>
  loadUser: (configDir: string) => Promise<T[]>
}

export async function loadAllItems<T>(
  loadDefaults: () => Promise<T[]>,
  loadUser: (configDir: string) => Promise<T[]>,
  configDir: string,
): Promise<[defaults: T[], userItems: T[]]> {
  return Promise.all([loadDefaults(), loadUser(configDir)]) as Promise<[T[], T[]]>
}

const ID_REGEX = /^[a-z0-9-]+$/

export function validateNameIdPrompt(body: Record<string, unknown>): string | null {
  const meta = body['metadata'] as Record<string, unknown> | undefined
  if (!meta?.['name'] || !body['prompt'])
    return serverT({
      en: 'Missing required fields: metadata.name, prompt',
      fr: 'Champs requis manquants : metadata.name, prompt',
    })
  if (meta['id'] && !ID_REGEX.test(String(meta['id'])))
    return serverT({
      en: 'ID must be lowercase alphanumeric with hyphens only',
      fr: 'L’ID doit être en minuscules alphanumériques, avec des tirets uniquement',
    })
  return null
}

export function getProjectItemPath(projectDir: string, dirName: string, id: string, ext: string): string {
  return join(projectDir, '.openfox', dirName, `${id}${ext}`)
}

export async function isProjectItem(
  projectDir: string | undefined,
  dirName: string,
  id: string,
  ext: string,
): Promise<boolean> {
  if (!projectDir) return false
  // Fast path: check if {id}{ext} exists
  if (await pathExists(getProjectItemPath(projectDir, dirName, id, ext))) return true
  // Slow path: scan directory for a file whose internal ID matches
  const dir = join(projectDir, '.openfox', dirName)
  const found = await findFileByInternalId(dir, id, ext)
  return found !== null
}

export interface CrudRouteConfig<T> {
  dirName: string
  ext: string
  loadDefaults: () => Promise<T[]>
  loadUser: (configDir: string) => Promise<T[]>
  loadProject: (projectDir: string) => Promise<T[]>
  loadAll: (configDir: string, projectDir?: string) => Promise<T[]>
  findById: (id: string, items: T[]) => T | undefined
  save: (configDir: string, item: T) => Promise<void>
  saveToProject: (projectDir: string, item: T) => Promise<void>
  delete: (configDir: string, id: string) => Promise<{ success: boolean; reason?: string }>
  deleteProject: (projectDir: string, id: string) => Promise<{ success: boolean; reason?: string }>
  exists: (configDir: string, id: string, projectDir?: string) => Promise<boolean>
  isDefault: (id: string) => Promise<boolean>
  getDefaultIds?: () => Promise<string[]>
  validateCreate?: (body: Record<string, unknown>) => string | null
  mapToResponse: (item: T) => { [key: string]: unknown }
  /** Opt in to scope annotation (GET /) and ?scope= handling (GET/:id, PUT, DELETE). Workflows only. */
  annotateScope?: boolean
  extraGetData?: (effectiveProjectDir?: string) => Promise<{ [key: string]: unknown }>
  /** Runs after a successful delete; used by workflows to prune dangling favorite references. */
  afterDelete?: (id: string, ctx: { configDir: string; projectDir?: string }) => Promise<void> | void
  extraRoutes?: (router: Router) => void
}

export function createCrudRoutes<T extends { metadata: { id: string; name: string } }>(
  config: CrudRouteConfig<T>,
  configDir: string,
  projectDir?: string,
): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const [defaults, userItems, projectItems] = await Promise.all([
      config.loadDefaults(),
      config.loadUser(configDir),
      effectiveProjectDir ? config.loadProject(effectiveProjectDir) : [],
    ])
    const userOverrideIds = computeOverrideIds(defaults, userItems)
    const projectOverrideIds = computeOverrideIds(defaults, projectItems)
    const extra = config.extraGetData ? await config.extraGetData(effectiveProjectDir) : {}
    const annotate = (item: { [key: string]: unknown }, scope: WorkflowScope) => ({ ...item, scope })
    const mapWithScope = (items: T[], scope: WorkflowScope) =>
      config.annotateScope
        ? items.map((i) => annotate(config.mapToResponse(i), scope))
        : items.map(config.mapToResponse)
    res.json({
      defaults: mapWithScope(defaults, 'builtin'),
      userItems: mapWithScope(userItems, 'user'),
      projectItems: mapWithScope(projectItems, 'project'),
      overrideIds: [...userOverrideIds, ...projectOverrideIds],
      ...extra,
    })
  })

  router.get('/defaults/:id', async (req, res) => {
    const { id } = req.params
    const allDefaults = await config.loadDefaults()
    const item = allDefaults.find((d) => d.metadata.id === id)
    if (!item) {
      return res.status(404).json({ error: serverT({ en: 'Default not found', fr: 'Élément par défaut introuvable' }) })
    }
    res.json(item)
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = config.getDefaultIds ? await config.getDefaultIds() : []
    res.json({ ids })
  })

  // Register extra routes before the /:id bucket so static sub-paths
  // (e.g. GET /template-variables) are not shadowed by the id wildcard.
  config.extraRoutes?.(router)

  router.get('/:id', async (req, res) => {
    const { id } = req.params
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const scope = config.annotateScope ? resolveScope(req) : 'auto'
    const items = await loadItemsForScope(config, configDir, effectiveProjectDir, scope)
    const item = config.findById(id, items)
    if (!item) {
      return res.status(404).json({ error: serverT({ en: 'Not found', fr: 'Introuvable' }) })
    }
    res.json(item)
  })

  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const meta = body['metadata'] as Record<string, unknown> | undefined
    const customError = config.validateCreate?.(body)
    if (!meta?.['id'] || customError) {
      return res
        .status(400)
        .json({ error: customError ?? serverT({ en: 'Missing required fields', fr: 'Champs requis manquants' }) })
    }
    const id = String(meta['id'])
    const destination = (body['destination'] as 'project' | 'user') ?? 'user'
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    if (destination === 'project' && !effectiveProjectDir) {
      return res
        .status(400)
        .json({ error: serverT({ en: 'No project directory configured', fr: 'Aucun répertoire de projet configuré' }) })
    }
    const exists = await config.exists(configDir, id, effectiveProjectDir)
    if (exists) {
      return res.status(409).json({
        error: serverT({ en: 'An item with this ID already exists', fr: 'Un élément avec cet ID existe déjà' }),
      })
    }
    if (destination === 'project') {
      await config.saveToProject(effectiveProjectDir!, body as unknown as T)
    } else {
      await config.save(configDir, body as unknown as T)
    }
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const items = await config.loadAll(configDir, effectiveProjectDir)
    const existing = config.findById(id, items)
    if (!existing) {
      return res.status(404).json({ error: serverT({ en: 'Not found', fr: 'Introuvable' }) })
    }
    const body = req.body as Record<string, unknown>
    const meta = body['metadata'] as Record<string, unknown> | undefined
    const updated = {
      ...existing,
      ...body,
      metadata: { ...existing.metadata, ...meta, id },
    } as unknown as T
    const scope = config.annotateScope ? resolveScope(req) : 'auto'
    const isProject =
      scope === 'project'
        ? true
        : scope === 'user'
          ? false
          : await isProjectItem(effectiveProjectDir, config.dirName, id, config.ext)
    if (isProject) {
      await config.saveToProject(effectiveProjectDir!, updated)
    } else {
      await config.save(configDir, updated)
    }
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const scope = config.annotateScope ? resolveScope(req) : 'auto'
    const target =
      scope === 'project' || scope === 'user'
        ? scope
        : (await isProjectItem(effectiveProjectDir, config.dirName, id, config.ext))
          ? 'project'
          : 'user'
    const result =
      target === 'project' ? await config.deleteProject(effectiveProjectDir!, id) : await config.delete(configDir, id)
    if (!result.success) {
      return res.status(target === 'project' ? 500 : 403).json({
        error:
          target === 'project'
            ? serverT({ en: 'Failed to delete project item', fr: 'Échec de suppression de l’élément de projet' })
            : (result.reason ?? serverT({ en: 'Cannot delete this item', fr: 'Impossible de supprimer cet élément' })),
      })
    }
    if (config.afterDelete) {
      try {
        await config.afterDelete(id, { configDir, ...(effectiveProjectDir ? { projectDir: effectiveProjectDir } : {}) })
      } catch {
        // Config cleanup must never fail the delete response.
      }
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const items = await config.loadAll(configDir, effectiveProjectDir)
    const source = config.findById(id, items)
    if (!source) {
      return res.status(404).json({ error: serverT({ en: 'Not found', fr: 'Introuvable' }) })
    }
    const newId = `${id}-copy-${Date.now()}`
    const duplicated = {
      ...source,
      metadata: { ...source.metadata, id: newId, name: `${source.metadata.name} (copy)` },
    } as unknown as T
    const destination = (req.body as { destination?: 'project' | 'user' }).destination ?? 'user'
    if (destination === 'project') {
      if (!effectiveProjectDir)
        return res.status(400).json({
          error: serverT({ en: 'No project directory configured', fr: 'Aucun répertoire de projet configuré' }),
        })
      await config.saveToProject(effectiveProjectDir, duplicated)
    } else {
      await config.save(configDir, duplicated)
    }
    res.status(201).json(duplicated)
  })

  return router
}
