import { Router } from 'express'
import { loadDefaultWorkflows, loadUserWorkflows, loadAllWorkflows, findWorkflowById, saveWorkflow, deleteWorkflow, workflowExists, getDefaultWorkflowIds, getDefaultWorkflowContent } from '../workflows/registry.js'
import { TEMPLATE_VARIABLES } from '../workflows/executor.js'
import type { WorkflowDefinition } from '../workflows/types.js'
import type { Config } from '../../shared/types.js'
import { computeOverrideIds } from './crud-helpers.js'

export function createWorkflowRoutes(configDir: string, config: Config): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [defaults, userItems] = await Promise.all([
      loadDefaultWorkflows(),
      loadUserWorkflows(configDir),
    ])
    const overrideIds = computeOverrideIds(defaults, userItems)
    res.json({
      defaults: defaults.map(p => ({ ...p.metadata, startCondition: p.startCondition })),
      userItems: userItems.map(p => ({ ...p.metadata, startCondition: p.startCondition })),
      activeWorkflowId: config.activeWorkflowId ?? 'default',
      overrideIds,
    })
  })

  router.get('/template-variables', (_req, res) => {
    res.json({ variables: TEMPLATE_VARIABLES })
  })

  router.get('/defaults/:id', async (req, res) => {
    const { id } = req.params
    const content = await getDefaultWorkflowContent(id)
    if (!content) {
      return res.status(404).json({ error: 'Default workflow not found' })
    }
    res.json(content)
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultWorkflowIds()
    res.json({ ids })
  })

  router.get('/:id', async (req, res) => {
    const { id } = req.params
    const workflows = await loadAllWorkflows(configDir)
    const workflow = findWorkflowById(id as string, workflows)
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    res.json(workflow)
  })

  router.post('/', async (req, res) => {
    const body = req.body as WorkflowDefinition
    if (!body?.metadata?.id || !body?.steps?.length) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, steps' })
    }
    const exists = await workflowExists(configDir, body.metadata.id)
    if (exists) {
      return res.status(409).json({ error: 'A workflow with this ID already exists' })
    }
    await saveWorkflow(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    const workflows = await loadAllWorkflows(configDir)
    const existing = findWorkflowById(id as string, workflows)
    if (!existing) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    const body = req.body as WorkflowDefinition
    const updated: WorkflowDefinition = {
      ...body,
      metadata: { ...body.metadata, id: id as string },
    }
    await saveWorkflow(configDir, updated)
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const result = await deleteWorkflow(configDir, id as string)
    if (!result.success) {
      return res.status(403).json({ error: result.reason ?? 'Cannot delete this workflow' })
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const defaults = await loadDefaultWorkflows()
    const userItems = await loadUserWorkflows(configDir)
    const source = defaults.find(w => w.metadata.id === id) ?? userItems.find(w => w.metadata.id === id)
    if (!source) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    const newId = `${id}-copy-${Date.now()}`
    const duplicated: WorkflowDefinition = {
      ...source,
      metadata: { ...source.metadata, id: newId, name: `${source.metadata.name} (copy)` },
    }
    await saveWorkflow(configDir, duplicated)
    res.status(201).json(duplicated)
  })

  return router
}