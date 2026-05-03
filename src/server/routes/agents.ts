import { Router } from 'express'
import {
  loadDefaultAgents,
  loadUserAgents,
  loadAllAgents,
  findAgentById,
  saveAgent,
  deleteAgent,
  agentExists,
  getDefaultAgentIds,
  getDefaultAgentContent,
} from '../agents/registry.js'
import type { AgentDefinition } from '../agents/types.js'
import { computeOverrideIds } from './crud-helpers.js'

export function createAgentRoutes(configDir: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [defaults, userItems] = await Promise.all([loadDefaultAgents(), loadUserAgents(configDir)])
    const overrideIds = computeOverrideIds(defaults, userItems)
    res.json({
      defaults: defaults.map((a) => a.metadata),
      userItems: userItems.map((a) => a.metadata),
      overrideIds,
    })
  })

  router.get('/defaults/:id', async (req, res) => {
    const { id } = req.params
    const content = await getDefaultAgentContent(id)
    if (!content) {
      return res.status(404).json({ error: 'Default agent not found' })
    }
    res.json(content)
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultAgentIds()
    res.json({ ids })
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
    const exists = await agentExists(configDir, body.metadata.id)
    if (exists) {
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
    const result = await deleteAgent(configDir, id as string)
    if (!result.success) {
      return res.status(403).json({ error: result.reason ?? 'Cannot delete this agent' })
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const defaults = await loadDefaultAgents()
    const userItems = await loadUserAgents(configDir)
    const source = defaults.find((a) => a.metadata.id === id) ?? userItems.find((a) => a.metadata.id === id)
    if (!source) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const newId = `${id}-copy-${Date.now()}`
    const duplicated: AgentDefinition = {
      metadata: { ...source.metadata, id: newId, name: `${source.metadata.name} (copy)` },
      prompt: source.prompt,
    }
    await saveAgent(configDir, duplicated)
    res.status(201).json(duplicated)
  })

  return router
}
