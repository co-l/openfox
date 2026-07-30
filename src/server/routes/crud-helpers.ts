import { Router } from 'express'
import { join } from 'node:path'
import { pathExists, findFileByInternalId } from '../shared/item-loader.js'

export function computeOverrideIds<T extends { metadata: { id: string } }>(defaults: T[], userItems: T[]): string[] {
  return userItems.filter((u) => defaults.some((d) => d.metadata.id === u.metadata.id)).map((u) => u.metadata.id)
}

export function resolveProjectDir(req: { query: Record<string, unknown> }, fallback?: string): string | undefined {
  const workdir = req.query['workdir']
  return typeof workdir === 'string' && workdir.trim() ? workdir : fallback
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
  if (!meta?.['name'] || !body['prompt']) return 'Missing required fields: metadata.name, prompt'
  if (meta['id'] && !ID_REGEX.test(String(meta['id']))) return 'ID must be lowercase alphanumeric with hyphens only'
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
  extraGetData?: (effectiveProjectDir?: string) => Promise<{ [key: string]: unknown }>
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
    res.json({
      defaults: defaults.map(config.mapToResponse),
      userItems: userItems.map(config.mapToResponse),
      projectItems: projectItems.map(config.mapToResponse),
      overrideIds: [...userOverrideIds, ...projectOverrideIds],
      ...extra,
    })
  })

  router.get('/defaults/:id', async (req, res) => {
    const { id } = req.params
    const allDefaults = await config.loadDefaults()
    const item = allDefaults.find((d) => d.metadata.id === id)
    if (!item) {
      return res.status(404).json({ error: 'Default not found' })
    }
    res.json(item)
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = config.getDefaultIds ? await config.getDefaultIds() : []
    res.json({ ids })
  })

  router.get('/:id', async (req, res) => {
    const { id } = req.params
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const items = await config.loadAll(configDir, effectiveProjectDir)
    const item = config.findById(id, items)
    if (!item) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.json(item)
  })

  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const meta = body['metadata'] as Record<string, unknown> | undefined
    const customError = config.validateCreate?.(body)
    if (!meta?.['id'] || customError) {
      return res.status(400).json({ error: customError ?? 'Missing required fields' })
    }
    const id = String(meta['id'])
    const destination = (body['destination'] as 'project' | 'user') ?? 'user'
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    if (destination === 'project' && !effectiveProjectDir) {
      return res.status(400).json({ error: 'No project directory configured' })
    }
    const exists = await config.exists(configDir, id, effectiveProjectDir)
    if (exists) {
      return res.status(409).json({ error: 'An item with this ID already exists' })
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
      return res.status(404).json({ error: 'Not found' })
    }
    const body = req.body as Record<string, unknown>
    const meta = body['metadata'] as Record<string, unknown> | undefined
    const updated = {
      ...existing,
      ...body,
      metadata: { ...existing.metadata, ...meta, id },
    } as unknown as T
    const isProject = await isProjectItem(effectiveProjectDir, config.dirName, id, config.ext)
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
    const isProject = await isProjectItem(effectiveProjectDir, config.dirName, id, config.ext)
    if (isProject) {
      const result = await config.deleteProject(effectiveProjectDir!, id)
      if (!result.success) {
        return res.status(500).json({ error: 'Failed to delete project item' })
      }
      return res.json({ success: true })
    }
    const isDefault = await config.isDefault(id)
    if (isDefault) {
      return res.status(403).json({ error: 'Cannot delete built-in defaults' })
    }
    const result = await config.delete(configDir, id)
    if (!result.success) {
      return res.status(403).json({ error: result.reason ?? 'Cannot delete this item' })
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const effectiveProjectDir = resolveProjectDir(req, projectDir)
    const items = await config.loadAll(configDir, effectiveProjectDir)
    const source = config.findById(id, items)
    if (!source) {
      return res.status(404).json({ error: 'Not found' })
    }
    const newId = `${id}-copy-${Date.now()}`
    const duplicated = {
      ...source,
      metadata: { ...source.metadata, id: newId, name: `${source.metadata.name} (copy)` },
    } as unknown as T
    const destination = (req.body as { destination?: 'project' | 'user' }).destination ?? 'user'
    if (destination === 'project') {
      if (!effectiveProjectDir) return res.status(400).json({ error: 'No project directory configured' })
      await config.saveToProject(effectiveProjectDir, duplicated)
    } else {
      await config.save(configDir, duplicated)
    }
    res.status(201).json(duplicated)
  })

  config.extraRoutes?.(router)

  return router
}
