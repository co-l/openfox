import { Router } from 'express'
import multer from 'multer'
import { access, mkdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  loadDefaultSkills,
  loadUserSkills,
  loadProjectSkills,
  loadAllSkills,
  loadAllSkillsWithDiagnostics,
  isSkillEnabled,
  setSkillEnabled,
  findSkillById,
  saveSkill,
  saveSkillToProject,
  deleteSkill,
  deleteProjectSkill,
  skillExists,
  isDefaultSkill,
  getDefaultSkillIds,
  updateOwnedSkill,
  deleteOwnedSkill,
} from '../skills/registry.js'
import { installSkillPackage, SkillInstallError } from '../skills/installer.js'
import { deleteSetting, getSetting, setSetting } from '../db/settings.js'
import type { SkillDefinition } from '../skills/types.js'
import { createCrudRoutes, validateNameIdPrompt, type CrudRouteConfig } from './crud-helpers.js'

const SKILL_DIRECTORIES_SETTING = 'skills.directories'
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1000, fileSize: 25 * 1024 * 1024, fields: 4 },
})

function expandHome(path: string): string {
  if (path === '~') return homedir()
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

function configuredDirectory(): string | null {
  const raw = getSetting(SKILL_DIRECTORIES_SETTING)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null
  } catch {
    return null
  }
}

function defaultLibrary(configDir: string) {
  const path = resolve(configDir, 'skills')
  return { configuredPath: path, resolvedPath: path, available: true, custom: false }
}

async function resolveLibrary(path: string): Promise<{ configuredPath: string; resolvedPath: string }> {
  const expanded = expandHome(path)
  if (!isAbsolute(expanded)) throw new Error('Selected path must be absolute')
  const absolute = resolve(expanded)
  const info = await stat(absolute)
  if (!info.isDirectory()) throw new Error('Selected path is not a directory')
  await access(absolute, constants.R_OK)
  return { configuredPath: path, resolvedPath: await realpath(absolute) }
}

function mapToResponse(skill: SkillDefinition) {
  const source = skill.source ?? 'global-openfox'
  return {
    ...skill.metadata,
    enabled: isSkillEnabled(skill.metadata.id),
    source,
    path: skill.entrypoint ?? null,
    legacy: skill.legacy ?? true,
    readOnly:
      source === 'bundled' ||
      ((source === 'global-shared' || source === 'selected' || source === 'project-shared') && (skill.legacy ?? true)),
    warnings: skill.warnings ?? [],
  }
}

function validateSkillCreate(body: Record<string, unknown>): string | null {
  const baseError = validateNameIdPrompt(body)
  if (baseError) return baseError
  const metadata = body['metadata'] as Record<string, unknown>
  if (typeof metadata['description'] !== 'string' || !metadata['description'].trim()) {
    return 'Missing required field: metadata.description'
  }
  return null
}

function createConfig(configDir: string, projectDir?: string): CrudRouteConfig<SkillDefinition> {
  return {
    dirName: 'skills',
    ext: '.skill.md',
    loadDefaults: loadDefaultSkills,
    loadUser: loadUserSkills,
    loadProject: loadProjectSkills,
    loadAll: loadAllSkills,
    findById: findSkillById,
    save: saveSkill,
    saveToProject: saveSkillToProject,
    delete: deleteSkill,
    deleteProject: deleteProjectSkill,
    exists: skillExists,
    isDefault: isDefaultSkill,
    getDefaultIds: getDefaultSkillIds,
    validateCreate: validateSkillCreate,
    mapToResponse,
    extraGetData: async () => {
      const discovery = await loadAllSkillsWithDiagnostics(configDir, projectDir)
      const items = discovery.skills
      const configured = configuredDirectory()
      let selectedDirectory: {
        configuredPath: string
        resolvedPath: string | null
        available: boolean
        custom: boolean
      } = configured
        ? { configuredPath: configured, resolvedPath: null, available: false, custom: true }
        : defaultLibrary(configDir)
      const diagnostics: string[] = []
      if (configured) {
        try {
          selectedDirectory = { ...(await resolveLibrary(configured)), available: true, custom: true }
        } catch {
          diagnostics.push(`Selected skills directory is unavailable: ${configured}`)
        }
      }
      return {
        items: items.map(mapToResponse),
        selectedDirectory,
        diagnostics: [...diagnostics, ...discovery.diagnostics, ...items.flatMap((skill) => skill.warnings ?? [])],
      }
    },
  }
}

export function createSkillRoutes(configDir: string, projectDir?: string): Router {
  const router = Router()

  router.put('/library', async (req, res) => {
    const path = (req.body as { path?: unknown }).path
    if (typeof path !== 'string' || !path.trim()) return res.status(400).json({ error: 'path is required' })
    try {
      const selected = await resolveLibrary(path)
      setSetting(SKILL_DIRECTORIES_SETTING, JSON.stringify([path]))
      res.json(selected)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Cannot use directory' })
    }
  })

  router.delete('/library', (_req, res) => {
    deleteSetting(SKILL_DIRECTORIES_SETTING)
    res.json({ success: true })
  })

  router.post('/install', (req, res) => {
    upload.array('files', 1000)(req, res, async (uploadError) => {
      if (uploadError) return res.status(413).json({ error: uploadError.message })
      try {
        const configured = configuredDirectory()
        const library = configured ? await resolveLibrary(configured) : defaultLibrary(configDir)
        await mkdir(library.resolvedPath, { recursive: true })
        const packageName = String(req.body['packageName'] ?? '')
        const paths: unknown = JSON.parse(String(req.body['paths'] ?? '[]'))
        const files = req.files as Express.Multer.File[]
        if (!Array.isArray(paths) || paths.length !== files.length || paths.some((path) => typeof path !== 'string')) {
          return res.status(400).json({ error: 'File path manifest does not match upload' })
        }
        const totalBytes = files.reduce((total, file) => total + file.size, 0)
        if (totalBytes > 50 * 1024 * 1024) return res.status(413).json({ error: 'Package exceeds 50 MiB' })
        const installed = await installSkillPackage(
          library.resolvedPath,
          packageName,
          files.map((file, index) => ({ path: paths[index] as string, content: file.buffer })),
        )
        res.status(201).json(installed)
      } catch (error) {
        const status = error instanceof SkillInstallError ? error.status : 400
        res.status(status).json({ error: error instanceof Error ? error.message : 'Install failed' })
      }
    })
  })

  router.post('/:id/toggle', async (req, res) => {
    const skills = await loadAllSkills(configDir, projectDir)
    const existing = findSkillById(req.params['id']!, skills)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const enabled = !isSkillEnabled(existing.metadata.id)
    setSkillEnabled(existing.metadata.id, enabled)
    res.json({ enabled })
  })

  router.put('/:id', async (req, res) => {
    const skills = await loadAllSkills(configDir, projectDir)
    const existing = findSkillById(req.params['id']!, skills)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const updated = await updateOwnedSkill(existing, req.body as Partial<SkillDefinition>)
    if (!updated) return res.status(403).json({ error: 'This skill is read-only' })
    res.json(updated)
  })

  router.delete('/:id', async (req, res) => {
    const skills = await loadAllSkills(configDir, projectDir)
    const existing = findSkillById(req.params['id']!, skills)
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const result = await deleteOwnedSkill(existing)
    if (!result.success) return res.status(403).json({ error: result.reason ?? 'Cannot delete this skill' })
    res.json({ success: true })
  })

  router.use(createCrudRoutes(createConfig(configDir, projectDir), configDir, projectDir))
  return router
}
