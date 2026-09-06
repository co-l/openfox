/**
 * Favorite workflow resolution tests: project override > global setting > empty,
 * and existence check against the effective workflow catalog.
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject, updateProject, getProject, getProjectFavoriteWorkflowId } from '../db/projects.js'
import { SETTINGS_KEYS, deleteSetting, getSetting, setSetting } from '../db/settings.js'
import { resolveFavoriteWorkflow, resolveFavoriteWorkflowId, sweepFavoritesAfterDelete } from './favorite.js'

const sampleWorkflow = (id: string, name: string) =>
  JSON.stringify({ metadata: { id, name }, steps: [{ id: 's1', type: 'agent', prompt: 'x' }] })

describe('favorite workflow resolution', () => {
  let rootA: string
  let configDir: string
  let projectAId: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    rootA = await mkdtemp(join(tmpdir(), 'openfox-fav-proj-'))
    configDir = await mkdtemp(join(tmpdir(), 'openfox-fav-cfg-'))
    await mkdir(join(configDir, 'workflows'), { recursive: true })
    await mkdir(join(rootA, '.openfox', 'workflows'), { recursive: true })
    await writeFile(
      join(configDir, 'workflows', 'global-flow.workflow.json'),
      sampleWorkflow('global-flow', 'Global Flow'),
    )
    await writeFile(
      join(rootA, '.openfox', 'workflows', 'proj-flow.workflow.json'),
      sampleWorkflow('proj-flow', 'Project Flow'),
    )

    projectAId = createProject('Project A', rootA).id
  })

  afterEach(async () => {
    deleteSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)
    closeDatabase()
    await rm(rootA, { recursive: true, force: true })
    await rm(configDir, { recursive: true, force: true })
  })

  describe('resolveFavoriteWorkflowId', () => {
    it('returns empty when nothing is configured', () => {
      expect(resolveFavoriteWorkflowId(projectAId)).toBe('')
      expect(resolveFavoriteWorkflowId()).toBe('')
    })

    it('uses the global setting when the project has none', () => {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, 'global-flow')
      expect(resolveFavoriteWorkflowId(projectAId)).toBe('global-flow')
      deleteSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)
    })

    it('prefers the project favorite over the global setting', () => {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, 'global-flow')
      updateProject(projectAId, { favoriteWorkflowId: 'proj-flow' })

      expect(resolveFavoriteWorkflowId(projectAId)).toBe('proj-flow')

      deleteSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)
    })

    it('persists and clears the project favorite via updateProject', () => {
      updateProject(projectAId, { favoriteWorkflowId: 'proj-flow' })
      expect(getProjectFavoriteWorkflowId(projectAId)).toBe('proj-flow')

      updateProject(projectAId, { favoriteWorkflowId: null })
      expect(getProjectFavoriteWorkflowId(projectAId)).toBeNull()
    })
  })

  describe('resolveFavoriteWorkflow', () => {
    it('returns null when no favorite is configured', async () => {
      expect(await resolveFavoriteWorkflow(configDir, projectAId, rootA)).toBeNull()
    })

    it('resolves a global-scope favorite from the catalog', async () => {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, 'global-flow')
      const fav = await resolveFavoriteWorkflow(configDir, projectAId, rootA)
      expect(fav).toEqual({ id: 'global-flow', name: 'Global Flow', scope: 'user' })
      deleteSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)
    })

    it('resolves a project-scope favorite', async () => {
      updateProject(projectAId, { favoriteWorkflowId: 'proj-flow' })
      const fav = await resolveFavoriteWorkflow(configDir, projectAId, rootA)
      expect(fav).toEqual({ id: 'proj-flow', name: 'Project Flow', scope: 'project' })
    })

    it('returns null when the favorite workflow was deleted', async () => {
      updateProject(projectAId, { favoriteWorkflowId: 'ghost-flow' })
      expect(await resolveFavoriteWorkflow(configDir, projectAId, rootA)).toBeNull()
    })
  })

  describe('sweepFavoritesAfterDelete', () => {
    const rmWorkflow = async (path: string) => rm(path, { force: true })

    it('clears the global favorite when the deleted workflow is gone everywhere', async () => {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, 'global-flow')
      await rmWorkflow(join(configDir, 'workflows', 'global-flow.workflow.json'))

      await sweepFavoritesAfterDelete('global-flow', configDir)

      expect(getSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)).toBe('')
    })

    it('keeps the global favorite when a same-id user workflow still exists', async () => {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, 'global-flow')
      // The delete targeted a project copy; the global definition survives.
      await sweepFavoritesAfterDelete('global-flow', configDir, rootA)

      expect(getSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)).toBe('global-flow')
    })

    it('clears a project favorite pointing at the deleted id', async () => {
      updateProject(projectAId, { favoriteWorkflowId: 'proj-flow' })
      await rmWorkflow(join(rootA, '.openfox', 'workflows', 'proj-flow.workflow.json'))

      await sweepFavoritesAfterDelete('proj-flow', configDir, rootA)

      expect(getProject(projectAId)?.favoriteWorkflowId).toBeUndefined()
    })

    it('keeps a project favorite when the id still resolves in another scope', async () => {
      updateProject(projectAId, { favoriteWorkflowId: 'global-flow' })
      // Deleting the global file while the project has its own copy keeps the
      // favorite valid (project scope still resolves).
      await writeFile(
        join(rootA, '.openfox', 'workflows', 'global-flow.workflow.json'),
        sampleWorkflow('global-flow', 'Global Flow'),
      )

      await sweepFavoritesAfterDelete('global-flow', configDir)

      expect(getProject(projectAId)?.favoriteWorkflowId).toBe('global-flow')
    })

    it('clears a project favorite even when the delete happened in another project dir', async () => {
      updateProject(projectAId, { favoriteWorkflowId: 'ghost-flow' })

      await sweepFavoritesAfterDelete('ghost-flow', configDir)

      expect(getProject(projectAId)?.favoriteWorkflowId).toBeUndefined()
    })

    it('leaves unrelated favorites untouched', async () => {
      setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, 'global-flow')
      updateProject(projectAId, { favoriteWorkflowId: 'proj-flow' })

      await sweepFavoritesAfterDelete('other-flow', configDir)

      expect(getSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW)).toBe('global-flow')
      expect(getProject(projectAId)?.favoriteWorkflowId).toBe('proj-flow')
    })
  })
})
