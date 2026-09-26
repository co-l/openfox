import { Router } from 'express'
import {
  loadPermissionsConfig,
  savePermissionsConfig,
  addPermissionRule,
  updatePermissionRule,
  deletePermissionRule,
  type PermissionsScope,
} from '../permissions/registry.js'
import {
  listSessionGrants,
  hasSessionGrants,
  revokeAllowedPath,
  revokeSessionAllowedRule,
  clearAllowedPaths,
} from '../tools/path-security.js'
import { permissionConfigSchema, permissionRuleInputSchema } from '../permissions/schema.js'
import type { PermissionRule as PermissionRuleInput } from '../permissions/schema.js'

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

  /** Parse scope + rule body in one step; returns the response to send on failure. */
  function parseRuleRequest(req: {
    query: Record<string, unknown>
    body: unknown
  }):
    | { scope: PermissionsScope; workdir: string; rule: PermissionRuleInput }
    | { status: number; body: Record<string, unknown> } {
    const parsed = parseScope(req)
    if ('error' in parsed) return { status: 400, body: { error: parsed.error } }
    const parseResult = permissionRuleInputSchema.safeParse(req.body)
    if (!parseResult.success) {
      return { status: 400, body: { error: 'Invalid rule', issues: parseResult.error.issues } }
    }
    return { ...parsed, rule: parseResult.data }
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
      const config = await savePermissionsConfig(parsed.scope, configDir, parsed.workdir, parseResult.data)
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save permissions config' })
    }
  })

  // Per-rule routes. The server owns the read-modify-write, so two clients
  // editing the same scope can't overwrite each other with a stale full config,
  // and a rule is addressed by id rather than by its index in the list.

  router.post('/rules', async (req, res) => {
    const parsed = parseRuleRequest(req)
    if ('status' in parsed) return res.status(parsed.status).json(parsed.body)
    try {
      const config = await addPermissionRule(parsed.scope, configDir, parsed.workdir, parsed.rule)
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add permission rule' })
    }
  })

  router.put('/rules/:id', async (req, res) => {
    const parsed = parseRuleRequest(req)
    if ('status' in parsed) return res.status(parsed.status).json(parsed.body)
    try {
      const config = await updatePermissionRule(parsed.scope, configDir, parsed.workdir, req.params.id, parsed.rule)
      if (!config) return res.status(404).json({ error: 'Rule not found' })
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update permission rule' })
    }
  })

  router.delete('/rules/:id', async (req, res) => {
    const parsed = parseScope(req)
    if ('error' in parsed) return res.status(400).json({ error: parsed.error })
    try {
      const config = await deletePermissionRule(parsed.scope, configDir, parsed.workdir, req.params.id)
      if (!config) return res.status(404).json({ error: 'Rule not found' })
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete permission rule' })
    }
  })

  // Audit + revocation of "Allow for this session" grants. They are in-memory
  // per-session state, separate from the permissions.json rules above.

  router.get('/grants', (req, res) => {
    const grants = listSessionGrants()
    // ?sessionId= narrows the answer to one session; 404 when it holds no grant.
    const sessionId = req.query['sessionId']
    if (typeof sessionId === 'string' && sessionId) {
      const found = grants.find((grant) => grant.sessionId === sessionId)
      if (!found) return res.status(404).json({ error: 'Grant not found' })
      return res.json({ grants: [found] })
    }
    res.json({ grants })
  })

  router.delete('/grants/:sessionId', (req, res) => {
    // 404 when the session holds no grant (already revoked or never granted).
    if (!hasSessionGrants(req.params.sessionId)) {
      return res.status(404).json({ error: 'Grant not found' })
    }
    clearAllowedPaths(req.params.sessionId)
    res.json({ grants: listSessionGrants() })
  })

  router.delete('/grants/:sessionId/paths', (req, res) => {
    const path = req.query['path']
    if (typeof path !== 'string' || !path) return res.status(400).json({ error: 'path required' })
    if (!revokeAllowedPath(req.params.sessionId, path)) return res.status(404).json({ error: 'Grant not found' })
    res.json({ grants: listSessionGrants() })
  })

  router.delete('/grants/:sessionId/rules', (req, res) => {
    const tool = req.query['tool']
    const pattern = req.query['pattern']
    if (typeof tool !== 'string' || !tool) return res.status(400).json({ error: 'tool required' })
    if (pattern !== undefined && typeof pattern !== 'string') return res.status(400).json({ error: 'invalid pattern' })
    if (revokeSessionAllowedRule(req.params.sessionId, tool, pattern) === 0) {
      return res.status(404).json({ error: 'Grant not found' })
    }
    res.json({ grants: listSessionGrants() })
  })

  return router
}
