import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import {
  createProject,
  deleteProject,
  getProject,
  getProjectByWorkdir,
  listProjects,
  updateProject,
} from './projects.js'

describe('db projects', () => {
  let workdirA: string
  let workdirB: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    workdirA = await mkdtemp(join(tmpdir(), 'openfox-project-a-'))
    workdirB = await mkdtemp(join(tmpdir(), 'openfox-project-b-'))
  })

  afterEach(async () => {
    closeDatabase()
    await rm(workdirA, { recursive: true, force: true })
    await rm(workdirB, { recursive: true, force: true })
  })

  it('creates, fetches, lists, updates, and deletes projects', () => {
    const projectA = createProject('OpenFox', workdirA)
    const projectB = createProject('Sandbox', workdirB)

    expect(getProject(projectA.id)).toMatchObject({ id: projectA.id, name: 'OpenFox', workdir: workdirA })
    expect(getProjectByWorkdir(workdirB)).toMatchObject({ id: projectB.id, name: 'Sandbox' })
    expect(getProject('missing')).toBeNull()
    expect(getProjectByWorkdir('/missing')).toBeNull()

    const listed = listProjects()
    expect(listed).toHaveLength(2)
    expect(listed.map((project) => project.id)).toContain(projectA.id)
    expect(listed.map((project) => project.id)).toContain(projectB.id)

    const updated = updateProject(projectA.id, { name: 'OpenFox Renamed', customInstructions: 'Be careful' })
    expect(updated).toMatchObject({
      id: projectA.id,
      name: 'OpenFox Renamed',
      customInstructions: 'Be careful',
    })

    const cleared = updateProject(projectA.id, { customInstructions: null })
    expect(cleared).toMatchObject({ id: projectA.id, name: 'OpenFox Renamed' })
    expect(cleared && 'customInstructions' in cleared).toBe(false)

    expect(updateProject('missing', { name: 'Nope' })).toBeNull()

    deleteProject(projectA.id)
    expect(getProject(projectA.id)).toBeNull()
    expect(listProjects()).toHaveLength(1)
  })
})
