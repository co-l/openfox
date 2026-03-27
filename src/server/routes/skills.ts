import { Router } from 'express'
import { loadAllSkills, isSkillEnabled, setSkillEnabled, findSkillById, saveSkill, deleteSkill, skillExists, getDefaultSkillIds, getModifiedDefaultSkillIds, restoreDefaultSkill, restoreAllDefaultSkills } from '../skills/registry.js'
import type { SkillDefinition } from '../skills/types.js'

export function createSkillRoutes(configDir: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const [skills, defaultIds, modifiedIds] = await Promise.all([
      loadAllSkills(configDir),
      getDefaultSkillIds(),
      getModifiedDefaultSkillIds(configDir),
    ])
    res.json({
      skills: skills.map(s => ({
        ...s.metadata,
        enabled: isSkillEnabled(s.metadata.id),
      })),
      defaultIds,
      modifiedIds,
    })
  })

  router.get('/default-ids', async (_req, res) => {
    const ids = await getDefaultSkillIds()
    res.json({ ids })
  })

  router.post('/restore-all-defaults', async (_req, res) => {
    const count = await restoreAllDefaultSkills(configDir)
    res.json({ success: true, count })
  })

  router.post('/:id/restore-default', async (req, res) => {
    const { id } = req.params
    const restored = await restoreDefaultSkill(configDir, id as string)
    if (!restored) {
      return res.status(404).json({ error: 'No bundled default found for this skill' })
    }
    res.json({ success: true })
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
    if (await skillExists(configDir, body.metadata.id)) {
      return res.status(409).json({ error: 'A skill with this ID already exists' })
    }
    await saveSkill(configDir, body)
    res.status(201).json(body)
  })

  router.put('/:id', async (req, res) => {
    const { id } = req.params
    if (!await skillExists(configDir, id as string)) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    const body = req.body as Partial<SkillDefinition>
    const skills = await loadAllSkills(configDir)
    const existing = findSkillById(id as string, skills)
    if (!existing) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    const updated: SkillDefinition = {
      metadata: { ...existing.metadata, ...body.metadata, id: id as string },
      prompt: body.prompt ?? existing.prompt,
    }
    await saveSkill(configDir, updated)
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const { id } = req.params
    const deleted = await deleteSkill(configDir, id as string)
    if (!deleted) {
      return res.status(404).json({ error: 'Skill not found' })
    }
    res.json({ success: true })
  })

  return router
}
