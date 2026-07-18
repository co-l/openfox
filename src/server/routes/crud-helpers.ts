import { Router } from 'express'
import { join } from 'node:path'
import { pathExists } from '../shared/item-loader.js'

export function computeOverrideIds<T extends { metadata: { id: string } }>(defaults: T[], userItems: T[]): string[] {
  return userItems.filter((u) => defaults.some((d) => d.metadata.id === u.metadata.id)).map((u) => u.metadata.id)
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
  return pathExists(getProjectItemPath(projectDir, dirName, id, ext))
}

export function mergeMetadata<T extends Record<string, unknown>>(
  existing: T,
  update: Record<string, unknown> | undefined,
  id: string,
): Record<string, unknown> {
  const merged = { ...existing, ...update, id }
  for (const [key, value] of Object.entries(update ?? {})) {
    if (value === null) delete merged[key]
  }
  return merged
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
  validateUpdate?: (body: Record<string, unknown>) => string | null
  mapToResponse: (item: T) => { [key: string]: unknown }
  extraGetData?: () => Promise<{ [key: string]: unknown }>
  extraRoutes?: (router: Router) => void
}

export function createCrudRoutes<T extends { metadata: { id: string; name: string } }>(
  config: CrudRouteConfig<T>,
  configDir: string,
  projectDir?: string,
): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [defaults, userItems, projectItems] = await Promise.all([
      config.loadDefaults(),
      config.loadUser(configDir),
      projectDir ? config.loadProject(projectDir) : [],
    ])
    const userOverrideIds = computeOverrideIds(defaults, userItems)
    const projectOverrideIds = computeOverrideIds(defaults, projectItems)
    const extra = config.extraGetData ? await config.extraGetData() : {}
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
    const items = await config.loadAll(configDir, projectDir)
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
    if (destination === 'project' && !projectDir) {
      return res.status(400).json({ error: 'No project directory configured' })
    }
    const exists = await config.exists(configDir, id, projectDir)
    if (exists) {
      return res.status(409).json({ error: 'An item with this ID already exists' })
    }
    if (destination === 'project') {
      await config.saveToProject(projectDir!, body as unknown as T)
    } else {
      await config.save(configDir, body as unknown as T)
    }
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    const items = await config.loadAll(configDir, projectDir)
    const existing = config.findById(id, items)
    if (!existing) {
      return res.status(404).json({ error: 'Not found' })
    }
    const body = req.body as Record<string, unknown>
    const validationError = config.validateUpdate?.(body)
    if (validationError) return res.status(400).json({ error: validationError })
    const meta = body['metadata'] as Record<string, unknown> | undefined
    const mergedMetadata = mergeMetadata(existing.metadata as Record<string, unknown>, meta, id)
    const updated = {
      ...existing,
      ...body,
      metadata: mergedMetadata,
    } as unknown as T
    const isProject = await isProjectItem(projectDir, config.dirName, id, config.ext)
    if (isProject) {
      await config.saveToProject(projectDir!, updated)
    } else {
      await config.save(configDir, updated)
    }
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const isProject = await isProjectItem(projectDir, config.dirName, id, config.ext)
    if (isProject) {
      const result = await config.deleteProject(projectDir!, id)
      if (!result.success) {
        return res.status(500).json({ error: 'Failed to delete project item' })
      }
      return res.json({ success: true })
    }
    const result = await config.delete(configDir, id)
    if (!result.success) {
      return res.status(403).json({ error: result.reason ?? 'Cannot delete this item' })
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const items = await config.loadAll(configDir, projectDir)
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
      if (!projectDir) return res.status(400).json({ error: 'No project directory configured' })
      await config.saveToProject(projectDir, duplicated)
    } else {
      await config.save(configDir, duplicated)
    }
    res.status(201).json(duplicated)
  })

  config.extraRoutes?.(router)

  return router
}
