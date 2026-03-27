import { Router } from 'express'
import { loadAllAgents, findAgentById, saveAgent, deleteAgent, agentExists, getDefaultAgentIds, getModifiedDefaultAgentIds, restoreDefaultAgent, restoreAllDefaultAgents } from '../agents/registry.js'
import type { AgentDefinition } from '../agents/types.js'

export function createAgentRoutes(configDir: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [agents, defaultIds, modifiedIds] = await Promise.all([
      loadAllAgents(configDir),
      getDefaultAgentIds(),
      getModifiedDefaultAgentIds(configDir),
    ])
    res.json({
      agents: agents.map(a => a.metadata),
      defaultIds,
      modifiedIds,
    })
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultAgentIds()
    res.json({ ids })
  })

  router.post('/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultAgents(configDir)
    res.json({ success: true, count })
  })

  router.post('/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultAgent(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this agent' })
    }
    res.json({ success: true })
  })

  router.get('/:id', async (req, res) => {
    const { id } = req.params
    const agents = await loadAllAgents(configDir)
    const agent = findAgentById(id as string, agents)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json(agent)
  })

  router.post('/', async (req, res) => {
    const body = req.body as AgentDefinition
    if (!body?.metadata?.id || !body?.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, prompt' })
    }
    if (await agentExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'An agent with this ID already exists' })
    }
    await saveAgent(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    if (!id) {
      return res.status(400).json({ error: 'Missing agent ID' })
    }
    const body = req.body as Partial<AgentDefinition>
    const agents = await loadAllAgents(configDir)
    const existing = findAgentById(id as string, agents)
    if (!existing) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const updated: AgentDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveAgent(configDir, updated)
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const deleted = await deleteAgent(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json({ success: true })
  })

  return router
}
