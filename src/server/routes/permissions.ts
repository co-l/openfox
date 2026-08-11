import { Router } from 'express'
import { loadPermissionsConfig, savePermissionsConfig, type PermissionsScope } from '../permissions/registry.js'
import { permissionConfigSchema } from '../permissions/schema.js'

export function createPermissionsRoutes(configDir: string): Router {
  const router = Router()

  function parseScope(req: {
    query: Record<string, unknown>
  }): { scope: PermissionsScope; workdir: string } | { error: string } {
    const scope = req.query['scope'] as string
    if (scope !== 'global' && scope !== 'project') {
      return { error: 'scope must be "global" or "project"' }
    }
    const workdir = (req.query['workdir'] as string) ?? ''
    if (scope === 'project' && !workdir) {
      return { error: 'workdir required for project scope' }
    }
    return { scope: scope as PermissionsScope, workdir }
  }

  router.get('/', async (req, res) => {
    const parsed = parseScope(req)
    if ('error' in parsed) return res.status(400).json({ error: parsed.error })
    const config = await loadPermissionsConfig(parsed.scope, configDir, parsed.workdir)
    res.json({ config })
  })

  router.post('/', async (req, res) => {
    const parsed = parseScope(req)
    if ('error' in parsed) return res.status(400).json({ error: parsed.error })
    const parseResult = permissionConfigSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid config', issues: parseResult.error.issues })
    }
    try {
      await savePermissionsConfig(parsed.scope, configDir, parsed.workdir, parseResult.data)
      res.json({ config: parseResult.data })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save permissions config' })
    }
  })

  return router
}
