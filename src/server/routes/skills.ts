import { Router } from 'express'
import {
  loadDefaultSkills,
  loadUserSkills,
  loadAllSkills,
  isSkillEnabled,
  setSkillEnabled,
  findSkillById,
  saveSkill,
  deleteSkill,
  skillExists,
  getDefaultSkillIds,
  getDefaultSkillContent,
} from '../skills/registry.js'
import type { SkillDefinition } from '../skills/types.js'
import { computeOverrideIds } from './crud-helpers.js'

export function createSkillRoutes(configDir: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [defaults, userItems] = await Promise.all([loadDefaultSkills(), loadUserSkills(configDir)])
    const overrideIds = computeOverrideIds(defaults, userItems)
    res.json({
      defaults: defaults.map((s) => ({
        ...s.metadata,
        enabled: isSkillEnabled(s.metadata.id),
      })),
      userItems: userItems.map((s) => ({
        ...s.metadata,
        enabled: isSkillEnabled(s.metadata.id),
      })),
      overrideIds,
    })
  })

  router.get('/defaults/:id', async (req, res) => {
    const { id } = req.params
    const content = await getDefaultSkillContent(id)
    if (!content) {
      return res.status(404).json({ error: 'Default skill not found' })
    }
    res.json(content)
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultSkillIds()
    res.json({ ids })
  })

  router.post('/:id/toggle', (req, res) => {
    const { id } = req.params
    const currentlyEnabled = isSkillEnabled(id as string)
    setSkillEnabled(id as string, !currentlyEnabled)
    res.json({ id, enabled: !currentlyEnabled })
  })

  router.get('/:id', async (req, res) => {
    const { id } = req.params
    const skills = await loadAllSkills(configDir)
    const skill = findSkillById(id as string, skills)
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    res.json(skill)
  })

  router.post('/', async (req, res) => {
    const body = req.body as SkillDefinition
    if (!body.metadata?.id || !body.metadata?.name || !body.prompt) {
      return res.status(400).json({ error: 'Missing required fields: metadata.id, metadata.name, prompt' })
    }
    if (!/^[a-z0-9-]+$/.test(body.metadata.id)) {
      return res.status(400).json({ error: 'Skill ID must be lowercase alphanumeric with hyphens only' })
    }
    const exists = await skillExists(configDir, body.metadata.id)
    if (exists) {
      return res.status(409).json({ error: 'A skill with this ID already exists' })
    }
    await saveSkill(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    const skills = await loadAllSkills(configDir)
    const existing = findSkillById(id as string, skills)
    if (!existing) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    const body = req.body as Partial<SkillDefinition>
    const updated: SkillDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveSkill(configDir, updated)
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const result = await deleteSkill(configDir, id as string)
    if (!result.success) {
      return res.status(403).json({ error: result.reason ?? 'Cannot delete this skill' })
    }
    res.json({ success: true })
  })

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = req.params
    const defaults = await loadDefaultSkills()
    const userItems = await loadUserSkills(configDir)
    const source = defaults.find((s) => s.metadata.id === id) ?? userItems.find((s) => s.metadata.id === id)
    if (!source) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    const newId = `${id}-copy-${Date.now()}`
    const duplicated: SkillDefinition = {
      metadata: { ...source.metadata, id: newId, name: `${source.metadata.name} (copy)` },
      prompt: source.prompt,
    }
    await saveSkill(configDir, duplicated)
    res.status(201).json(duplicated)
  })

  return router
}
