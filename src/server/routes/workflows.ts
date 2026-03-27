import { Router } from 'express'
import { loadAllWorkflows, findWorkflowById, saveWorkflow, deleteWorkflow, workflowExists, getDefaultWorkflowIds, getModifiedDefaultWorkflowIds, restoreDefaultWorkflow, restoreAllDefaultWorkflows } from '../workflows/registry.js'
import { TEMPLATE_VARIABLES } from '../workflows/executor.js'
import type { WorkflowDefinition } from '../workflows/types.js'
import type { Config } from '../../shared/types.js'

export function createWorkflowRoutes(configDir: string, config: Config): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [workflows, defaultIds, modifiedIds] = await Promise.all([
      loadAllWorkflows(configDir),
      getDefaultWorkflowIds(),
      getModifiedDefaultWorkflowIds(configDir),
    ])
    res.json({
      workflows: workflows.map(p => ({ ...p.metadata, startCondition: p.startCondition })),
      activeWorkflowId: config.activeWorkflowId ?? 'default',
      defaultIds,
      modifiedIds,
    })
  })

  router.get('/template-variables', (_req, res) => {
    res.json({ variables: TEMPLATE_VARIABLES })
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultWorkflowIds()
    res.json({ ids })
  })

  router.post('/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultWorkflows(configDir)
    res.json({ success: true, count })
  })

  router.post('/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultWorkflow(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this workflow' })
    }
    res.json({ success: true })
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
    if (await workflowExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'A workflow with this ID already exists' })
    }
    await saveWorkflow(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    if (!await workflowExists(configDir, id as string)) {
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
    if (id === 'default') {
      return res.status(400).json({ error: 'Cannot delete the default workflow' })
    }
    const deleted = await deleteWorkflow(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    res.json({ success: true })
  })

  return router
}
