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

    const withDangerLevel = updateProject(projectB.id, { dangerLevel: 'dangerous' })
    expect(withDangerLevel).toMatchObject({ id: projectB.id, dangerLevel: 'dangerous' })

    const clearDangerLevel = updateProject(projectB.id, { dangerLevel: null })
    expect(clearDangerLevel).toMatchObject({ id: projectB.id })
    expect(clearDangerLevel && 'dangerLevel' in clearDangerLevel).toBe(false)

    expect(updateProject('missing', { name: 'Nope' })).toBeNull()

    deleteProject(projectA.id)
    expect(getProject(projectA.id)).toBeNull()
    expect(listProjects()).toHaveLength(1)
  })

  it('sets and clears the project default agent', () => {
    const project = createProject('Agent Default', workdirA)
    expect(project.defaultAgent).toBeUndefined()

    const withAgent = updateProject(project.id, { defaultAgent: 'builder' })
    expect(withAgent).toMatchObject({ id: project.id, defaultAgent: 'builder' })
    expect(getProject(project.id)?.defaultAgent).toBe('builder')
    expect(listProjects()[0]?.defaultAgent).toBe('builder')

    const cleared = updateProject(project.id, { defaultAgent: null })
    expect(cleared).toMatchObject({ id: project.id })
    expect(cleared && 'defaultAgent' in cleared).toBe(false)
    expect(getProject(project.id)?.defaultAgent).toBeUndefined()
  })

  it('returns existing project when creating with duplicate workdir', () => {
    const original = createProject('Original', workdirA)
    const duplicate = createProject('Duplicate', workdirA)

    // Should return the original project, not create a new one
    expect(duplicate.id).toBe(original.id)
    expect(duplicate.name).toBe(original.name) // Original name preserved
    expect(duplicate.workdir).toBe(workdirA)

    // Only one project in the database
    expect(listProjects()).toHaveLength(1)
  })
})
