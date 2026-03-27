import { Router } from 'express'
import { loadAllCommands, findCommandById, saveCommand, deleteCommand, commandExists, getDefaultCommandIds, getModifiedDefaultCommandIds, restoreDefaultCommand, restoreAllDefaultCommands } from '../commands/registry.js'
import type { CommandDefinition } from '../commands/types.js'

export function createCommandRoutes(configDir: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [commands, defaultIds, modifiedIds] = await Promise.all([
      loadAllCommands(configDir),
      getDefaultCommandIds(),
      getModifiedDefaultCommandIds(configDir),
    ])
    res.json({
      commands: commands.map(c => c.metadata),
      defaultIds,
      modifiedIds,
    })
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultCommandIds()
    res.json({ ids })
  })

  router.post('/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultCommands(configDir)
    res.json({ success: true, count })
  })

  router.post('/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultCommand(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this command' })
    }
    res.json({ success: true })
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
    if (await commandExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'A command with this ID already exists' })
    }
    await saveCommand(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    if (!await commandExists(configDir, id as string)) {
      return res.status(404).json({ error: 'Command not found' })
    }
    const body = req.body as Partial<CommandDefinition>
    const commands = await loadAllCommands(configDir)
    const existing = findCommandById(id as string, commands)
    if (!existing) {
      return res.status(404).json({ error: 'Command not found' })
    }
    const updated: CommandDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveCommand(configDir, updated)
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const deleted = await deleteCommand(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Command not found' })
    }
    res.json({ success: true })
  })

  return router
}
