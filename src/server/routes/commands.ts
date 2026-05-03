import { Router } from 'express'
import {
  loadDefaultCommands,
  loadUserCommands,
  loadAllCommands,
  findCommandById,
  saveCommand,
  deleteCommand,
  commandExists,
  getDefaultCommandIds,
  getDefaultCommandContent,
} from '../commands/registry.js'
import type { CommandDefinition } from '../commands/types.js'
import { computeOverrideIds } from './crud-helpers.js'

export function createCommandRoutes(configDir: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [defaults, userItems] = await Promise.all([loadDefaultCommands(), loadUserCommands(configDir)])
    const overrideIds = computeOverrideIds(defaults, userItems)
    res.json({
      defaults: defaults.map((c) => c.metadata),
      userItems: userItems.map((c) => c.metadata),
      overrideIds,
    })
  })

  router.get('/defaults/:id', async (req, res) => {
    const { id } = req.params
    const content = await getDefaultCommandContent(id)
    if (!content) {
      return res.status(404).json({ error: 'Default command not found' })
    }
    res.json(content)
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultCommandIds()
    res.json({ ids })
  })

  router.get('/:id', async (req, res) => {
    const { id } = req.params
    const commands = await loadAllCommands(configDir)
    const command = findCommandById(id as string, commands)
    if (!command) {
      return res.status(404).json({ error: 'Command not found' })
    }
    res.json(command)
  })

  router.post('/', async (req, res) => {
    const body = req.body as CommandDefinition
    if (!body.metadata?.id || !body.metadata?.name || !body.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, metadata.name, prompt' })
    }
    if (!/^[a-z0-9-]+$/.test(body.metadata.id)) {
      return res.status(400).json({ error: 'Command ID must be lowercase alphanumeric with hyphens only' })
    }
    const exists = await commandExists(configDir, body.metadata.id)
    if (exists) {
      return res.status(409).json({ error: 'A command with this ID already exists' })
    }
    await saveCommand(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    const commands = await loadAllCommands(configDir)
    const existing = findCommandById(id as string, commands)
    if (!existing) {
      return res.status(404).json({ error: 'Command not found' })
    }
    const body = req.body as Partial<CommandDefinition>
    const updated: CommandDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveCommand(configDir, updated)
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const result = await deleteCommand(configDir, id as string)
    if (!result.success) {
      return res.status(403).json({ error: result.reason ?? 'Cannot delete this command' })
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const defaults = await loadDefaultCommands()
    const userItems = await loadUserCommands(configDir)
    const source = defaults.find((c) => c.metadata.id === id) ?? userItems.find((c) => c.metadata.id === id)
    if (!source) {
      return res.status(404).json({ error: 'Command not found' })
    }
    const newId = `${id}-copy-${Date.now()}`
    const duplicated: CommandDefinition = {
      metadata: { ...source.metadata, id: newId, name: `${source.metadata.name} (copy)` },
      prompt: source.prompt,
    }
    await saveCommand(configDir, duplicated)
    res.status(201).json(duplicated)
  })

  return router
}
